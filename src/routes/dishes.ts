import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

const router = Router();

// Fonction utilitaire pour obtenir l'ID du store RESTAURANT
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
  category: z.enum(["appetizer", "main_course", "dessert", "beverage", "side_dish","dejeuner", "snack"]),
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
    const storeId = await getRestaurantStoreId();

    const items = await prisma.item.findMany({
      where: { 
        isActive: true,
        AND: [
          { sku: { not: { contains: 'DISH-' } } },
          { sku: { not: { contains: 'MENU-' } } }
        ]
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        costPrice: true,
        salePriceDefault: true,
        stocks: {
          where: { storeId: storeId }, // 👈 Utilisation dynamique
          select: {
            qty: true,
            minQty: true,
            maxQty: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // ✅ Formater avec le stock disponible
    const itemsWithStock = items.map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      costPrice: item.costPrice,
      salePriceDefault: item.salePriceDefault,
      availableQty: item.stocks[0]?.qty || 0, // Stock disponible
      minQty: item.stocks[0]?.minQty || 0,
      maxQty: item.stocks[0]?.maxQty || 100
    }));

    console.log(`✅ ${itemsWithStock.length} ingrédients avec stock`);
    res.json({ data: itemsWithStock });
  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* --------------------------------------------------------
 * ➕ POST /dishes — créer un plat 
 * -------------------------------------------------------- */
router.post("/", requireScope("inventory:write"), async (req, res) => {
  try {
    const data = dishSchema.parse(req.body);

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

    res.status(201).json({ 
      message: "Plat créé avec succès", 
      data: created 
    });

  } catch (error: any) {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
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

    const oldIngredients: any[] = oldDish.ingredients as any[];

    // ✅ GESTION INTELLIGENTE - Seulement si les ingrédients changent
    if (data.ingredients) {
      console.log('🔄 Modification des ingrédients détectée');
      
      // 1. Calculer les DIFFÉRENCES entre anciens et nouveaux ingrédients
      const ingredientChanges = calculateIngredientChanges(oldIngredients, data.ingredients);
      
      // 2. RESTAURER seulement ce qui a été retiré ou modifié
      for (const change of ingredientChanges.removed) {
        console.log(`📥 Restauration: ${change.itemName} +${change.quantity}`);
        
        await prisma.stock.updateMany({
          where: { itemId: change.itemId, storeId: 1 },
          data: { qty: { increment: change.quantity } }
        });
        
        await prisma.stockMovement.create({
          data: {
            itemId: change.itemId,
            storeId: 1,
            qty: change.quantity,
            type: "IN",
            reason: `Ingrédient retiré du plat: ${oldDish.name}`
          }
        });
      }

      // 3. DÉDUIRE les nouveaux ingrédients (même si stock insuffisant)
      for (const change of ingredientChanges.added) {
        console.log(`📤 Déduction: ${change.itemName} -${change.quantity}`);
        
        await prisma.stock.updateMany({
          where: { itemId: change.itemId, storeId: 1 },
          data: { qty: { decrement: change.quantity } }
        });

        await prisma.stockMovement.create({
          data: {
            itemId: change.itemId,
            storeId: 1,
            qty: change.quantity,
            type: "OUT",
            reason: `Utilisation pour plat: ${data.name || oldDish.name}`
          }
        });
      }
    }

    // Mise à jour du plat
    const updated = await prisma.dish.update({
      where: { id },
      data: {
        ...data,
        ingredients: data.ingredients ?? undefined,
      },
    });

    res.json({ message: "Plat mis à jour avec succès", data: updated });
    
  } catch (error: any) {
    console.error("❌ Erreur PATCH /dishes/:id :", error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025")
      return res.status(404).json({ error: "Plat introuvable" });
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: "Validation échouée", details: error.errors });
    res.status(500).json({ error: "Erreur serveur lors de la mise à jour du plat." });
  }
});

// ✅ FONCTION POUR CALCULER LES DIFFÉRENCES
function calculateIngredientChanges(oldIngredients: any[], newIngredients: any[]) {
  const oldMap = new Map(oldIngredients.map(ing => [ing.itemId, ing]));
  const newMap = new Map(newIngredients.map(ing => [ing.itemId, ing]));

  const removed = [];
  const added = [];

  // Ingédients retirés ou modifiés (quantité réduite)
  for (const [itemId, oldIng] of oldMap) {
    const newIng = newMap.get(itemId);
    
    if (!newIng) {
      // Ingredient complètement retiré
      removed.push(oldIng);
    } else if (newIng.quantity < oldIng.quantity) {
      // Quantité réduite - on restaure la différence
      removed.push({
        ...oldIng,
        quantity: oldIng.quantity - newIng.quantity
      });
    }
  }

  // Nouveaux ingrédients ou quantités augmentées
  for (const [itemId, newIng] of newMap) {
    const oldIng = oldMap.get(itemId);
    
    if (!oldIng) {
      // Nouvel ingrédient
      added.push(newIng);
    } else if (newIng.quantity > oldIng.quantity) {
      // Quantité augmentée - on déduit la différence
      added.push({
        ...newIng,
        quantity: newIng.quantity - oldIng.quantity
      });
    }
  }

  return { removed, added };
}

/* --------------------------------------------------------
 * 🗑️ DELETE /dishes/:id — supprimer un plat ET RESTAURER LES STOCKS
 * -------------------------------------------------------- */
router.delete("/:id", requireScope("inventory:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    console.log(`🗑️ DELETE /dishes/${id} - Début`);

    if (isNaN(id)) {
      console.log('❌ ID invalide:', req.params.id);
      return res.status(400).json({ error: "ID invalide" });
    }

    // Récupérer le plat avant suppression
    const dish = await prisma.dish.findUnique({ 
      where: { id },
      select: {
        id: true,
        name: true,
        ingredients: true
      }
    });
    
    if (!dish) {
      console.log('❌ Plat non trouvé ID:', id);
      return res.status(404).json({ error: "Plat introuvable" });
    }

    console.log('📋 Plat à supprimer:', dish.name);
    console.log('🧾 Ingrédients:', dish.ingredients);

    // Restaurer les stocks
    const ingredients: any[] = dish.ingredients as any[];
    console.log(`🔄 Restauration de ${ingredients.length} ingrédients`);

    for (const [index, ingredient] of ingredients.entries()) {
      console.log(`📥 ${index + 1}. ${ingredient.itemName}: +${ingredient.quantity} ${ingredient.unit}`);
      
      try {
        // Vérifier si l'item existe encore
        const itemExists = await prisma.item.findUnique({
          where: { id: ingredient.itemId }
        });

        if (!itemExists) {
          console.log(`⚠️ Item ${ingredient.itemId} n'existe plus, skip`);
          continue;
        }

        // Vérifier si le stock existe
        const stockExists = await prisma.stock.findFirst({
          where: { 
            itemId: ingredient.itemId, 
            storeId: 1 
          }
        });

        if (!stockExists) {
          console.log(`📦 Création stock pour ${ingredient.itemName}`);
          await prisma.stock.create({
            data: {
              storeId: 1,
              itemId: ingredient.itemId,
              qty: ingredient.quantity, // On remet la quantité
              minQty: 0,
              maxQty: 100
            }
          });
        } else {
          // Mettre à jour le stock existant
          const stockBefore = await prisma.stock.findFirst({
            where: { itemId: ingredient.itemId, storeId: 1 }
          });

          const updateResult = await prisma.stock.updateMany({
            where: { 
              itemId: ingredient.itemId, 
              storeId: 1 
            },
            data: { 
              qty: { increment: ingredient.quantity } 
            }
          });

          const stockAfter = await prisma.stock.findFirst({
            where: { itemId: ingredient.itemId, storeId: 1 }
          });

          console.log(`📊 Stock ${ingredient.itemName}: ${stockBefore?.qty} → ${stockAfter?.qty}`);
        }

        // Enregistrer le mouvement
        await prisma.stockMovement.create({
          data: {
            itemId: ingredient.itemId,
            storeId: 1,
            qty: ingredient.quantity,
            type: "IN",
            reason: `Suppression plat: ${dish.name}`
          }
        });

        console.log(`✅ ${ingredient.itemName} restauré`);

      } catch (ingError) {
        console.error(`❌ Erreur avec ${ingredient.itemName}:`, ingError);
        // Continuer avec les autres ingrédients même si un échoue
      }
    }

    // Supprimer le plat
    console.log('🗑️ Suppression du plat...');
    await prisma.dish.delete({ where: { id } });
    
    console.log('🎉 Plat supprimé avec succès');
    res.status(200).json({ 
      message: "Plat supprimé et stocks restaurés",
      data: { id, name: dish.name }
    });

  } catch (error: any) {
    console.error("❌ Erreur DELETE /dishes/:id :", error);
    
    // Log détaillé de l'erreur
    console.error("🔍 Détails erreur:", {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack
    });

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.log('📌 Erreur Prisma:', error.code);
      
      if (error.code === "P2025") {
        return res.status(404).json({ error: "Plat introuvable" });
      }
      
      if (error.code === "P2003") {
        return res.status(400).json({ error: "Contrainte de clé étrangère violée" });
      }
    }

    res.status(500).json({ 
      error: "Erreur serveur lors de la suppression du plat.",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* --------------------------------------------------------
 * 📊 GET /dishes/:id — récupérer un plat spécifique
 * -------------------------------------------------------- */
router.get("/:id", requireScope("inventory:read"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });

    const dish = await prisma.dish.findUnique({ where: { id } });
    if (!dish) return res.status(404).json({ error: "Plat introuvable" });

    res.json({ data: dish });
  } catch (error) {
    console.error("❌ Erreur GET /dishes/:id :", error);
    res.status(500).json({ error: "Erreur serveur lors du chargement du plat." });
  }
});

export default router;