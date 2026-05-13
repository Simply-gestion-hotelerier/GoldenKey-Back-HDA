import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";
import { pushNotification } from "../services/notificationService";
import { fmt } from "../utils/fmt";

const r = Router();

async function getRestaurantStoreId() {
  try {
    const store = await prisma.store.findFirst({
      where: { department: "restaurant" }
    });
    
    if (!store) {
      console.warn("⚠️ Store RESTAURANT non trouvé en base ! Utilisation de l'ID 7 par défaut");
      return 7; // Fallback à 7 si non trouvé
    }
    
    console.log(`🏪 Store RESTAURANT trouvé: ID ${store.id} - ${store.name}`);
    return store.id;
  } catch (error) {
    console.error("❌ Erreur lors de la récupération du store RESTAURANT:", error);
    return 7; // Fallback sécurisé
  }
}

// Route pour créer les Items manquants
r.post("/setup-dishes-items", async (req, res) => {
  try {
    console.log('🔄 Configuration des Items pour tous les Dishes...');

    const dishes = await prisma.dish.findMany();
    const results = [];

    for (const dish of dishes) {
      let item = await prisma.item.findFirst({
        where: { sku: `DISH-${dish.id}` }
      });

      if (!item) {
        item = await prisma.item.create({
          data: {
            sku: `DISH-${dish.id}`,
            name: dish.name,
            unit: 'piece',
            vatRate: 10,
            costPrice: Math.round(dish.price * 0.6),
            salePriceDefault: dish.price,
            isActive: dish.isActive,
            isMenu: true,
            menuDept: 'restaurant'
          }
        });
        results.push({ dish: dish.name, status: 'created', itemId: item.id });
      } else {
        results.push({ dish: dish.name, status: 'exists', itemId: item.id });
      }
    }

    console.log('✅ Configuration terminée:', results);
    res.json({
      message: "Configuration terminée",
      results: results
    });

  } catch (error) {
    console.error('❌ Erreur configuration:', error);
    res.status(500).json({ error });
  }
});

r.get("/tables", requireScope("orders:read"), async (_req, res) => {
  const tables = await prisma.diningTable.findMany({ where: { department: { in: ["restaurant", "pub"] } } });
  res.json(tables);
});

r.post("/tables", requireScope("orders:write"), async (req, res) => {
  const schema = z.object({ code: z.string(), department: z.enum(["restaurant", "pub"]) });
  const created = await prisma.diningTable.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ code: z.string().optional() });
  const updated = await prisma.diningTable.update({ where: { id }, data: schema.parse(req.body) });
  res.json(updated);
});

r.delete("/tables/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasOrders = await prisma.order.count({ where: { tableId: id } });
  if (hasOrders) return res.status(400).json({ error: "Cannot delete table with orders" });
  await prisma.diningTable.delete({ where: { id } });
  res.status(204).end();
});

r.get("/orders", requireScope("orders:read"), async (req, res) => {
  try {
    const schema = z.object({
      dept: z.enum(["restaurant", "pub", "spa"]).optional(),
      status: z.enum(["open", "closed", "cancelled"]).optional(),
    });

    const { dept, status } = schema.parse(req.query);

    const orders = await prisma.order.findMany({
      where: {
        ...(dept ? { dept } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        lines: {
          include: {
            item: true
          }
        },
        table: true,
      },
      orderBy: {
        openedAt: "desc",
      },
    });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid parameters",
        details: error.errors,
      });
    }

    res.status(503).json({
      data: [],
      error: "Database temporarily unavailable",
      retry: true,
    });
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
  const schema = z.object({ dept: z.enum(["restaurant", "pub", "spa"]).default("restaurant"), tableCode: z.string().optional(), tabId: z.number().int().optional() });
  const input = schema.parse(req.body);
  const table = input.tableCode ? await prisma.diningTable.findUnique({ where: { code: input.tableCode } }) : null;
  const created = await prisma.order.create({ data: { dept: input.dept, tableId: table?.id, status: "open", tabId: input.tabId } });
  await pushNotification({
    event: "order_created",
    title: `🍽️ Nouvelle commande — Table ${input.tableCode ?? "—"}`,
    body: `Commande #${created.id} ouverte en ${input.dept}`,
    targetRoles: ["admin", "chef", "waiter"],
    meta: {
      orderId: created.id,
      dept: input.dept,
      tableCode: input.tableCode,
      tabId: input.tabId
    },
  }).catch(() => { });
  res.status(201).json(created);
});

