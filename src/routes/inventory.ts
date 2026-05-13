import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";
import { pushNotification } from "../services/notificationService";

const r = Router();

r.get("/items", requireScope("inventory:read"), async (req, res) => {
  const { isMenu, dept } = req.query as any;
  const items = await prisma.item.findMany({
    where: {
      isActive: true,
      ...(isMenu !== undefined ? { isMenu: isMenu === "true" } : {}),
      ...(dept ? { menuDept: dept } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json(items);
});

r.get("/items/:id", requireScope("inventory:read"), async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) return res.status(404).json({ error: "Item not found" });
  res.json(item);
});

r.post("/items", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({
    sku: z.string(),
    name: z.string(),
    unit: z.enum(["piece", "kg", "g", "L", "cl", "ml"]),
    vatRate: z.number().int().min(0).max(100),
    costPrice: z.number().int().min(0),
    salePriceDefault: z.number().int().min(0),
    isActive: z.boolean().optional().default(true),
    isMenu: z.boolean().optional(),
    menuDept: z.enum(["hotel", "restaurant", "pub", "spa"]).optional(),
  });
  const data = schema.parse(req.body);

  const existing = await prisma.item.findUnique({
    where: { sku: data.sku },
  });

  if (existing) {
    return res.status(400).json({
      error: "Un item avec ce SKU existe déjà",
    });
  }

  const created = await prisma.item.create({ data });
  res.status(201).json(created);
});

r.patch("/items/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().optional(),
    vatRate: z.number().int().min(0).max(100).optional(),
    costPrice: z.number().int().min(0).optional(),
    salePriceDefault: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    isMenu: z.boolean().optional(),
    maxQty: z.number().int().min(1).nullable().optional(),
    menuDept: z.enum(["hotel", "restaurant", "pub", "spa"]).nullable().optional(),
  });
  const data = schema.parse(req.body);
  const updated = await prisma.item.update({ where: { id }, data });
  res.json(updated);
});

r.delete("/items/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.stock.deleteMany({ where: { itemId: id } });
  await prisma.orderLine.deleteMany({ where: { itemId: id } });
  await prisma.item.delete({ where: { id } });
  res.status(204).end();
});

r.get("/stores", requireScope("inventory:read"), async (_req, res) => {
  const stores = await prisma.store.findMany();
  res.json(stores);
});

r.get("/stores/:id", requireScope("inventory:read"), async (req, res) => {
  const id = Number(req.params.id);
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) return res.status(404).json({ error: "Store not found" });
  res.json(store);
});

r.post("/stores", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({
    name: z.string(),
    department: z.enum(["hotel", "restaurant", "pub", "spa"]),
  });
  const created = await prisma.store.create({ data: schema.parse(req.body) });
  res.status(201).json(created);
});

r.patch("/stores/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ name: z.string().optional() });
  const updated = await prisma.store.update({
    where: { id },
    data: schema.parse(req.body),
  });
  res.json(updated);
});

r.delete("/stores/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  const hasStocks = await prisma.stock.count({ where: { storeId: id } });
  if (hasStocks)
    return res.status(400).json({ error: "Cannot delete store with stocks" });
  await prisma.store.delete({ where: { id } });
  res.status(204).end();
});

r.get("/stocks", requireScope("inventory:read"), async (req, res) => {
  const { storeId } = req.query as any;
  const stocks = await prisma.stock.findMany({
    where: { ...(storeId ? { storeId: Number(storeId) } : {}) },
    include: { item: true, store: true },
  });
  res.json(stocks);
});

r.post("/stocks", requireScope("inventory:write"), async (req, res) => {
  const schema = z.object({
    storeId: z.number().int(),
    itemId: z.number().int(),
    qty: z.number().int().min(0),
    minQty: z.number().int().min(0).default(0),
    maxQty: z.number().int().min(1).optional(),
  });
  try {
    const data = schema.parse(req.body);
    const store = await prisma.store.findUnique({ where: { id: data.storeId } });
    if (!store) return res.status(400).json({ error: "Store not found" });
    const item = await prisma.item.findUnique({ where: { id: data.itemId } });
    if (!item) return res.status(400).json({ error: "Item not found" });

    const created = await prisma.stock.create({
      data: {
        storeId: data.storeId,
        itemId: data.itemId,
        qty: data.qty,
        minQty: data.minQty,
        maxQty: data.maxQty,
      },
    });
    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "P2003")
      return res.status(400).json({ error: "Foreign key constraint failed" });
    res.status(500).json({ error: String(e) });
  }
});

