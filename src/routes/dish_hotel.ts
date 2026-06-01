import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper — Hotel store ID
// ─────────────────────────────────────────────────────────────────────────────

async function getHotelStoreId() {
  try {
    const store = await prisma.store.findFirst({
      where: { department: "hotel" },
    });
    if (!store) {
      console.warn("⚠️ Store HOTEL non trouvé en base ! Utilisation de l'ID 10 par défaut");
      return 10;
    }
    console.log(`🏨 Store HOTEL trouvé: ID ${store.id} - ${store.name}`);
    return store.id;
  } catch (error) {
    console.error("❌ Erreur récupération store HOTEL:", error);
    return 10;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ingredientSchema = z.object({
  itemId: z.number(),
  itemName: z.string(),
  quantity: z.number().min(0),
  unit: z.string(),
  cost: z.number().min(0),
  costPrice: z.number().min(0),
});

// Hotel-specific categories — breakfast, room service, events — mostly beverages and snacks
const hotelDishSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["beverage", "breakfast", "appetizer", "main_course", "dessert", "side_dish", "snack"]),
  preparationTime: z.number().min(0),
  price: z.number().min(0),
  difficulty: z.enum(["easy", "medium", "hard"]),
  isActive: z.boolean().default(true),
  ingredients: z.array(ingredientSchema),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /hotel/dishes — list all bar dishes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", requireScope("inventory:read"), async (_req, res) => {
  try {
    const dishes = await prisma.dish.findMany({
      where: { menuDept: "hotel" } as any,
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: dishes });
  } catch (error) {
    console.error("❌ Erreur GET /hotel/dishes:", error);
    // Fallback: if menuDept column doesn't exist yet, filter by category
    try {
      const dishes = await prisma.dish.findMany({
        where: {
          category: { in: ["beverage", "breakfast", "main_course"] },
        },
        orderBy: { createdAt: "desc" },
      });
      res.json({ data: dishes });
    } catch (e2) {
      res.status(500).json({ error: "Erreur serveur lors du chargement des articles hôtel." });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /hotel/dishes/for-bar — items (ingredients) available in bar stock
// ─────────────────────────────────────────────────────────────────────────────

router.get("/for-hotel", requireScope("inventory:read"), async (_req, res) => {
  try {
    const storeId = await getHotelStoreId();

    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        AND: [
          { sku: { not: { contains: "HOTEL-" } } },
          { sku: { not: { contains: "DISH-" } } },
          { sku: { not: { contains: "MENU-" } } },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        costPrice: true,
        salePriceDefault: true,
        stocks: {
          where: { storeId },
          select: { qty: true, minQty: true, maxQty: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const itemsWithStock = items.map((item) => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      costPrice: item.costPrice,
      salePriceDefault: item.salePriceDefault,
      availableQty: item.stocks[0]?.qty || 0,
      minQty: item.stocks[0]?.minQty || 0,
      maxQty: item.stocks[0]?.maxQty || 100,
    }));

    console.log(`✅ ${itemsWithStock.length} ingrédients hôtel avec stock`);
    res.json({ data: itemsWithStock });
  } catch (error) {
    console.error("❌ Erreur GET /hotel/dishes/for-bar:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /hotel/dishes — create bar dish
// ─────────────────────────────────────────────────────────────────────────────

router.post("/", requireScope("inventory:write"), async (req, res) => {
  try {
    const data = hotelDishSchema.parse(req.body);

    const created = await prisma.dish.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        preparationTime: data.preparationTime,
        price: data.price,
        difficulty: data.difficulty,
        isActive: data.isActive,
        ingredients: data.ingredients,
        menuDept: "hotel",
      } as any,
    });

    res.status(201).json({ message: "Article hôtel créé avec succès", data: created });
  } catch (error: any) {
    console.error("❌ Erreur POST /hotel/dishes:", error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return res.status(400).json({ error: "Un article avec ce nom existe déjà." });
    res.status(500).json({ error: "Erreur serveur lors de la création de l'article hôtel. Le nom est peut-être déjà utilisé." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /hotel/dishes/:id — update bar dish with stock management
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const data = hotelDishSchema.partial().parse(req.body);
    const oldDish = await prisma.dish.findUnique({ where: { id } });
    if (!oldDish) return res.status(404).json({ error: "Article hôtel introuvable" });

    const oldIngredients: any[] = oldDish.ingredients as any[];

    if (data.ingredients) {
      const storeId = await getHotelStoreId();
      const ingredientChanges = calculateIngredientChanges(oldIngredients, data.ingredients);

      for (const change of ingredientChanges.removed) {
        await prisma.stock.updateMany({
          where: { itemId: change.itemId, storeId },
          data: { qty: { increment: change.quantity } },
        });
        await prisma.stockMovement.create({
          data: {
            itemId: change.itemId,
            storeId,
            qty: change.quantity,
            type: "IN",
            reason: `Ingrédient retiré de l'article hôtel: ${oldDish.name}`,
          },
        });
      }

      for (const change of ingredientChanges.added) {
        await prisma.stock.updateMany({
          where: { itemId: change.itemId, storeId },
          data: { qty: { decrement: change.quantity } },
        });
        await prisma.stockMovement.create({
          data: {
            itemId: change.itemId,
            storeId,
            qty: change.quantity,
            type: "OUT",
            reason: `Utilisation pour article hôtel: ${data.name || oldDish.name}`,
          },
        });
      }
    }

    const updated = await prisma.dish.update({
      where: { id },
      data: {
        ...data,
        ingredients: data.ingredients ?? undefined,
        menuDept: "hotel",
      } as any,
    });

    res.json({ message: "Article hôtel mis à jour avec succès", data: updated });
  } catch (error: any) {
    console.error("❌ Erreur PATCH /hotel/dishes/:id:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
      return res.status(404).json({ error: "Article hôtel introuvable" });
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return res.status(400).json({ error: "Un article avec ce nom existe déjà." });
    res.status(500).json({ error: "Erreur serveur lors de la mise à jour de l'article hôtel." });
  }
});

// Helper: calculate ingredient diff between old and new lists
function calculateIngredientChanges(oldIngredients: any[], newIngredients: any[]) {
  const oldMap = new Map(oldIngredients.map((ing) => [ing.itemId, ing]));
  const newMap = new Map(newIngredients.map((ing) => [ing.itemId, ing]));

  const removed: any[] = [];
  const added: any[] = [];

  for (const [itemId, oldIng] of oldMap) {
    const newIng = newMap.get(itemId);
    if (!newIng) {
      removed.push(oldIng);
    } else if (newIng.quantity < oldIng.quantity) {
      removed.push({ ...oldIng, quantity: oldIng.quantity - newIng.quantity });
    }
  }

  for (const [itemId, newIng] of newMap) {
    const oldIng = oldMap.get(itemId);
    if (!oldIng) {
      added.push(newIng);
    } else if (newIng.quantity > oldIng.quantity) {
      added.push({ ...newIng, quantity: newIng.quantity - oldIng.quantity });
    }
  }

  return { removed, added };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /hotel/dishes/:id — delete bar dish and restore stock
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const dish = await prisma.dish.findUnique({
      where: { id },
      select: { id: true, name: true, ingredients: true },
    });

    if (!dish) return res.status(404).json({ error: "Article hôtel introuvable" });

    const storeId = await getHotelStoreId();
    const ingredients: any[] = dish.ingredients as any[];

    for (const ingredient of ingredients) {
      try {
        const itemExists = await prisma.item.findUnique({ where: { id: ingredient.itemId } });
        if (!itemExists) continue;

        const stockExists = await prisma.stock.findFirst({
          where: { itemId: ingredient.itemId, storeId },
        });

        if (!stockExists) {
          await prisma.stock.create({
            data: {
              storeId,
              itemId: ingredient.itemId,
              qty: ingredient.quantity,
              minQty: 0,
              maxQty: 100,
            },
          });
        } else {
          await prisma.stock.updateMany({
            where: { itemId: ingredient.itemId, storeId },
            data: { qty: { increment: ingredient.quantity } },
          });
        }

        await prisma.stockMovement.create({
          data: {
            itemId: ingredient.itemId,
            storeId,
            qty: ingredient.quantity,
            type: "IN",
            reason: `Suppression article hôtel: ${dish.name}`,
          },
        });
      } catch (ingError) {
        console.error(`❌ Erreur restauration stock ${ingredient.itemName}:`, ingError);
      }
    }

    await prisma.dish.delete({ where: { id } });

    res.status(200).json({
      message: "Article hôtel supprimé et stocks restaurés",
      data: { id, name: dish.name },
    });
  } catch (error: any) {
    console.error("❌ Erreur DELETE /hotel/dishes/:id:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return res.status(404).json({ error: "Article hôtel introuvable" });
      if (error.code === "P2003")
        return res.status(400).json({ error: "Contrainte de clé étrangère violée" });
    }
    res.status(500).json({ error: "Erreur serveur lors de la suppression de l'article hôtel." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /hotel/dishes/:id
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id", requireScope("inventory:read"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const dish = await prisma.dish.findUnique({ where: { id } });
    if (!dish) return res.status(404).json({ error: "Article hôtel introuvable" });

    res.json({ data: dish });
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;