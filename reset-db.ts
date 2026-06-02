import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log("🔄 Début du reset de la base de données...\n");

  try {
    // Désactiver les contraintes FK temporairement via une transaction
    await prisma.$transaction(
      async (tx) => {
        // Ordre de suppression : d'abord les tables enfants, puis les parents
        // pour respecter les contraintes de clés étrangères

        // 1. Tables feuilles (pas de dépendances sortantes)
        console.log("🗑️  Suppression des lignes de facture...");
        await tx.invoiceLine.deleteMany();

        console.log("🗑️  Suppression des lignes de commande...");
        await tx.orderLine.deleteMany();

        console.log("🗑️  Suppression des charges de folio...");
        await tx.folioCharge.deleteMany();

        console.log("🗑️  Suppression des paiements...");
        await tx.payment.deleteMany();

        console.log("🗑️  Suppression des mouvements de stock...");
        await tx.stockMovement.deleteMany();

        console.log("🗑️  Suppression des stocks...");
        await tx.stock.deleteMany();

        console.log("🗑️  Suppression des logs d'audit...");
        await tx.auditLog.deleteMany();

        console.log("🗑️  Suppression des notifications...");
        await tx.notification.deleteMany();

        console.log("🗑️  Suppression des créneaux du personnel...");
        await tx.staffSlot.deleteMany();

        console.log("🗑️  Suppression des maintenances de chambre...");
        await tx.roomMaintenance.deleteMany();

        // 2. Tables intermédiaires
        console.log("🗑️  Suppression des sessions de caisse...");
        await tx.cashSession.deleteMany();

        console.log("🗑️  Suppression des folios...");
        await tx.folio.deleteMany();

        console.log("🗑️  Suppression des commandes...");
        await tx.order.deleteMany();

        console.log("🗑️  Suppression des tabs...");
        await tx.tab.deleteMany();

        console.log("🗑️  Suppression des réservations...");
        await tx.reservation.deleteMany();

        console.log("🗑️  Suppression des rendez-vous...");
        await tx.appointment.deleteMany();

        console.log("🗑️  Suppression des factures...");
        await tx.invoice.deleteMany();

        // 3. Tables principales (entités racines)
        console.log("🗑️  Suppression des tables de restaurant...");
        await tx.diningTable.deleteMany();

        console.log("🗑️  Suppression des chambres...");
        await tx.room.deleteMany();

        console.log("🗑️  Suppression des clients...");
        await tx.guest.deleteMany();

        console.log("🗑️  Suppression des articles...");
        await tx.item.deleteMany();

        console.log("🗑️  Suppression des magasins...");
        await tx.store.deleteMany();

        console.log("🗑️  Suppression des plats...");
        await tx.dish.deleteMany();

        console.log("🗑️  Suppression des services...");
        await tx.service.deleteMany();

        console.log("🗑️  Suppression des taux de TVA...");
        await tx.taxRate.deleteMany();
      },
      {
        timeout: 30000, // 30 secondes max
      }
    );

    console.log("\n✅ Reset terminé avec succès !");
    console.log("ℹ️  La table User a été conservée intacte.");
  } catch (error) {
    console.error("\n❌ Erreur lors du reset :", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

resetDatabase();