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
            menuDept: 'restaurant' // ✅ Département correct
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

r.get("/tables", requireScope("orders:read"), async (req, res) => {
  try {
    const user = (req as any).user;

    const isAdminOrManager = ["ADMIN", "MANAGER", "RECEPTION"].includes(user.role);

    const tables = await prisma.diningTable.findMany({
      where: {
        department: { in: ["restaurant"] },
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
      department: z.enum(["restaurant"]),
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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /restaurant/tables/:id/assign — Assigner ou désassigner un serveur
// ─────────────────────────────────────────────────────────────────────────────
 
r.patch("/tables/:id/assign", requireScope("orders:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
 
    const schema = z.object({
      waiterId: z.number().int().nullable(), // null = désassigner
    });
 
    const { waiterId } = schema.parse(req.body);
 
    // Vérifier que le serveur existe si on assigne
    if (waiterId !== null) {
      const waiter = await prisma.user.findUnique({ where: { id: waiterId } });
      if (!waiter) return res.status(404).json({ error: "Serveur introuvable" });
    }
 
    const updated = await prisma.diningTable.update({
      where: { id },
      data: { assignedWaiterId: waiterId },
      include: {
        assignedWaiter: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
 
    res.json(updated);
  } catch (error: any) {
    console.error("❌ Erreur PATCH /tables/:id/assign :", error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Données invalides", details: error.errors });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /restaurant/waiters — Liste des serveurs disponibles pour l'assignation
// ─────────────────────────────────────────────────────────────────────────────
 
r.get("/waiters", requireScope("orders:read"), async (_req, res) => {
  try {
    const waiters = await prisma.user.findMany({
      where: {
        role: { in: ["WAITER", "STAFF", "MANAGER", "ADMIN"] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        assignedTables: {
          select: { id: true, code: true },
        },
      },
      orderBy: { name: "asc" },
    });
 
    res.json(waiters);
  } catch (error) {
    console.error("❌ Erreur GET /restaurant/waiters :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.get("/waiters/unassigned", requireScope("orders:read"), async (_req, res) => {
  try {
    const waiters = await prisma.user.findMany({
      where: {
        role: { in: ["WAITER", "STAFF", "MANAGER", "ADMIN"] },
        assignedTables: { none: {} } // Serveurs sans table assignée
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: { name: "asc" },
    });
    
    res.json(waiters);
  } catch (error) {
    console.error("❌ Erreur GET /restaurant/waiters/unassigned :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /restaurant/tables/:id/waiter - Récupérer le serveur d'une table
r.get("/tables/:id/waiter", requireScope("orders:read"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    
    const table = await prisma.diningTable.findUnique({
      where: { id },
      include: {
        assignedWaiter: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
    
    if (!table) return res.status(404).json({ error: "Table introuvable" });
    
    res.json(table.assignedWaiter);
  } catch (error) {
    console.error("❌ Erreur GET /tables/:id/waiter :", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /restaurant/waiters/assigned-tables/:waiterId - Tables assignées à un serveur
r.get("/waiters/assigned-tables/:waiterId", requireScope("orders:read"), async (req, res) => {
  try {
    const waiterId = Number(req.params.waiterId);
    if (isNaN(waiterId)) return res.status(400).json({ error: "ID invalide" });
    
    const tables = await prisma.diningTable.findMany({
      where: { assignedWaiterId: waiterId },
      select: {
        id: true,
        code: true,
        department: true,
        orders: {
          where: { status: "open" },
          select: { id: true, status: true }
        }
      },
    });
    
    res.json(tables);
  } catch (error) {
    console.error("❌ Erreur GET /waiters/assigned-tables/:waiterId :", error);
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

r.get("/orders", requireScope("orders:read"), async (req, res) => {
  try {
    const schema = z.object({
      dept: z.enum(["restaurant", "lounge", "casino"]).optional(), // ✅ Modifié: "pub", "spa" → "lounge", "casino"
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
  const schema = z.object({ dept: z.enum(["restaurant", "lounge", "casino"]).default("restaurant"), tableCode: z.string().optional(), tabId: z.number().int().optional() }); // ✅ Modifié
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
          menuDept: "restaurant" // ✅ Département correct
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