r.patch("/stocks/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);

  try {
    const schema = z.object({
      qty: z.coerce.number().int().optional(),
      minQty: z.coerce.number().int().optional(),
      maxQty: z.coerce.number().int().optional(),
    });

    const data = schema.parse(req.body);
    const updated = await prisma.stock.update({ where: { id }, data });
    res.json(updated);
  } catch (e) {
    console.error("PATCH /stocks error:", e);
    res.status(400).json({ error: String(e) });
  }
});

r.get("/movements", requireScope("inventory:read"), async (req, res) => {
  try {
    const { limit } = req.query as any;
    const l = limit ? Math.min(200, Number(limit)) : 100;
    const moves = await prisma.stockMovement.findMany({
      include: { item: true, store: true },
      orderBy: { createdAt: "desc" },
      take: l,
    });
    res.json(moves);
  } catch (error) {
    console.error("Error fetching stock movements:", error);
    res.json([]);
  }
});

r.post("/movements", requireScope("inventory:adjust"), async (req, res) => {
  try {
    console.log("📥 Requête mouvement reçue:", req.body);

    const schema = z.object({
      storeId: z.coerce.number().int().min(1),
      itemId: z.coerce.number().int().min(1),
      qty: z.coerce.number().int().min(0),
      type: z.enum(["IN", "OUT", "ADJUST"]),
      reason: z.string().optional(),
    });

    const input = schema.parse(req.body);
    console.log("✅ Données validées:", input);

    const [store, item] = await Promise.all([
      prisma.store.findUnique({ where: { id: input.storeId } }),
      prisma.item.findUnique({ where: { id: input.itemId } }),
    ]);

    if (!store) {
      console.log("❌ Store non trouvé:", input.storeId);
      return res.status(400).json({ error: "Magasin non trouvé" });
    }
    if (!item) {
      console.log("❌ Item non trouvé:", input.itemId);
      return res.status(400).json({ error: "Article non trouvé" });
    }

    console.log("🔄 Début transaction...");

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Créer le mouvement
      const mv = await tx.stockMovement.create({
        data: {
          storeId: input.storeId,
          itemId: input.itemId,
          qty: input.qty,
          type: input.type,
          reason:
            input.reason ||
            `${input.type} - ${new Date().toLocaleString("fr-FR")}`,
        },
      });

      // 2. Upsert du stock
      const stock = await tx.stock.upsert({
        where: {
          stock_unique: { storeId: input.storeId, itemId: input.itemId },
        },
        create: {
          storeId: input.storeId,
          itemId: input.itemId,
          qty: input.type === "ADJUST" ? input.qty : 0,
          minQty: 0,
          maxQty: 100,
        },
        update: {},
      });

      // 3. Calculer nouvelle quantité
      let newQty = stock.qty;
      if (input.type === "IN") newQty += input.qty;
      else if (input.type === "OUT")
        newQty = Math.max(0, stock.qty - input.qty);
      else newQty = input.qty;

      // 4. Mettre à jour le stock
      await tx.stock.update({
        where: { id: stock.id },
        data: { qty: newQty },
      });

      // 5. Lire le stock final (avec item + store) pour les notifications
      const freshStock = await tx.stock.findUnique({
        where: { id: stock.id },
        include: { item: true, store: true },
      });

      return { mv, freshStock };
    });

    const { mv: created, freshStock } = result;
    console.log("✅ Mouvement créé avec succès ID:", created.id);

    // ── Notifications de rupture / stock bas ──────────────────────────────
    // Exécutées HORS transaction pour ne pas bloquer le commit en cas d'échec
    if (freshStock) {
      const { qty, minQty, item: stockItem, store: stockStore } = freshStock;

      if (qty === 0) {
        // 🔴 Rupture totale
        await pushNotification({
          event: "low_stock",
          title: `🔴 Rupture de stock : ${stockItem.name}`,
          body: `Le stock de "${stockItem.name}" dans "${stockStore.name}" est épuisé.`,
          targetRoles: ["admin", "manager"],
          meta: {
            itemId: stockItem.id,
            itemName: stockItem.name,
            storeId: stockStore.id,
            storeName: stockStore.name,
            qty: 0,
            type: "out_of_stock",
          },
        });
      } else if (minQty != null && qty <= minQty) {
        // 🟠 Stock bas (au-dessus de 0 mais sous le seuil min)
        await pushNotification({
          event: "low_stock",
          title: `🟠 Stock bas : ${stockItem.name}`,
          body: `"${stockItem.name}" dans "${stockStore.name}" : ${qty} restant (seuil min : ${minQty}).`,
          targetRoles: ["admin", "manager"],
          meta: {
            itemId: stockItem.id,
            itemName: stockItem.name,
            storeId: stockStore.id,
            storeName: stockStore.name,
            qty,
            minQty,
            type: "low_stock",
          },
        });
      }
    }

    res.status(201).json(created);
  } catch (error) {
    console.error("💥 ERREUR CRITIQUE mouvement:", error);

    if (error instanceof z.ZodError) {
      console.error("Erreur validation:", error.errors);
    }
    if (error) {
      console.error("Code erreur Prisma:", error);
    }

    res.status(500).json({
      error: "Erreur lors de la création du mouvement",
      ...(process.env.NODE_ENV === "development" && {
        details: String(error),
        stack: error,
      }),
    });
  }
});

