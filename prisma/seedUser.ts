import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import fs from "fs/promises";
import path from "path";

const prisma = new PrismaClient();
const OUT_FILE = path.join(process.cwd(), "prisma", "seed_credentials.json");

// Fonction pour générer un mot de passe simple et connu
async function generatePassword(role: string): Promise<string> {
  // Utiliser un mot de passe simple et connu pour tous
  return "123456";
  
  // Ou si vous voulez des mots de passe différents mais prévisibles :
  // return `${role.toLowerCase()}123`;
}

async function main() {
  const availableRoles = (Object.values(Role) as string[]).filter(Boolean);
  const fallback = ["ADMIN", "MANAGER", "RECEPTION", "HOUSEKEEPING", "KITCHEN", "WAITER", "BARTENDER", "CASHIER", "GUEST"];
  const roles = availableRoles.length ? availableRoles : fallback;

  const total = 9;
  const createdPasswords: { email: string; password: string; role: string }[] = [];

  console.log("🌱 Début du seeding avec mots de passe connus...");

  for (let i = 0; i < total; i++) {
    const roleStr = roles[i] ?? roles[i % roles.length];
    const role = roleStr as Role;
    const email = `${role.toLowerCase()}${i + 1}@mh.com`;
    const name = `${role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()} ${i + 1}`;

    // Mot de passe connu et simple
    const plain = await generatePassword(role);
    const hash = await bcrypt.hash(plain, 10);

    await prisma.user.upsert({
      where: { email },
      update: { name, role, password: hash },
      create: {
        email,
        name,
        role,
        password: hash,
      },
    });

    createdPasswords.push({ email, password: plain, role: roleStr });
    console.log(`✅ Utilisateur: ${email} | Rôle: ${roleStr} | Mot de passe: ${plain}`);
  }

  // Écriture des credentials
  await fs.writeFile(OUT_FILE, JSON.stringify(createdPasswords, null, 2), { encoding: "utf8" });
  
  console.log(`\n🎉 Seed terminé !`);
  console.log(`📁 Identifiants sauvegardés dans: ${OUT_FILE}`);
  console.log(`\n🔑 MOT DE PASSE POUR TOUS LES UTILISATEURS: 123456`);
  console.log(`\n📧 Emails disponibles:`);
  createdPasswords.forEach(user => {
    console.log(`   - ${user.email} (${user.role})`);
  });
  console.log(`\n💡 Conseil: Utilisez ces identifiants pour vous connecter`);
}

main()
  .catch((e) => {
    console.error("❌ Erreur seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });