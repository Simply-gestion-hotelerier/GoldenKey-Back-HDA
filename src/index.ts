import express from "express";
import cors from "cors";
import morgan from "morgan";
import { ENV } from "./env";
import { prisma } from "./db";
import inventory from "./routes/inventory";
import hotel from "./routes/hotel";
import restaurant from "./routes/restaurant";
import bar from "./routes/bar";
import spa from "./routes/spa";
import cash from "./routes/cash";
import invoices from "./routes/invoices";
import crm from "./routes/crm";
import reports from "./routes/reports";
import notifications from "./routes/notifications";
import dishes from "./routes/dishes";
import folios from "./routes/folios";
import usersRouter from "./routes/users";
import sseRouter from "./routes/sse";

async function bootstrap() {
  const app = express();

  const allowedOrigins = [
    "http://localhost:8080",
    "https://goldenkey-front.vercel.app",
    "https://golden-key-front-vatola.vercel.app",
    ENV.DATABASE_URL?.replace(/\/$/, ""),
  ].filter(Boolean) as string[];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Postman, curl
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  }));

  app.use(express.json());
  app.use(morgan("dev"));

  app.get("/health", async (_req, res) => {
    try {
      const result: any = await prisma.$queryRawUnsafe("select now()::text as now");
      res.json({ ok: true, env: ENV.NODE_ENV, now: result[0]?.now });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ── Routes publiques ──────────────────────────────────────────────────────
  const authRoutes = (await import("./routes/auth")).default;
  app.use("/auth", authRoutes);
  app.use("/api/auth", authRoutes);

  // ✅ SSE AVANT authenticate — EventSource ne peut pas envoyer Authorization
  //    La route gère son propre jwt.verify() via query param
  app.use("/sse", sseRouter);
  app.use("/api/sse", sseRouter);

  // ── Middleware auth global (toutes les routes suivantes) ──────────────────
  const { authenticate } = await import("./middleware/auth");
  app.use(authenticate);

  // ── Routes protégées ──────────────────────────────────────────────────────
  app.use("/users", usersRouter);
  app.use("/inventory", inventory);
  app.use("/hotel", hotel);
  app.use("/restaurant", restaurant);
  app.use("/bar", bar);
  app.use("/spa", spa);
  app.use("/cash", cash);
  app.use("/invoices", invoices);
  app.use("/crm", crm);
  app.use("/reports", reports);
  app.use("/notifications", notifications);
  app.use("/dishes", dishes);
  app.use("/folios", folios);

  // Alias /api/*
  app.use("/api/users", usersRouter);
  app.use("/api/dishes", dishes);
  app.use("/api/inventory", inventory);
  app.use("/api/hotel", hotel);
  app.use("/api/restaurant", restaurant);
  app.use("/api/bar", bar);
  app.use("/api/spa", spa);
  app.use("/api/cash", cash);
  app.use("/api/invoices", invoices);
  app.use("/api/crm", crm);
  app.use("/api/reports", reports);
  app.use("/api/notifications", notifications);
  app.use("/api/api/notifications", notifications);
  app.use("/api/folios", folios);

  app.get("/api/health", (_req, res) => res.redirect(302, "/health"));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  let dbConnected = false;
  try {
    await prisma.$connect();
    await prisma.$queryRawUnsafe("select 1");
    dbConnected = true;
  } catch (e) {
    console.error("Database connection failed:", e);
  }

  app.listen(ENV.PORT, () => {
    console.log(`\n🎉 === SERVEUR DÉMARRÉ ===`);
    console.log(`🚀 Port: ${ENV.PORT}`);
    console.log(`❤️  Health: http://localhost:${ENV.PORT}/health`);
    console.log(`📡 SSE:    http://localhost:${ENV.PORT}/sse/stream`);
    console.log(`📊 DB: ${dbConnected ? "✅ Connectée" : "⚠️  Mode fallback"}\n`);
  });
}

bootstrap().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});