r.delete("/stocks/:id", requireScope("inventory:write"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await prisma.stock.delete({ where: { id } });
    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: String(e) });
  }
});

r.get("/alerts", requireScope("inventory:read"), async (req, res) => {
  const { storeId } = req.query as any;
  const where = storeId ? { storeId: Number(storeId) } : {};
  const stocks = await prisma.stock.findMany({
    where,
    include: { item: true, store: true },
  });
  const out = stocks
    .filter((s) => (s.qty || 0) === 0)
    .map((s) => ({ id: s.id, item: s.item, store: s.store, qty: s.qty }));
  const low = stocks
    .filter((s) => (s.qty || 0) <= (s.minQty || 0) && (s.qty || 0) > 0)
    .map((s) => ({
      id: s.id,
      item: s.item,
      store: s.store,
      qty: s.qty,
      minQty: s.minQty,
    }));
  res.json({ out, low });
});

r.delete(
  "/items/:id/with-stocks",
  requireScope("inventory:write"),
  async (req, res) => {
    const itemId = Number(req.params.id);

    try {
      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.stockMovement.deleteMany({ where: { itemId } });
        await tx.stock.deleteMany({ where: { itemId } });
        await tx.orderLine.deleteMany({ where: { itemId } });
        await tx.item.delete({ where: { id: itemId } });
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error deleting item with stocks:", error);
      res.status(500).json({
        error: "Erreur lors de la suppression de l'article et de ses stocks",
        details: String(error),
      });
    }
  }
);

r.patch(
  "/stocks/:id/with-item",
  requireScope("inventory:write"),
  async (req, res) => {
    const stockId = Number(req.params.id);

    try {
      const schema = z.object({
        stock: z
          .object({
            qty: z.coerce.number().int().optional(),
            minQty: z.coerce.number().int().optional(),
            maxQty: z.coerce.number().int().optional(),
          })
          .optional(),
        item: z
          .object({
            name: z.string().optional(),
            unit: z.enum(["piece", "kg", "g", "L", "cl", "ml"]).optional(),
            vatRate: z.number().int().min(0).max(100).optional(),
            costPrice: z.number().int().min(0).optional(),
            salePriceDefault: z.number().int().min(0).optional(),
            isActive: z.boolean().optional(),
            isMenu: z.boolean().optional(),
            menuDept: z
              .enum(["hotel", "restaurant", "pub", "spa"])
              .nullable()
              .optional(),
          })
          .optional(),
      });

      const data = schema.parse(req.body);

      const stock = await prisma.stock.findUnique({
        where: { id: stockId },
        include: { item: true },
      });

      if (!stock) {
        return res.status(404).json({ error: "Stock non trouvé" });
      }

      const result = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const updates: any = {};

          if (data.stock && Object.keys(data.stock).length > 0) {
            updates.stock = await tx.stock.update({
              where: { id: stockId },
              data: data.stock,
            });
          }

          if (data.item && Object.keys(data.item).length > 0) {
            updates.item = await tx.item.update({
              where: { id: stock.itemId },
              data: data.item,
            });
          }

          return updates;
        }
      );

      res.json({
        message: "Mise à jour effectuée avec succès",
        ...result,
      });
    } catch (error) {
      console.error("Erreur lors de la mise à jour combinée:", error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Erreur de validation",
          details: error.errors,
        });
      }

      res.status(500).json({
        error: "Erreur lors de la mise à jour",
        details: String(error),
      });
    }
  }
);

export default r;