#!/usr/bin/env node
/**
 * 💾 db-backup-restore.js
 * Sauvegarde et restaure toutes les données Prisma
 *
 * Usage:
 *   node db-backup-restore.js backup              → backup_<timestamp>.json
 *   node db-backup-restore.js backup --out=my.json
 *   node db-backup-restore.js restore backup_xxx.json
 *   node db-backup-restore.js restore backup_xxx.json --dry-run
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

// ─── Ordre d'insertion (respecte les FK) ───────────────────────────────────
// Les tables sans dépendances d'abord, puis celles qui en dépendent
const RESTORE_ORDER = [
  "taxRate",
  "store",
  "item",
  "stock",
  "user",
  "guest",
  "room",
  "reservation",
  "folio",
  "folioCharge",
  "payment",
  "diningTable",
  "order",
  "orderLine",
  "tab",
  "dish",
  "service",
  "staffSlot",
  "appointment",
  "cashSession",
  "stockMovement",
  "invoice",
  "invoiceLine",
  "notification",
  "auditLog",
  "roomMaintenance",
];

// ─── Tables et leurs séquences (pour reset auto-increment PostgreSQL) ────────
const SEQUENCES = {
  taxRate:        "\"TaxRate_id_seq\"",
  store:          "\"Store_id_seq\"",
  item:           "\"Item_id_seq\"",
  stock:          "\"Stock_id_seq\"",
  user:           "\"User_id_seq\"",
  guest:          "\"Guest_id_seq\"",
  room:           "\"Room_id_seq\"",
  reservation:    "\"Reservation_id_seq\"",
  folio:          "\"Folio_id_seq\"",
  folioCharge:    "\"FolioCharge_id_seq\"",
  payment:        "\"Payment_id_seq\"",
  diningTable:    "\"DiningTable_id_seq\"",
  order:          "\"Order_id_seq\"",
  orderLine:      "\"OrderLine_id_seq\"",
  tab:            "\"Tab_id_seq\"",
  dish:           "\"Dish_id_seq\"",
  service:        "\"Service_id_seq\"",
  staffSlot:      "\"StaffSlot_id_seq\"",
  appointment:    "\"Appointment_id_seq\"",
  cashSession:    "\"CashSession_id_seq\"",
  stockMovement:  "\"StockMovement_id_seq\"",
  invoice:        "\"Invoice_id_seq\"",
  invoiceLine:    "\"InvoiceLine_id_seq\"",
  notification:   "\"Notification_id_seq\"",
  auditLog:       "\"AuditLog_id_seq\"",
  roomMaintenance:"\"RoomMaintenance_id_seq\"",
};

// ═══════════════════════════════════════════════════════════════
// BACKUP
// ═══════════════════════════════════════════════════════════════
async function backup(outputFile) {
  console.log("🔄 Démarrage de la sauvegarde...\n");

  const data = {};
  const stats = {};

  for (const model of RESTORE_ORDER) {
    try {
      const rows = await prisma[model].findMany();
      data[model] = rows;
      stats[model] = rows.length;
      console.log(`  ✅ ${model.padEnd(20)} → ${rows.length} enregistrement(s)`);
    } catch (err) {
      console.warn(`  ⚠️  ${model.padEnd(20)} → ERREUR: ${err.message}`);
      data[model] = [];
      stats[model] = 0;
    }
  }

  const backup = {
    meta: {
      createdAt: new Date().toISOString(),
      version: "1.0",
      totalModels: RESTORE_ORDER.length,
      totalRecords: Object.values(stats).reduce((a, b) => a + b, 0),
    },
    stats,
    data,
  };

  fs.writeFileSync(outputFile, JSON.stringify(backup, null, 2), "utf-8");

  const sizeMb = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Sauvegarde terminée !`);
  console.log(`   📁 Fichier : ${outputFile}`);
  console.log(`   📦 Taille  : ${sizeMb} MB`);
  console.log(`   📊 Total   : ${backup.meta.totalRecords} enregistrements\n`);
}

// ═══════════════════════════════════════════════════════════════
// RESTORE
// ═══════════════════════════════════════════════════════════════
async function restore(inputFile, dryRun = false) {
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ Fichier introuvable : ${inputFile}`);
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(inputFile, "utf-8"));

  console.log(`🔄 Restauration depuis : ${inputFile}`);
  console.log(`   📅 Sauvegardé le    : ${backup.meta?.createdAt ?? "inconnu"}`);
  console.log(`   📊 Total attendu    : ${backup.meta?.totalRecords ?? "?"} enregistrements`);
  if (dryRun) console.log(`   🧪 MODE DRY-RUN (aucune écriture)\n`);
  else console.log("");

  if (!dryRun) {
    // ── 1. Désactiver les contraintes FK temporairement ──────────────
    console.log("🔓 Désactivation des contraintes FK...");
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'replica';`);

    // ── 2. Vider les tables en ordre inverse ──────────────────────────
    console.log("🗑️  Vidage des tables...");
    const deleteOrder = [...RESTORE_ORDER].reverse();
    for (const model of deleteOrder) {
      try {
        const count = await prisma[model].deleteMany();
        console.log(`   🗑️  ${model.padEnd(20)} → ${count.count} supprimé(s)`);
      } catch (err) {
        console.warn(`   ⚠️  ${model.padEnd(20)} → ${err.message}`);
      }
    }
    console.log("");
  }

  // ── 3. Réinsérer dans l'ordre ────────────────────────────────────
  console.log("📥 Insertion des données...");
  const stats = {};

  for (const model of RESTORE_ORDER) {
    const rows = backup.data[model];
    if (!rows || rows.length === 0) {
      console.log(`   ⏭️  ${model.padEnd(20)} → (vide)`);
      stats[model] = 0;
      continue;
    }

    if (dryRun) {
      console.log(`   🧪 ${model.padEnd(20)} → ${rows.length} à insérer`);
      stats[model] = rows.length;
      continue;
    }

    try {
      // Convertir les dates ISO string → Date objects
      const parsed = rows.map((row) => parseRow(row));

      await prisma[model].createMany({
        data: parsed,
        skipDuplicates: true,
      });

      console.log(`   ✅ ${model.padEnd(20)} → ${rows.length} inséré(s)`);
      stats[model] = rows.length;
    } catch (err) {
      console.error(`   ❌ ${model.padEnd(20)} → ERREUR: ${err.message}`);
      stats[model] = 0;

      // Tentative enregistrement par enregistrement
      console.log(`      ↩️  Tentative ligne par ligne...`);
      let ok = 0;
      for (const row of rows) {
        try {
          await prisma[model].create({ data: parseRow(row) });
          ok++;
        } catch (e) {
          console.warn(`      ⚠️  id=${row.id} → ${e.message}`);
        }
      }
      console.log(`      ✅ ${ok}/${rows.length} récupérés`);
      stats[model] = ok;
    }
  }

  if (!dryRun) {
    // ── 4. Réactiver FK ───────────────────────────────────────────────
    console.log("\n🔒 Réactivation des contraintes FK...");
    await prisma.$executeRawUnsafe(`SET session_replication_role = 'origin';`);

    // ── 5. Resynchroniser les séquences auto-increment ────────────────
    console.log("🔢 Resynchronisation des séquences...");
    for (const [model, seq] of Object.entries(SEQUENCES)) {
      const rows = backup.data[model];
      if (!rows || rows.length === 0) continue;
      const maxId = Math.max(...rows.map((r) => r.id ?? 0));
      if (maxId > 0) {
        try {
          await prisma.$executeRawUnsafe(
            `SELECT setval(${seq}, ${maxId}, true);`
          );
          console.log(`   🔢 ${model.padEnd(20)} → séquence à ${maxId}`);
        } catch (err) {
          console.warn(`   ⚠️  ${model.padEnd(20)} → ${err.message}`);
        }
      }
    }
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  console.log(`\n✅ Restauration ${dryRun ? "(simulée) " : ""}terminée !`);
  console.log(`   📊 Total restauré : ${total} enregistrements\n`);
}

// ═══════════════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════════════

// Reconvertit les champs ISO string en Date (Prisma attend des Date objects)
const DATE_FIELDS = new Set([
  "createdAt", "updatedAt", "closedAt", "checkIn", "checkOut",
  "start", "end", "startDate", "endDate", "firedAt", "openedAt",
  "closedAt", "receivedAt", "date", "birthDate",
]);

function parseRow(row) {
  const out = { ...row };
  for (const [key, val] of Object.entries(out)) {
    if (DATE_FIELDS.has(key) && typeof val === "string" && val) {
      out[key] = new Date(val);
    }
  }
  return out;
}

function getTimestampedFilename() {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `backup_${ts}.json`;
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
╔══════════════════════════════════════════════════════╗
║         💾 db-backup-restore.js — Aide              ║
╠══════════════════════════════════════════════════════╣
║  Sauvegarde :                                        ║
║    node db-backup-restore.js backup                  ║
║    node db-backup-restore.js backup --out=my.json    ║
║                                                      ║
║  Restauration :                                      ║
║    node db-backup-restore.js restore backup_xxx.json ║
║    node db-backup-restore.js restore backup_xxx.json ║
║      --dry-run  (simulation sans écriture)           ║
╚══════════════════════════════════════════════════════╝
`);
    process.exit(0);
  }

  try {
    if (command === "backup") {
      const outArg = args.find((a) => a.startsWith("--out="));
      const outputFile = outArg
        ? outArg.split("=")[1]
        : getTimestampedFilename();
      await backup(outputFile);

    } else if (command === "restore") {
      const inputFile = args[1];
      if (!inputFile) {
        console.error("❌ Précisez le fichier à restaurer.");
        console.error("   Exemple : node db-backup-restore.js restore backup_xxx.json");
        process.exit(1);
      }
      const dryRun = args.includes("--dry-run");
      await restore(inputFile, dryRun);

    } else {
      console.error(`❌ Commande inconnue : "${command}". Utilisez backup ou restore.`);
      process.exit(1);
    }
  } catch (err) {
    console.error("\n❌ Erreur fatale :", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();