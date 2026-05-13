import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireScope } from "../middleware/requireScope";
import { Prisma } from "@prisma/client";

const router = Router();

/* --------------------------------------------------------
 * 🧩 Schemas de validation
 * -------------------------------------------------------- */
const ingredientSchema = z.object({
  itemId: z.number(),
  itemName: z.string(),
  quantity: z.number().min(0),
  unit: z.string(),
  cost: z.number().min(0),
  costPrice: z.number().min(0),
});

const dishSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["appetizer", "main_course", "dessert", "beverage", "side_dish"]),
  preparationTime: z.number().min(1),
  price: z.number().min(0),
  difficulty: z.enum(["easy", "medium", "hard"]),
  isActive: z.boolean().default(true),
  ingredients: z.array(ingredientSchema),
});

/* --------------------------------------------------------
 * 🍽️ GET /dishes — liste tous les plats
 * -------------------------------------------------------- */
router.get("/", requireScope("inventory:read"), async (_req, res) => {
  try {
    const dishes = await prisma.dish.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: dishes });
  } catch (error) {
    console.error("❌ Erreur GET /dishes :", error);
    res.status(500).json({ error: "Erreur serveur lors du chargement des plats." });
  }
});

/* --------------------------------------------------------
 * 🧾 GET /dishes/for-dishes — liste les articles utilisables AVEC STOCKS
 * -------------------------------------------------------- */
router.get("/for-dishes", requireScope("inventory:read"), async (_req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        costPrice: true,
        salePriceDefault: true,
        stocks: {
          select: {
            qty: true,
            store: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
    });

    // Formater la réponse pour inclure le stock total
    const itemsWithStock = items.map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      costPrice: item.costPrice,
      salePriceDefault: item.salePriceDefault,
      currentStock: item.stocks.reduce((total, stock) => total + stock.qty, 0),
      stocks: item.stocks
    }));

    res.json({ data: itemsWithStock });
  } catch (error) {
    console.error("❌ Erreur GET /dishes/for-dishes :", error);
    res.status(500).json({ error: "Erreur serveur lors du chargement des articles." });
  }
});

/* --------------------------------------------------------
 * ➕ POST /dishes — créer un plat ET DÉDUIRE LES STOCKS
 * -------------------------------------------------------- */
router.post("/", requireScope("inventory:write"), async (req, res) => {
  try {
    const data = dishSchema.parse(req.body);

    // Vérifier les stocks disponibles AVANT de créer le plat
    for (const ingredient of data.ingredients) {
      const stock = await prisma.stock.findFirst({
        where: { 
          itemId: ingredient.itemId,
          storeId: 1 // Store par défaut
        }
      });

      if (!stock) {
        return res.status(400).json({ 
          error: `Article ${ingredient.itemName} non trouvé en stock` 
        });
      }

      if (stock.qty < ingredient.quantity) {
        return res.status(400).json({ 
          error: `Stock insuffisant pour ${ingredient.itemName}. Disponible: ${stock.qty}, Requis: ${ingredient.quantity}` 
        });
      }
    }

    // Créer le plat
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
      },
    });

    // DÉDUIRE LES STOCKS après création réussie du plat
    for (const ingredient of data.ingredients) {
      // 1. Mettre à jour le stock
      await prisma.stock.updateMany({
        where: { 
          itemId: ingredient.itemId,
          storeId: 1
        },
        data: {
          qty: { decrement: ingredient.quantity }
        }
      });

      // 2. Enregistrer le mouvement de stock
      await prisma.stockMovement.create({
        data: {
          itemId: ingredient.itemId,
          storeId: 1,
          qty: ingredient.quantity,
          type: "OUT",
          reason: `Utilisation pour plat: ${data.name}`
        }
      });
    }

    res.status(201).json({ 
      message: "Plat créé avec succès et stocks mis à jour", 
      data: created 
    });

  } catch (error: any) {
    console.error("❌ Erreur POST /dishes :", error);
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    if (error.code === "P2002")
      return res.status(400).json({ error: "Un plat avec ce nom existe déjà." });
    res.status(500).json({ error: "Erreur serveur lors de la création du plat." });
  }
});

