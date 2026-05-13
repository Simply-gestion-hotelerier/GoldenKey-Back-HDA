"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
class EnhancedPrismaClient extends client_1.PrismaClient {
    isConnected = false;
    reconnectAttempts = 0;
    maxReconnectAttempts = 3;
    reconnectTimeout = null;
    constructor(options) {
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
        this.$on('query', (e) => {
            if (e.duration > 1000) {
                console.warn(`Slow query (${e.duration}ms):`, e.query);
            }
        });
        this.$on('error', (e) => {
            console.error('Prisma Error:', e);
            this.handleDisconnect();
        });
        this.$on('warn', (e) => {
            console.warn('Prisma Warning:', e);
        });
        this.connect();
    }
    async connect() {
        try {
            await this.$connect();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log("✅ Connected to database successfully");
        }
        catch (error) {
            console.error("❌ Failed to connect to database:", error);
            this.handleDisconnect();
        }
    }
    handleDisconnect() {
        this.isConnected = false;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
            console.log(`⏳ Attempting to reconnect in ${delay / 1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
            }
            this.reconnectTimeout = setTimeout(() => {
                this.connect();
            }, delay);
        }
        else {
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
exports.prisma = new EnhancedPrismaClient({
    errorFormat: 'pretty',
});
// Middleware pour la gestion des erreurs et le fallback
exports.prisma.$use(async (params, next) => {
    try {
        const result = await next(params);
        return result;
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(`Database operation failed: ${params.model}.${params.action}`, {
                error: error.message,
                code: error.code,
                clientVersion: error.clientVersion,
            });
            // Gestion spécifique des erreurs de connexion et schéma manquant
            const code = error.code;
            if (code === 'P1001' || code === 'P1002' || code === 'P2021' || code === 'P2022') {
                console.warn(`⚠️  DB issue (${code}), using fallback for ${params.model}.${params.action}`);
                // Retourner des données par défaut selon le type d'opération
                const action = params.action;
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
                        return { id: -1, ...params.args?.data };
                    default:
                        return null;
                }
            }
        }
        // Pour les autres types d'erreurs, on les propage
        throw error;
    }
});
