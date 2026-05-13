"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const morgan_1 = __importDefault(require("morgan"));
const env_1 = require("./env");
const db_1 = require("./db");
const inventory_1 = __importDefault(require("./routes/inventory"));
const hotel_1 = __importDefault(require("./routes/hotel"));
const restaurant_1 = __importDefault(require("./routes/restaurant"));
const bar_1 = __importDefault(require("./routes/bar"));
const spa_1 = __importDefault(require("./routes/spa"));
const cash_1 = __importDefault(require("./routes/cash"));
const invoices_1 = __importDefault(require("./routes/invoices"));
const crm_1 = __importDefault(require("./routes/crm"));
const reports_1 = __importDefault(require("./routes/reports"));
const notifications_1 = __importDefault(require("./routes/notifications"));
async function bootstrap() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({ origin: env_1.ENV.CORS_ORIGIN }));
    app.use(express_1.default.json());
    app.use((0, morgan_1.default)("dev"));
    app.get("/health", async (_req, res) => {
        try {
            const result = await db_1.prisma.$queryRawUnsafe("select now()::text as now");
            const now = result[0]?.now;
            res.json({ ok: true, env: env_1.ENV.NODE_ENV, now });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: String(e) });
        }
    });
    // Public auth routes
    const authRoutes = (await Promise.resolve().then(() => __importStar(require("./routes/auth")))).default;
    app.use("/auth", authRoutes);
    app.use("/api/auth", authRoutes);
    // Authenticated routes from here
    const { authenticate } = await Promise.resolve().then(() => __importStar(require("./middleware/auth")));
    app.use(authenticate);
    app.use("/inventory", inventory_1.default);
    app.use("/hotel", hotel_1.default);
    app.use("/restaurant", restaurant_1.default);
    app.use("/bar", bar_1.default);
    app.use("/spa", spa_1.default);
    app.use("/cash", cash_1.default);
    app.use("/invoices", invoices_1.default);
    app.use("/crm", crm_1.default);
    app.use("/reports", reports_1.default);
    app.use("/notifications", notifications_1.default);
    // Optional alias with /api prefix
    app.use("/api/inventory", inventory_1.default);
    app.use("/api/hotel", hotel_1.default);
    app.use("/api/restaurant", restaurant_1.default);
    app.use("/api/bar", bar_1.default);
    app.use("/api/spa", spa_1.default);
    app.use("/api/cash", cash_1.default);
    app.use("/api/invoices", invoices_1.default);
    app.use("/api/crm", crm_1.default);
    app.use("/api/reports", reports_1.default);
    app.use("/api/notifications", notifications_1.default);
    app.get("/api/health", (_req, res) => res.redirect(302, "/health"));
    app.use((err, _req, res, _next) => {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    });
    let dbConnected = false;
    try {
        await db_1.prisma.$connect();
        // Solution 2: Utilisez queryRaw sans type générique ici aussi
        await db_1.prisma.$queryRawUnsafe("select 1");
        dbConnected = true;
    }
    catch (e) {
        console.error("Database connection failed:", e);
    }
    app.listen(env_1.ENV.PORT, () => {
        const PORT = env_1.ENV.PORT;
        console.log("\n🎉 === SERVEUR DÉMARRÉ ===");
        console.log(`🚀 Serveur démarré sur le port ${PORT}`);
        console.log(`📝 API disponible sur: http://localhost:${PORT}/`);
        console.log(`📝 Alias API: http://localhost:${PORT}/api`);
        console.log(`❤️  Health check: http://localhost:${PORT}/health`);
        console.log(`📊 Base de données: ${dbConnected ? "✅ Connectée" : "⚠️  Mode fallback"}`);
        console.log("\n👀 Prêt à recevoir des requêtes...\n");
    });
}
bootstrap().catch((e) => {
    console.error("Fatal error while starting server:", e);
    process.exit(1);
});
