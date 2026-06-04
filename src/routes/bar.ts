import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";
import { pushNotification } from "../services/notificationService";
import { fmt } from "../utils/fmt";

const r = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper — Bar store ID (department: "lounge")
// ─────────────────────────────────────────────────────────────────────────────

async function getBarStoreId() {
  try {
    const store = await prisma.store.findFirst({
      where: { department: "lounge" },
    });
    if (!store) {
      console.warn("⚠️ Store BAR non trouvé en base ! Utilisation de l'ID 8 par défaut");
      return 8;
    }
    console.log(`🍺 Store BAR trouvé: ID ${store.id} - ${store.name}`);
    return store.id;
  } catch (error) {
    console.error("❌ Erreur récupération store BAR:", error);
    return 8;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup items for bar dishes
// ─────────────────────────────────────────────────────────────────────────────

r.post("/setup-bar-items", async (_req, res) => {
  try {
    const dishes = await prisma.dish.findMany({
      where: { menuDept: "lounge" } as any,
    });
    const results = [];

    for (const dish of dishes) {
      let item = await prisma.item.findFirst({ where: { sku: `BAR-${dish.id}` } });
      if (!item) {
        item = await prisma.item.create({
          data: {
            sku: `BAR-${dish.id}`,
            name: dish.name,
            unit: "piece",
            vatRate: 10,
            costPrice: Math.round(dish.price * 0.5),
            salePriceDefault: dish.price,
            isActive: dish.isActive,
            isMenu: true,
            menuDept: "lounge",
          },
        });
        results.push({ dish: dish.name, status: "created", itemId: item.id });
      } else {
        results.push({ dish: dish.name, status: "exists", itemId: item.id });
      }
    }

    res.json({ message: "Configuration bar terminée", results });
  } catch (error) {
    console.error("❌ Erreur setup bar items:", error);
    res.status(500).json({ error });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tables (department: "lounge")
// ─────────────────────────────────────────────────────────────────────────────

r.get("/tables", requireScope("orders:read"), async (req, res) => {
  try {
    const user = (req as any).user;

    const isAdminOrManager = ["ADMIN", "MANAGER", "RECEPTION"].includes(user.role);

    const tables = await prisma.diningTable.findMany({
      where: {
        department: { in: ["lounge"] },
        // Waiter → seulement ses tables assignées
        ...(!isAdminOrManager && { assignedWaiterId: user.id }),
      },
      include: {
        assignedWaiter: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
      orderBy: { code: "asc" },
    });

    res.json(tables);

  } catch (error) {
    console.error("❌ Erreur GET /tables :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/tables", requireScope("orders:write"), async (req, res) => {
  try {
    const user = (req as any).user;

    const schema = z.object({
      code: z.string(),
      department: z.enum(["lounge"]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
    }

    const existing = await prisma.diningTable.findUnique({
      where: { code: parsed.data.code },
    });

    if (existing) {
      return res.status(409).json({
        error: `Une table avec le code "${parsed.data.code}" existe déjà`,
        code: "DUPLICATE_CODE",
      });
    }

    const isWaiter = user.role === "WAITER";

    const created = await prisma.diningTable.create({
      data: {
        ...parsed.data,
        // Waiter → assigné automatiquement à lui-même
        ...(isWaiter && { assignedWaiterId: user.id }),
      },
      include: {
        assignedWaiter: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    res.status(201).json(created);

  } catch (error) {
    console.error("❌ Erreur POST /tables :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/tables/:id/assign", requireScope("orders:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const schema = z.object({ waiterId: z.number().int().nullable() });
    const { waiterId } = schema.parse(req.body);

    if (waiterId !== null) {
      const waiter = await prisma.user.findUnique({ where: { id: waiterId } });
      if (!waiter) return res.status(404).json({ error: "Serveur introuvable" });
    }

    const updated = await prisma.diningTable.update({
      where: { id },
      data: { assignedWaiterId: waiterId },
      include: {
        assignedWaiter: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    res.json(updated);
  } catch (error: any) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.get("/waiters", requireScope("orders:read"), async (_req, res) => {
  try {
    const waiters = await prisma.user.findMany({
      where: { role: { in: ["WAITER", "STAFF", "MANAGER", "ADMIN"] } },
      select: {
        id: true, name: true, email: true, role: true,
        assignedTables: { select: { id: true, code: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json(waiters);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);

  const schema = z.object({ code: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Données invalides", details: parsed.error.flatten() });
  }

  // Si un nouveau code est fourni, vérifier qu'il n'est pas déjà pris par une AUTRE table
  if (parsed.data.code) {
    const conflict = await prisma.diningTable.findFirst({
      where: {
        code: parsed.data.code,
        NOT: { id },          // exclure la table en cours de modification
      },
    });

    if (conflict) {
      return res.status(409).json({
        error: `Le code "${parsed.data.code}" est déjà utilisé par une autre table`,
        code: "DUPLICATE_CODE",
      });
    }
  }

  const updated = await prisma.diningTable.update({
    where: { id },
    data: parsed.data,
  });

  res.json(updated);
});

r.delete("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasOrders = await prisma.order.count({ where: { tableId: id } });
  if (hasOrders) return res.status(400).json({ error: "Cannot delete table with orders" });
  await prisma.diningTable.delete({ where: { id } });
  res.status(204).end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Orders (dept: "lounge")
// ─────────────────────────────────────────────────────────────────────────────

r.get("/orders", requireScope("orders:read"), async (req, res) => {
  try {
    const schema = z.object({
      status: z.enum(["open", "closed", "cancelled"]).optional(),
    });
    const { status } = schema.parse(req.query);

    const orders = await prisma.order.findMany({
      where: {
        dept: "lounge",
        ...(status ? { status } : {}),
      },
      include: {
        lines: { include: { item: true } },
        table: true,
      },
      orderBy: { openedAt: "desc" },
    });

    res.json(orders);
  } catch (error) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Invalid parameters", details: error.errors });
    res.status(503).json({ data: [], error: "Database temporarily unavailable", retry: true });
  }
});

r.get("/orders/:id", requireScope("orders:read"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      lines: true,
      table: true,
      payments: {
        include: {
          operator: { select: { id: true, name: true, email: true, role: true } },
        },
      },
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

r.post("/orders", requireScope("orders:write"), async (req, res) => {
  const schema = z.object({
    tableCode: z.string().optional(),
    tabId: z.number().int().optional(),
  });
  const input = schema.parse(req.body);
  const table = input.tableCode
    ? await prisma.diningTable.findUnique({ where: { code: input.tableCode } })
    : null;

  const created = await prisma.order.create({
    data: {
      dept: "lounge",
      tableId: table?.id,
      status: "open",
      tabId: input.tabId,
    },
  });

  await pushNotification({
    event: "order_created",
    title: `🍺 Nouvelle commande bar — ${input.tableCode ?? "Emporter"}`,
    body: `Commande #${created.id} ouverte au bar`,
    targetRoles: ["admin", "staff", "waiter"],
    meta: { orderId: created.id, dept: "lounge", tableCode: input.tableCode },
  }).catch(() => {});

  res.status(201).json(created);
});

r.post("/orders/:id/lines", requireScope("orders:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const schema = z.object({
      itemId: z.number().int(),
      qty: z.number().int().min(1),
      comment: z.string().optional().nullable(),
    });
    const input = schema.parse(req.body);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ error: "Commande non trouvée" });

    // Look up as a bar dish first, then fall back to generic item
    const dish = await prisma.dish.findUnique({ where: { id: input.itemId } });
    if (!dish) return res.status(404).json({ error: "Article non trouvé" });

    let item = await prisma.item.findFirst({
      where: {
        OR: [
          { sku: `BAR-${dish.id}` },
          { name: dish.name, isMenu: true, menuDept: "lounge" },
        ],
      },
    });

    if (!item) {
      item = await prisma.item.create({
        data: {
          sku: `BAR-${dish.id}`,
          name: dish.name,
          category: dish.category,
          unit: "piece",
          vatRate: 10,
          costPrice: Math.round(dish.price * 0.5),
          salePriceDefault: dish.price,
          isActive: dish.isActive,
          isMenu: true,
          menuDept: "lounge",
        },
      });
    }

    const existingLine = await prisma.orderLine.findFirst({
      where: { orderId: id, itemId: item.id, comment: input.comment || null },
    });

    let line;
    if (existingLine) {
      line = await prisma.orderLine.update({
        where: { id: existingLine.id },
        data: {
          qty: { increment: input.qty },
          comment: input.comment ?? existingLine.comment,
        },
      });
    } else {
      line = await prisma.orderLine.create({
        data: {
          orderId: id,
          itemId: item.id,
          itemName: dish.name,
          itempreparationTime: dish.preparationTime ?? null,
          qty: input.qty,
          unitPrice: dish.price,
          fireStatus: "commanded",
          comment: input.comment || null,
        },
      });
    }

    res.status(201).json({ message: "Article ajouté", data: line });
  } catch (error: any) {
    console.error("💥 ERREUR bar/orders/:id/lines:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.delete("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  if (order.status !== "open")
    return res.status(400).json({ error: "Cannot modify closed/cancelled order" });
  await prisma.orderLine.delete({ where: { id: lineId } });
  res.status(204).end();
});

r.patch("/orders/:id/lines/:lineId/status", requireScope("orders:status"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);

  await prisma.order.findUniqueOrThrow({ where: { id } });

  const schema = z.object({
    status: z.enum(["commanded", "preparing", "ready", "delivered", "voided"]),
  });
  const { status } = schema.parse(req.body);

  const updated = await prisma.orderLine.update({
    where: { id: lineId },
    data: { fireStatus: status },
  });

  if (status === "ready") {
    await pushNotification({
      event: "order_line_status",
      title: `🔔 Article prêt à servir (Bar)`,
      body: `Commande #${id} — un article est prêt`,
      targetRoles: ["waiter"],
      meta: { orderId: id, lineId, status },
    }).catch(() => {});
  }

  // Déduction stock à la livraison
  if (status === "delivered") {
    try {
      const orderLine = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } });

      const dish = await prisma.dish.findFirst({
        where: { name: orderLine.itemName },
      });

      if (!dish) {
        console.warn(`⚠️ Aucun Dish trouvé pour "${orderLine.itemName}", pas de déduction stock`);
        return res.json(updated);
      }

      const storeId = await getBarStoreId();
      const ingredients = dish.ingredients as Array<{
        itemId: number;
        itemName: string;
        quantity: number;
      }>;

      for (const ingredient of ingredients) {
        const item = await prisma.item.findUnique({ where: { id: ingredient.itemId } });
        if (!item) continue;

        let stock = await prisma.stock.findFirst({ where: { itemId: ingredient.itemId, storeId } });

        if (!stock) {
          stock = await prisma.stock.create({
            data: { storeId, itemId: ingredient.itemId, qty: 0, minQty: 0, maxQty: 100 },
          });
        }

        const newQty = stock.qty - ingredient.quantity;
        await prisma.stock.updateMany({
          where: { itemId: ingredient.itemId, storeId },
          data: { qty: newQty },
        });

        await prisma.stockMovement.create({
          data: {
            itemId: ingredient.itemId,
            storeId,
            qty: ingredient.quantity,
            type: "OUT",
            reason: `Livraison commande bar #${id} — ${dish.name}${newQty < 0 ? " (STOCK INSUFFISANT)" : ""}`,
          },
        });
      }
    } catch (err) {
      console.error("❌ Erreur déduction stock bar:", err);
    }
  }

  res.json(updated);
});

r.patch("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  await prisma.order.findUniqueOrThrow({ where: { id } });
  const schema = z.object({
    qty: z.number().int().min(1).optional(),
    unitPrice: z.number().int().min(0).optional(),
  });
  const data = schema.parse(req.body);
  const updated = await prisma.orderLine.update({ where: { id: lineId }, data });
  res.json(updated);
});

r.patch("/orders/:id/status", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ status: z.enum(["open", "closed", "cancelled"]) });
  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: schema.parse(req.body).status,
      ...(req.body.status === "closed" ? { closedAt: new Date() } : {}),
    },
  });
  res.json(updated);
});

r.delete("/orders/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.payments.length)
    return res.status(400).json({ error: "Cannot delete order with payments" });
  await prisma.orderLine.deleteMany({ where: { orderId: id } });
  await prisma.order.delete({ where: { id } });
  res.status(204).end();
});

r.post("/orders/:id/close", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const total = order.lines.reduce(
    (s: number, l: (typeof order.lines)[0]) => s + l.qty * l.unitPrice,
    0
  );

  const closed = await prisma.order.update({
    where: { id },
    data: { status: "closed", closedAt: new Date() },
  });

  await pushNotification({
    event: "order_closed",
    title: `✅ Commande bar clôturée`,
    body: `Commande #${id} — Total : ${fmt(total)} Ar`,
    targetRoles: ["admin", "cashier"],
    meta: { orderId: id, total },
  }).catch(() => {});

  res.json({ ...closed, total });
});

export default r;