r.post("/orders/:id/lines", requireScope("orders:write"), async (req, res) => {
  console.log("🚨 DÉBUT ADD_LINE");

  try {
    const id = Number(req.params.id);

    const schema = z.object({
      itemId: z.number().int(),
      qty: z.number().int().min(1),
      comment: z.string().optional().nullable()
    });

    const input = schema.parse(req.body);

    // ✅ Vérifier la commande
    const order = await prisma.order.findUnique({
      where: { id }
    });

    if (!order) {
      return res.status(404).json({ error: "Commande non trouvée" });
    }

    // ✅ Rechercher le dish
    const dish = await prisma.dish.findUnique({
      where: { id: input.itemId }
    });

    if (!dish) {
      return res.status(404).json({ error: "Plat non trouvé" });
    }

    // ✅ Chercher ou créer item
    let item = await prisma.item.findFirst({
      where: {
        OR: [
          { sku: `DISH-${dish.id}` },
          { name: dish.name, isMenu: true }
        ]
      }
    });

    if (!item) {
      item = await prisma.item.create({
        data: {
          sku: `DISH-${dish.id}`,
          name: dish.name,
          category: dish.category,
          unit: "piece",
          vatRate: 10,
          costPrice: Math.round(dish.price * 0.6),
          salePriceDefault: dish.price,
          isActive: dish.isActive,
          isMenu: true,
          menuDept: "restaurant"
        }
      });
    }

    // 🔍 Chercher ligne existante (IMPORTANT)
    const existingLine = await prisma.orderLine.findFirst({
      where: {
        orderId: id,
        itemId: item.id,
        comment: input.comment || null // 👉 inclure commentaire si tu veux différencier
      }
    });

    let line;

    if (existingLine) {
      console.log("♻️ Ligne existante → increment");

      line = await prisma.orderLine.update({
        where: { id: existingLine.id },
        data: {
          qty: {
            increment: input.qty // ✅ SAFE concurrency
          },
          // optionnel: update comment si fourni
          comment: input.comment ?? existingLine.comment
        }
      });

    } else {
      console.log("🆕 Nouvelle ligne");

      line = await prisma.orderLine.create({
        data: {
          orderId: id,
          itemId: item.id,
          itemName: dish.name,
          itempreparationTime: dish.preparationTime ?? null,
          qty: input.qty,
          unitPrice: dish.price,
          fireStatus: "commanded",
          comment: input.comment || null
        }
      });
    }

    console.log("🎉 SUCCÈS - Ligne:", line.id);

    res.status(201).json({
      message: "Plat ajouté à la commande",
      data: line
    });

  } catch (error: any) {
    console.error("💥 ERREUR:", error);

    if (error.code === "P2003") {
      return res.status(400).json({
        error: "Erreur de configuration",
        message: "Problème de liaison entre plats et articles"
      });
    }

    res.status(500).json({
      error: "Erreur serveur",
      message: "Impossible d'ajouter à la commande"
    });
  }
});

r.delete("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  if (order.status !== "open") return res.status(400).json({ error: "Cannot modify closed/cancelled order" });
  await prisma.orderLine.delete({ where: { id: lineId } });
  res.status(204).end();
});

