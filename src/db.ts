import { PrismaClient, Prisma } from "@prisma/client";

// Types pour les événements Prisma
type QueryEvent = {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
};

type LogEvent = {
  timestamp: Date;
  message: string;
  target: string;
};

class EnhancedPrismaClient extends PrismaClient {
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(options?: Prisma.PrismaClientOptions) {
    super({
      ...options,
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // Types d'événements typés correctement
    this.$on('query' as never, (e: QueryEvent) => {
      if (e.duration > 1000) {
        console.warn(`Slow query (${e.duration}ms):`, e.query);
      }
    });

    this.$on('error' as never, (e: LogEvent) => {
      console.error('Prisma Error:', e);
      this.handleDisconnect();
    });

    this.$on('warn' as never, (e: LogEvent) => {
      console.warn('Prisma Warning:', e);
    });

    this.connect();
  }

  private async connect() {
    try {
      await this.$connect();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log("✅ Connected to database successfully");
    } catch (error) {
      console.error("❌ Failed to connect to database:", error);
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    this.isConnected = false;
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
      console.log(`⏳ Attempting to reconnect in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
      }
      
      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error("❌ Max reconnection attempts reached. Manual intervention required.");
    }
  }

  async $disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    return super.$disconnect();
  }
}

// Instance globale du client Prisma amélioré
export const prisma = new EnhancedPrismaClient({
  errorFormat: 'pretty',
});

// Type plus précis pour les paramètres du middleware
type PrismaAction = 'findUnique' | 'findMany' | 'findFirst' | 'create' | 'update' | 'delete' | 'upsert';

// Middleware pour la gestion des erreurs et le fallback
prisma.$use(async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {
  try {
    const result = await next(params);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Database operation failed: ${params.model}.${params.action}`, {
        error: error.message,
        code: (error as any).code,
        clientVersion: (error as any).clientVersion,
      });

      // Gestion spécifique des erreurs de connexion et schéma manquant
      const code = (error as any).code as string | undefined;
      if (code === 'P1001' || code === 'P1002' || code === 'P2021' || code === 'P2022') {
        console.warn(`⚠️  DB issue (${code}), using fallback for ${params.model}.${params.action}`);

        // Retourner des données par défaut selon le type d'opération
        const action = params.action as PrismaAction;
        switch (action) {
          case 'findMany':
            return [];
          case 'findFirst':
          case 'findUnique':
            return null;
          case 'create':
          case 'update':
          case 'delete':
          case 'upsert':
            return { id: -1, ...(params.args?.data as object) };
          default:
            return null;
        }
      }
    }

    // Pour les autres types d'erreurs, on les propage
    throw error;
  }
});