/* --------------------------------------------------------
 * ✏️ PATCH /dishes/:id — modifier un plat AVEC GESTION DES STOCKS
 * -------------------------------------------------------- */
router.patch("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const data = dishSchema.partial().parse(req.body);

    // Récupérer l'ancien plat
    const oldDish = await prisma.dish.findUnique({ where: { id } });
    if (!oldDish) return res.status(404).json({ error: "Plat introuvable" });

    // Si modification des ingrédients, gérer les stocks
    if (data.ingredients) {
      const oldIngredients: any[] = oldDish.ingredients as any[];
      
      // Restaurer les anciens stocks
      for (const oldIng of oldIngredients) {
        await prisma.stock.updateMany({
          where: { itemId: oldIng.itemId, storeId: 1 },
          data: { qty: { increment: oldIng.quantity } }
        });
        
        await prisma.stockMovement.create({
          data: {
            itemId: oldIng.itemId,
            storeId: 1,
            qty: oldIng.quantity,
            type: "IN",
            reason: `Annulation plat modifié: ${oldDish.name}`
          }
        });
      }

      // Déduire les nouveaux stocks
      for (const newIng of data.ingredients) {
        const stock = await prisma.stock.findFirst({
          where: { itemId: newIng.itemId, storeId: 1 }
        });

        if (!stock || stock.qty < newIng.quantity) {
          return res.status(400).json({ 
            error: `Stock insuffisant pour ${newIng.itemName}` 
          });
        }

        await prisma.stock.updateMany({
          where: { itemId: newIng.itemId, storeId: 1 },
          data: { qty: { decrement: newIng.quantity } }
        });

        await prisma.stockMovement.create({
          data: {
            itemId: newIng.itemId,
            storeId: 1,
            qty: newIng.quantity,
            type: "OUT",
            reason: `Utilisation pour plat: ${data.name || oldDish.name}`
          }
        });
      }
    }

    const updated = await prisma.dish.update({
      where: { id },
      data: {
        ...data,
        ingredients: data.ingredients ?? undefined,
      },
    });

    res.json({ message: "Plat mis à jour avec gestion des stocks", data: updated });
  } catch (error: any) {
    console.error("❌ Erreur PATCH /dishes/:id :", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
      return res.status(404).json({ error: "Plat introuvable" });
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    res.status(500).json({ error: "Erreur serveur lors de la mise à jour du plat." });
  }
});

/* --------------------------------------------------------
 * 🗑️ DELETE /dishes/:id — supprimer un plat ET RESTAURER LES STOCKS
 * -------------------------------------------------------- */
router.delete("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    // Récupérer le plat avant suppression
    const dish = await prisma.dish.findUnique({ where: { id } });
    if (!dish) return res.status(404).json({ error: "Plat introuvable" });

    // Restaurer les stocks
    const ingredients: any[] = dish.ingredients as any[];
    for (const ingredient of ingredients) {
      await prisma.stock.updateMany({
        where: { itemId: ingredient.itemId, storeId: 1 },
        data: { qty: { increment: ingredient.quantity } }
      });

      await prisma.stockMovement.create({
        data: {
          itemId: ingredient.itemId,
          storeId: 1,
          qty: ingredient.quantity,
          type: "IN",
          reason: `Suppression plat: ${dish.name}`
        }
      });
    }

    // Supprimer le plat
    await prisma.dish.delete({ where: { id } });
    res.status(200).json({ message: "Plat supprimé et stocks restaurés" });
  } catch (error: any) {
    console.error("❌ Erreur DELETE /dishes/:id :", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
      return res.status(404).json({ error: "Plat introuvable" });
    res.status(500).json({ error: "Erreur serveur lors de la suppression du plat." });
  }
});

export default router;