r.patch("/orders/:id/lines/:lineId/status", requireScope("orders:status"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);

  await prisma.order.findUniqueOrThrow({ where: { id } });

  const schema = z.object({
    status: z.enum(["commanded", "preparing", "ready", "delivered", "voided"])
  });
  const { status } = schema.parse(req.body);

  const updated = await prisma.orderLine.update({
    where: { id: lineId },
    data: { fireStatus: status }
  });

  // 🔔 Notification quand prêt à servir
  if (status === "ready") {
    await pushNotification({
      event: "order_line_status",
      title: `🔔 Plat prêt à servir`,
      body: `Commande #${id} — un plat est prêt`,
      targetRoles: ["waiter"],
      meta: { orderId: id, lineId, status },
    }).catch(() => { });
  }

  // 📦 Déduction du stock à la livraison
  if (status === "delivered") {
    try {
      // Récupérer la orderLine avec le nom du plat
      const orderLine = await prisma.orderLine.findUniqueOrThrow({
        where: { id: lineId },
      });

      // Trouver le Dish correspondant via itemName (stocké dans orderLine)
      const dish = await prisma.dish.findFirst({
        where: { name: orderLine.itemName }
      });

      if (!dish) {
        console.warn(`⚠️ Aucun Dish trouvé pour "${orderLine.itemName}", pas de déduction stock`);
        return res.json(updated);
      }

      const storeId = await getRestaurantStoreId();
      const ingredients = dish.ingredients as Array<{
        itemId: number;
        itemName: string;
        quantity: number;
      }>;

      // — Même logique que POST /dishes —
      for (const ingredient of ingredients) {
        console.log(`➖ Déduction livraison: ${ingredient.itemName} -${ingredient.quantity}`);

        const item = await prisma.item.findUnique({
          where: { id: ingredient.itemId }
        });

        if (!item) {
          console.warn(`⚠️ Item ${ingredient.itemId} introuvable, déduction ignorée`);
          continue;
        }

        // Vérifier/créer le stock
        let stock = await prisma.stock.findFirst({
          where: { itemId: ingredient.itemId, storeId }
        });

        if (!stock) {
          console.log(`📦 Création stock pour ${ingredient.itemName} (qty: 0)`);
          stock = await prisma.stock.create({
            data: { storeId, itemId: ingredient.itemId, qty: 0, minQty: 0, maxQty: 100 }
          });
        }

        console.log(`📊 Stock disponible: ${stock.qty}, Requis: ${ingredient.quantity}`);

        if (stock.qty < ingredient.quantity) {
          // Stock insuffisant → passe en négatif (même comportement que POST /dishes)
          const newQty = stock.qty - ingredient.quantity;
          console.warn(`⚠️ Stock insuffisant pour ${ingredient.itemName}, passage en négatif: ${newQty}`);

          await prisma.stock.updateMany({
            where: { itemId: ingredient.itemId, storeId },
            data: { qty: newQty }
          });

          await prisma.stockMovement.create({
            data: {
              itemId: ingredient.itemId,
              storeId,
              qty: ingredient.quantity,
              type: "OUT",
              reason: `Livraison commande #${id} — ${dish.name} (STOCK INSUFFISANT)`
            }
          });

        } else {
          // Stock suffisant → déduction normale
          const stockBefore = stock.qty;

          await prisma.stock.updateMany({
            where: { itemId: ingredient.itemId, storeId },
            data: { qty: { decrement: ingredient.quantity } }
          });

          const stockAfter = await prisma.stock.findFirst({
            where: { itemId: ingredient.itemId, storeId }
          });

          console.log(`✅ ${ingredient.itemName}: ${stockBefore} → ${stockAfter?.qty}`);

          await prisma.stockMovement.create({
            data: {
              itemId: ingredient.itemId,
              storeId,
              qty: ingredient.quantity,
              type: "OUT",
              reason: `Livraison commande #${id} — ${dish.name}`
            }
          });
        }
      }

      console.log(`🎉 Stock mis à jour après livraison commande #${id}`);

    } catch (err) {
      // Ne pas bloquer la réponse si la déduction échoue
      console.error("❌ Erreur déduction stock à la livraison:", err);
    }
  }

  res.json(updated);
});

r.patch("/orders/:id/lines/:lineId", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  await prisma.order.findUniqueOrThrow({ where: { id } });
  const schema = z.object({ qty: z.number().int().min(1).optional(), unitPrice: z.number().int().min(0).optional() });
  const data = schema.parse(req.body);
  const updated = await prisma.orderLine.update({ where: { id: lineId }, data });
  res.json(updated);
});

r.patch("/orders/:id/status", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ status: z.enum(["open", "closed", "cancelled"]) });
  const updated = await prisma.order.update({ where: { id }, data: { status: schema.parse(req.body).status, ...(req.body.status === "closed" ? { closedAt: new Date() } : {}) } });
  res.json(updated);
});

r.delete("/orders/:id", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.payments.length) return res.status(400).json({ error: "Cannot delete order with payments" });
  await prisma.orderLine.deleteMany({ where: { orderId: id } });
  await prisma.order.delete({ where: { id } });
  res.status(204).end();
});

r.post("/orders/:id/close", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: true }
  });

  if (!order) return res.status(404).json({ error: "Order not found" });

  const total = order.lines.reduce((s: number, l: typeof order.lines[0]) =>
    s + l.qty * l.unitPrice, 0);

  const closed = await prisma.order.update({
    where: { id },
    data: {
      status: "closed",
      closedAt: new Date()
    }
  });

  await pushNotification({
    event: "order_closed",
    title: `✅ Commande clôturée`,
    body: `Commande #${id} — Total : ${fmt(total)} Ar`,
    targetRoles: ["admin", "cashier"],
    meta: { orderId: id, total },
  }).catch(() => { });

  res.json({ ...closed, total });
});

r.post("/orders/:id/charge-to-folio", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ folioId: z.number().int(), closeOrder: z.boolean().optional().default(false) });
  const input = schema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  if (!order.lines.length) return res.status(400).json({ error: "Order has no lines" });

  const result = await prisma.$transaction(async (tx) => {
    for (const l of order.lines) {
      await tx.folioCharge.create({
        data: {
          folioId: input.folioId,
          description: `${l.itemName} x${l.qty}`,
          qty: 1,
          unitPrice: l.qty * l.unitPrice,
          department: order.dept,
        },
      });
    }
    const charges = await tx.folioCharge.findMany({ where: { folioId: input.folioId } });
    const payments = await tx.payment.findMany({ where: { folioId: input.folioId } });
    const total = charges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const folio = await tx.folio.update({ where: { id: input.folioId }, data: { total, balance: Math.max(0, total - paid) } });

    let closed: any = null;
    if (input.closeOrder) {
      closed = await tx.order.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
    }

    return { folio, closed };
  });

  res.status(201).json(result);
});

export default r;