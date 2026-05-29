import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper — Bar store ID
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
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ingredientSchema = z.object({
  itemId: z.number(),
  itemName: z.string(),
  quantity: z.number().min(0),
  unit: z.string(),
  // Accepte string OU number depuis le frontend, convertit toujours en number
  cost: z.preprocess((v) => Number(v), z.number().min(0)),
  costPrice: z.preprocess((v) => Number(v), z.number().min(0)),
});

// Bar-specific categories — mostly beverages and snacks
const barDishSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["beverage", "appetizer", "snack", "dessert", "main_course", "side_dish"]),
  preparationTime: z.number().min(0),
  price: z.number().min(0),
  difficulty: z.enum(["easy", "medium", "hard"]),
  isActive: z.boolean().default(true),
  ingredients: z.array(ingredientSchema),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /bar/dishes — list all bar dishes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", requireScope("inventory:read"), async (_req, res) => {
  try {
    const dishes = await prisma.dish.findMany({
      where: { menuDept: "lounge" },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: dishes });
  } catch (error) {
    console.error("❌ Erreur GET /bar/dishes:", error);
    res.status(500).json({ error: "Erreur serveur lors du chargement des articles bar." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /bar/dishes/for-bar — items (ingredients) available in bar stock
// ─────────────────────────────────────────────────────────────────────────────

router.get("/for-bar", requireScope("inventory:read"), async (_req, res) => {
  try {
    const storeId = await getBarStoreId();

    const items = await prisma.item.findMany({
      where: {
        isActive: true,
        AND: [
          { sku: { not: { contains: "BAR-" } } },
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
      // Convertir Decimal → number pour éviter le problème "costPrice: '200'" côté frontend
      costPrice: Number(item.costPrice),
      salePriceDefault: Number(item.salePriceDefault),
      availableQty: item.stocks[0]?.qty || 0,
      minQty: item.stocks[0]?.minQty || 0,
      maxQty: item.stocks[0]?.maxQty || 100,
    }));

    console.log(`✅ ${itemsWithStock.length} ingrédients bar avec stock`);
    res.json({ data: itemsWithStock });
  } catch (error) {
    console.error("❌ Erreur GET /bar/dishes/for-bar:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bar/dishes — create bar dish
// ─────────────────────────────────────────────────────────────────────────────

router.post("/", requireScope("inventory:write"), async (req, res) => {
  try {
    const data = barDishSchema.parse(req.body);

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
        menuDept: "lounge",
      },
    });

    res.status(201).json({ message: "Article bar créé avec succès", data: created });
  } catch (error: any) {
    console.error("❌ Erreur POST /bar/dishes:", error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    res.status(500).json({ error: "Erreur serveur lors de la création de l'article bar. Le nom de L'aritcle existe déjà." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /bar/dishes/:id — update bar dish with stock management
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const data = barDishSchema.partial().parse(req.body);
    const oldDish = await prisma.dish.findUnique({ where: { id } });
    if (!oldDish) return res.status(404).json({ error: "Article bar introuvable" });

    const oldIngredients: any[] = oldDish.ingredients as any[];

    if (data.ingredients) {
      const storeId = await getBarStoreId();
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
            reason: `Ingrédient retiré de l'article bar: ${oldDish.name}`,
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
            reason: `Utilisation pour article bar: ${data.name || oldDish.name}`,
          },
        });
      }
    }

    const updated = await prisma.dish.update({
      where: { id },
      data: {
        ...data,
        ingredients: data.ingredients ?? undefined,
        menuDept: "lounge",
      },
    });

    res.json({ message: "Article bar mis à jour avec succès", data: updated });
  } catch (error: any) {
    console.error("❌ Erreur PATCH /bar/dishes/:id:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
      return res.status(404).json({ error: "Article bar introuvable" });
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    res.status(500).json({ error: "Erreur serveur lors de la mise à jour de l'article bar. Le nom de l'article existe déjà." });
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
// DELETE /bar/dishes/:id — delete bar dish and restore stock
// ─────────────────────────────────────────────────────────────────────────────

router.delete("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const dish = await prisma.dish.findUnique({
      where: { id },
      select: { id: true, name: true, ingredients: true },
    });

    if (!dish) return res.status(404).json({ error: "Article bar introuvable" });

    const storeId = await getBarStoreId();
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
            reason: `Suppression article bar: ${dish.name}`,
          },
        });
      } catch (ingError) {
        console.error(`❌ Erreur restauration stock ${ingredient.itemName}:`, ingError);
      }
    }

    await prisma.dish.delete({ where: { id } });

    res.status(200).json({
      message: "Article bar supprimé et stocks restaurés",
      data: { id, name: dish.name },
    });
  } catch (error: any) {
    console.error("❌ Erreur DELETE /bar/dishes/:id:", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return res.status(404).json({ error: "Article bar introuvable" });
      if (error.code === "P2003")
        return res.status(400).json({ error: "Contrainte de clé étrangère violée" });
    }
    res.status(500).json({ error: "Erreur serveur lors de la suppression de l'article bar." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /bar/dishes/:id
// ─────────────────────────────────────────────────────────────────────────────

router.get("/:id", requireScope("inventory:read"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const dish = await prisma.dish.findUnique({ where: { id } });
    if (!dish) return res.status(404).json({ error: "Article bar introuvable" });

    res.json({ data: dish });
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;