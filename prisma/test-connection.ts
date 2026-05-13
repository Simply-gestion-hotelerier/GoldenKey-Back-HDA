import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Équivalent de __dirname en ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Charger le fichier .env depuis le dossier parent
dotenv.config({ path: join(__dirname, '..', '.env') })

async function testConnection() {
  console.log('Test de connexion à la base de données...')
  console.log('URL:', process.env.DATABASE_URL ? 'Définie' : 'NON DÉFINIE')
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL n\'est pas défini dans le fichier .env')
    console.log('Chemin recherché:', join(__dirname, '..', '.env'))
    return
  }
  
  // Afficher les premiers caractères pour vérification (sécurité)
  console.log('Début de l\'URL:', process.env.DATABASE_URL.substring(0, 20) + '...')
  
  const prisma = new PrismaClient()
  
  try {
    await prisma.$connect()
    console.log('✅ Connexion réussie à la base de données')
    
    const result = await prisma.$queryRaw`SELECT 1 as test`
    console.log('✅ Requête test réussie:', result)
    
  } catch (error) {
    console.error('❌ Erreur de connexion:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testConnection()