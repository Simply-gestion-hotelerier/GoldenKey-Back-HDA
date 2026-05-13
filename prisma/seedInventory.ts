import { PrismaClient, Unit, Department, StockMoveType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Début du seed pour les boissons...')

  const products = [
    // STAR PM (Petite bouteille)
    { name: "GRENADINE 30CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "FANTA 30 CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "BONBON ANGLAIS 30 CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "WORLD COLA 30 CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "TONIC 30 CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "CRYSTAL 50 CL", unit: "CENTILITRE", price: 1050, category: "STAR PM" },
    { name: "COCA COLA PLASTIQUE", unit: "CENTILITRE", price: 2000, category: "STAR PM" },

    // STAR GM (Grande bouteille)
    { name: "GRENADINE 100 CL", unit: "CENTILITRE", price: 2616, category: "STAR GM" },
    { name: "FANTA 100 CL", unit: "CENTILITRE", price: 2616, category: "STAR GM" },
    { name: "BONBON ANGLAIS 100 CL", unit: "CENTILITRE", price: 2616, category: "STAR GM" },
    { name: "WORLD COLA 100 CL", unit: "CENTILITRE", price: 2616, category: "STAR GM" },

    // BEER
    { name: "GOLD BLONDE 50CL", unit: "CENTILITRE", price: 3840, category: "BEER" },
    { name: "GOLD BLANCHE 50 CL", unit: "CENTILITRE", price: 3840, category: "BEER" },
    { name: "GOLD N8 50 CL", unit: "CENTILITRE", price: 3840, category: "BEER" },
    { name: "BEAUFORT 35 CL", unit: "CENTILITRE", price: 3480, category: "BEER" },
    { name: "THB 65 CL", unit: "CENTILITRE", price: 3900, category: "BEER" },
    { name: "FRESH 65 CL", unit: "CENTILITRE", price: 3600, category: "BEER" },

    // WHISKY
    { name: "J&B 100 CL", unit: "CENTILITRE", price: 80000, category: "WHISKY" },
    { name: "BALLANTINES 100 CL", unit: "CENTILITRE", price: 140000, category: "WHISKY" },
    { name: "ABERLOUR 70 CL", unit: "CENTILITRE", price: 280000, category: "WHISKY" },
    { name: "HIGHLAND QUEEN 100 CL", unit: "CENTILITRE", price: 100000, category: "WHISKY" },
    { name: "DEWARS 100 CL", unit: "CENTILITRE", price: 150000, category: "WHISKY" },
    { name: "JACK DANIELS 100 CL", unit: "CENTILITRE", price: 250000, category: "WHISKY" },
    { name: "RED LABEL", unit: "CENTILITRE", price: 100000, category: "WHISKY" },
    { name: "BLACK LABEL", unit: "CENTILITRE", price: 165000, category: "WHISKY" },
    { name: "GOLD LABEL", unit: "CENTILITRE", price: 325000, category: "WHISKY" },
    { name: "CUVE NOIR", unit: "CENTILITRE", price: 80000, category: "WHISKY" },

    // WINE BOTTLE
    { name: "INTERNATIONAL RED", unit: "CENTILITRE", price: 30000, category: "WINE" },
    { name: "INTERNATIONAL WHITE", unit: "CENTILITRE", price: 30000, category: "WINE" },
    { name: "SPARKLING WINE", unit: "CENTILITRE", price: 30000, category: "WINE" },
    { name: "ROSE", unit: "CENTILITRE", price: 30000, category: "WINE" },
    { name: "MALAGASY RED", unit: "CENTILITRE", price: 26490, category: "WINE" },
    { name: "MALAGASY WHITE", unit: "CENTILITRE", price: 21890, category: "WINE" },

    // OTHERS
    { name: "EAU / WATER 150CL", unit: "CENTILITRE", price: 2300, category: "OTHERS" },
    { name: "ABSOLUT VODKA 70 CL", unit: "CENTILITRE", price: 70000, category: "OTHERS" },
    { name: "GIN HARPOON 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "SAMBO 100 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "PASTIS 100 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "COULEUR CAFE 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "CLIPPERS CASSIS 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "CLIPPERS LITCHI 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "DZAMA LIQUEUR BLEU 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "SIROP MENTHE BLEU 100 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "SIROP MENTHE VERT 100 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "SIROP ROUGE 70 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "SIROP ORANGE 100 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "CANNE SUCRE 75 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "RHUM 303 75 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" },
    { name: "DOM PEDRO 50 CL", unit: "CENTILITRE", price: 1, category: "OTHERS" }
  ]

  console.log(`Nombre total de boissons à insérer : ${products.length}`)

  // Vérifier si les magasins existent, les créer si nécessaire
  const stores = await Promise.all([
    prisma.store.upsert({
      where: { id: -1 }, // Valeur impossible pour forcer la création
      update: {},
      create: {
        name: "Bar Principal",
        department: Department.pub
      }
    }).catch(() => 
      prisma.store.create({
        data: {
          name: "Bar Principal",
          department: Department.pub
        }
      })
    ),
    prisma.store.upsert({
      where: { id: -1 },
      update: {},
      create: {
        name: "Restaurant",
        department: Department.restaurant
      }
    }).catch(() => 
      prisma.store.create({
        data: {
          name: "Restaurant",
          department: Department.restaurant
        }
      })
    ),
    prisma.store.upsert({
      where: { id: -1 },
      update: {},
      create: {
        name: "Room Service",
        department: Department.hotel
      }
    }).catch(() => 
      prisma.store.create({
        data: {
          name: "Room Service",
          department: Department.hotel
        }
      })
    )
  ])

  console.log(`Magasins disponibles: ${stores.map(s => s.name).join(', ')}`)

  let insertedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const product of products) {
    // Conversion de l'unité en enum Unit
    let unit: Unit
    switch (product.unit) {
      case 'CENTILITRE':
        unit = Unit.cl
        break
      default:
        unit = Unit.piece
    }

    // Génération du SKU au format PUB-{timestamp}
    // Utilisation d'un timestamp plus lisible et unique
    const timestamp = Date.now()
    const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    const sku = `PUB-${timestamp}${randomSuffix}`

    try {
      // Vérifier si l'item existe déjà par nom
      let item = await prisma.item.findFirst({
        where: {
          name: product.name
        }
      })

      if (!item) {
        // Créer l'item s'il n'existe pas
        item = await prisma.item.create({
          data: {
            sku: sku,
            name: product.name,
            unit: unit,
            vatRate: 20, // TVA par défaut à 20%
            costPrice: product.price,
            salePriceDefault: product.price,
            isActive: true,
            isMenu: true, // Mis à true car ce sont des articles de menu
            menuDept: Department.pub // Par défaut pour le pub
          }
        })
        console.log(`✅ Item créé: ${product.name} (SKU: ${sku}) - ${product.price} MGA`)
        insertedCount++
      } else {
        console.log(`ℹ️  Item existant: ${product.name} (SKU: ${item.sku})`)
        skippedCount++
      }

      // Ajouter le stock initial dans chaque magasin
      for (const store of stores) {
        try {
          const existingStock = await prisma.stock.findUnique({
            where: {
              stock_unique: {
                storeId: store.id,
                itemId: item.id
              }
            }
          })

          if (!existingStock) {
            // Stock initial (10 unités pour chaque produit)
            const initialQty = 10
            
            const stock = await prisma.stock.create({
              data: {
                storeId: store.id,
                itemId: item.id,
                qty: initialQty,
                minQty: 2,
                maxQty: 50
              }
            })

            // Créer un mouvement de stock pour l'entrée initiale
            await prisma.stockMovement.create({
              data: {
                storeId: store.id,
                itemId: item.id,
                qty: initialQty,
                type: StockMoveType.IN,
                reason: "Stock initial - Seed"
              }
            })

            console.log(`   ✅ Stock initial ajouté pour ${store.name}: ${initialQty} unités (Stock ID: ${stock.id})`)
          }
        } catch (stockError) {
          console.log(`   ⚠️  Erreur pour le stock de ${store.name}: ${stockError}`)
        }
      }

    } catch (error) {
      console.error(`❌ Erreur pour ${product.name}:`, error)
      errorCount++
    }
  }

  console.log('\n=== RÉSUMÉ BOISSONS ===')
  console.log(`Total produits: ${products.length}`)
  console.log(`Insérés: ${insertedCount}`)
  console.log(`Ignorés (déjà existants): ${skippedCount}`)
  console.log(`Erreurs: ${errorCount}`)

  // Afficher les statistiques par catégorie
  const categories = products.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log('\n=== PAR CATÉGORIE ===')
  Object.entries(categories).forEach(([cat, count]) => {
    console.log(`${cat}: ${count} produits`)
  })

  // Afficher les 10 derniers SKU générés pour vérification
  const lastItems = await prisma.item.findMany({
    where: { sku: { startsWith: 'PUB-' } },
    orderBy: { id: 'desc' },
    take: 10,
    select: { name: true, sku: true }
  })

  console.log('\n=== DERNIERS SKU GÉNÉRÉS ===')
  lastItems.forEach(item => {
    console.log(`${item.name}: ${item.sku}`)
  })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })