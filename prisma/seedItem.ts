import { PrismaClient, Unit } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Début du seed...')

  const products = [
    // LEGUMES & FRUITS / VEGETABLES & FRUITS
    { name: "AIL / GARLIC", unit: "GRAMME", pricePerGram: 4 },
    { name: "GIMGEMBRE / GINGER", unit: "GRAMME", pricePerGram: 5 },
    { name: "OGNION/ ONIONS", unit: "GRAMME", pricePerGram: 4 },
    { name: "SALADE / SALADS", unit: "GRAMME", pricePerGram: 1.5 },
    { name: "HARICOT VERT / GREEN BEANS", unit: "GRAMME", pricePerGram: 1.3 },
    { name: "CAROTTE / CARROTS", unit: "GRAMME", pricePerGram: 1 },
    { name: "POMME DE TERRE/ POTATOS", unit: "GRAMME", pricePerGram: 3 },
    { name: "TOMATE / TOMATOES", unit: "GRAMME", pricePerGram: 3 },
    { name: "COURGETTE", unit: "GRAMME", pricePerGram: 1.6 },
    { name: "COCOMBRE/ CUCUMBER", unit: "GRAMME", pricePerGram: 1.6 },
    { name: "POIVRONS / BELL PEPPERS", unit: "GRAMME", pricePerGram: 2 },
    { name: "PERSIL / PARSLEY", unit: "GRAMME", pricePerGram: 0.5 },
    { name: "TONGOLO MAINTSO / GREEN ONIONS", unit: "GRAMME", pricePerGram: 0.5 },
    { name: "MANGUE/ MANGO", unit: "GRAMME", pricePerGram: 3 },
    { name: "ANANAS / PINEAPPLE", unit: "GRAMME", pricePerGram: 5 },
    { name: "BANANE / BANANA", unit: "GRAMME", pricePerGram: 2 },
    { name: "AVOCAT / AVOCADO", unit: "GRAMME", pricePerGram: 3 },
    { name: "CITRON", unit: "GRAMME", pricePerGram: 4 },
    { name: "PIMENT", unit: "GRAMME", pricePerGram: 2 },
    { name: "POTIRON / PUMPKIN", unit: "GRAMME", pricePerGram: 9 },

    // VIANDE / MEAT
    { name: "BLANC DE POULET / CHICKEN BREAST", unit: "GRAMME", pricePerGram: 19 },
    { name: "POULET GASY / CHICKEN MALAGASY", unit: "GRAMME", pricePerGram: 23 },
    { name: "FILET STEAK", unit: "GRAMME", pricePerGram: 23 },
    { name: "VIANDE HACHEE / MINCED MEAT", unit: "GRAMME", pricePerGram: 20 },
    { name: "LANGUE DE ZEBU / TONGUE BEEF", unit: "GRAMME", pricePerGram: 20 },
    { name: "TRIPES ZEBU", unit: "GRAMME", pricePerGram: 12 },
    { name: "AGNEAU / LAMB", unit: "GRAMME", pricePerGram: 23 },
    { name: "SAUCISSES / SAUSSAGES", unit: "GRAMME", pricePerGram: 20 },
    { name: "MAGRET DE CANARD", unit: "GRAMME", pricePerGram: 65 },
    { name: "FOIS GRAS", unit: "GRAMME", pricePerGram: 75 },
    { name: "VIANDE BURGER / BUGER MEAT", unit: "GRAMME", pricePerGram: 20 },

    // POISSON / FISH
    { name: "TILAPIA", unit: "GRAMME", pricePerGram: 25 },
    { name: "CALAMAR", unit: "GRAMME", pricePerGram: 40 },
    { name: "CREVETTE / PRAWNS", unit: "GRAMME", pricePerGram: 40 },

    // PRODUIT LAITIERS / DAIRY
    { name: "LAIT CARTON / BOXED MILK", unit: "CENTILITRE", pricePerGram: 6.9 },
    { name: "LAIT FRAIS / FRESH MILK", unit: "CENTILITRE", pricePerGram: 2.5 },
    { name: "LAIT CONCENTREE / CONDENSED MILK", unit: "CENTILITRE", pricePerGram: 4.8 },
    { name: "LAIT POUDRE / POWDER MILK", unit: "GRAMME", pricePerGram: 0 },
    { name: "BEURE CUISSON / COOKING BUTTER", unit: "GRAMME", pricePerGram: 2.8 },
    { name: "BEURE CLIENT / GUEST BUTTER", unit: "GRAMME", pricePerGram: 6.2 },
    { name: "YAOURT PARFUMEE / ASSORTED YOGURT", unit: "PIECE", pricePerGram: 1.1 },
    { name: "YAOURT NATURE / NATURAL YOGURT", unit: "PIECE", pricePerGram: 1.1 },
    { name: "FROMAGE / CHEESE", unit: "GRAMME", pricePerGram: 25 },
    { name: "CHEDDAR FROMAGE / CHEDDAR CHEESE", unit: "PIECE", pricePerGram: 12 },
    { name: "OEUFS/ EGGS", unit: "PIECE", pricePerGram: 0.5 },

    // AUTRE / OTHERS
    { name: "LIQUIDE VAISELLE/ DISH SOAP", unit: "CENTILITRE", pricePerGram: 16 },
    { name: "GAS", unit: "PIECE", pricePerGram: 100 },
    { name: "SPONGE / EPONGE", unit: "PIECE", pricePerGram: 5 },
    { name: "BLOOM", unit: "PIECE", pricePerGram: 2 },
    { name: "CHARBON / CHARCOAL", unit: "PIECE", pricePerGram: 30 },
    { name: "PAPIER FILM", unit: "PIECE", pricePerGram: 5 },

    // EPICERIE / NON PERISHABLE
    { name: "CAFE/ COFFEE", unit: "PIECE", pricePerGram: 1.5 },
    { name: "SUCRE / SUGAR", unit: "GRAMME", pricePerGram: 4.5 },
    { name: "CONFITURE/ JAM", unit: "PIECE", pricePerGram: 5.2 },
    { name: "MINI CHOCO PQ10", unit: "PIECE", pricePerGram: 3.5 },
    { name: "POWDER CHOCOLATE", unit: "PIECE", pricePerGram: 6 },
    { name: "DANICA RED", unit: "CENTILITRE", pricePerGram: 20 },
    { name: "DANICA BLEU", unit: "CENTILITRE", pricePerGram: 20 },
    { name: "RIZ / RICE", unit: "GRAMME", pricePerGram: 3.2 },
    { name: "FARINE/ FLOUR", unit: "GRAMME", pricePerGram: 3.8 },
    { name: "SPAGHETTI", unit: "GRAMME", pricePerGram: 3.5 },
    { name: "PATTE DE NEMS / NEM SHEET", unit: "PIECE", pricePerGram: 2 },
    { name: "CHAPELURE / BREAD CRUMBS", unit: "PIECE", pricePerGram: 1.5 },
    { name: "MAGIMIX", unit: "GRAMME", pricePerGram: 19 },
    { name: "MAYONNAISE", unit: "PIECE", pricePerGram: 7 },
    { name: "BOITE DE TOMATE / TOMATO PASTE", unit: "PIECE", pricePerGram: 0.99 },
    { name: "SAUCE HUITRE/ OYSTER SAUCE", unit: "PIECE", pricePerGram: 11 },
    { name: "CARRY", unit: "PIECE", pricePerGram: 2 },
    { name: "POIVRE NOIR / BLACK PEPPER", unit: "PIECE", pricePerGram: 2 },
    { name: "SAUCE SOJA / SOYA SAUCE", unit: "PIECE", pricePerGram: 9.8 },
    { name: "EPICE VERTE / GREEN SPICES", unit: "PIECE", pricePerGram: 2 },
    { name: "MASSALA", unit: "PIECE", pricePerGram: 2 },
    { name: "HUILE / OIL", unit: "CENTILITRE", pricePerGram: 10.1 },
    { name: "OLIVE OIL", unit: "CENTILITRE", pricePerGram: 25.99 },
    { name: "PIZZA OIL", unit: "CENTILITRE", pricePerGram: 11.99 },
    { name: "LAIT COCO", unit: "CENTILITRE", pricePerGram: 4.59 },
    { name: "SEL / SALT", unit: "GRAMME", pricePerGram: 1 },
    { name: "VINAGRE / VINEGAR", unit: "CENTILITRE", pricePerGram: 1 },
    { name: "THE VERT / TEA GREEN", unit: "PIECE", pricePerGram: 4.39 },
    { name: "THE NOIR / TEA BLACK", unit: "PIECE", pricePerGram: 4.39 },
    { name: "HAMBURGER BREAD", unit: "PIECE", pricePerGram: 3.9 },
    { name: "CHAMPIGNON CAN / CANNED MUSHROOM", unit: "PIECE", pricePerGram: 2.5 },
    { name: "MOUTARDE / MUSTARD", unit: "PIECE", pricePerGram: 9 },
    { name: "PAPRIKA", unit: "PIECE", pricePerGram: 2 },
    { name: "PARFUM GATEAU - CHOCO", unit: "PIECE", pricePerGram: 2 },
    { name: "PARFUM GATEAU - MAGUE", unit: "PIECE", pricePerGram: 2 },
    { name: "PARFUM GATEAU - VANILLE", unit: "PIECE", pricePerGram: 2 },
    { name: "PARFUM GATEAU - FRAISE", unit: "PIECE", pricePerGram: 2 },
    { name: "LEVURE CHIMIQUE", unit: "PIECE", pricePerGram: 5 },
    { name: "LEVURE BOULANGER", unit: "PIECE", pricePerGram: 5 },
    { name: "RAISIN SEC", unit: "PIECE", pricePerGram: 9 },
    { name: "BISCUIT OREO", unit: "PIECE", pricePerGram: 17 },
    { name: "BISCUIT BOUDOIR", unit: "PIECE", pricePerGram: 12.99 },
    { name: "LEVURE BOULANGERE", unit: "PIECE", pricePerGram: 5.2 },
    { name: "MIEL / HONEY", unit: "CENTILITRE", pricePerGram: 10 },
    { name: "PEANUTS", unit: "GRAMME", pricePerGram: 3.39 },

    // PRE CUIT/ PRE COOKED
    { name: "SAMOSA", unit: "PIECE", pricePerGram: 2500 },
    { name: "NEMS", unit: "PIECE", pricePerGram: 2500 },
    { name: "APPLE PIE", unit: "PIECE", pricePerGram: 22000 },
    { name: "CHEESECAKE", unit: "PIECE", pricePerGram: 18000 },
    { name: "TIRAMISU", unit: "PIECE", pricePerGram: 25000 },
    { name: "MOUSSE AU CHOCOLAT", unit: "PIECE", pricePerGram: 18000 },
    { name: "PAIN", unit: "PIECE", pricePerGram: 3000 },
    { name: "CROISSANT", unit: "PIECE", pricePerGram: 3000 },
    { name: "PAIN AU CHOCO", unit: "PIECE", pricePerGram: 3000 }
  ]

  console.log(`Nombre total de produits à insérer : ${products.length}`)

  let insertedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const product of products) {
    // Conversion de l'unité en enum Unit selon le schéma Prisma
    let unit: Unit
    switch (product.unit) {
      case 'GRAMME':
        unit = Unit.g
        break
      case 'CENTILITRE':
        unit = Unit.cl
        break
      case 'PIECE':
        unit = Unit.piece
        break
      default:
        console.warn(`Unité inconnue pour ${product.name}: ${product.unit}, utilisation de piece par défaut`)
        unit = Unit.piece
    }

    // Génération d'un SKU à partir du nom
    const skuBase = product.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .toUpperCase()
    
    const sku = `ITEM_${skuBase}_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`

    try {
      // Vérifier si un item avec le même nom existe déjà
      const existingItem = await prisma.item.findFirst({
        where: {
          name: product.name
        }
      })

      if (existingItem) {
        console.log(`⚠️  Item "${product.name}" existe déjà, ignoré`)
        skippedCount++
        continue
      }

      // Créer l'item avec le prix par gramme
      await prisma.item.create({
        data: {
          sku: sku,
          name: product.name,
          unit: unit,
          vatRate: 20,
          costPrice: Math.round(product.pricePerGram * 100) / 100, // Prix par gramme
          salePriceDefault: Math.round(product.pricePerGram * 100) / 100, // Prix par gramme
          isActive: true,
          isMenu: false,
        }
      })

      console.log(`✅ Item créé: ${product.name} (${product.pricePerGram} MGA/unité)`)
      insertedCount++

    } catch (error) {
      console.error(`❌ Erreur lors de la création de ${product.name}:`, error)
      errorCount++
    }
  }

  console.log('\n=== RÉSUMÉ ===')
  console.log(`Total produits: ${products.length}`)
  console.log(`Insérés: ${insertedCount}`)
  console.log(`Ignorés (déjà existants): ${skippedCount}`)
  console.log(`Erreurs: ${errorCount}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })