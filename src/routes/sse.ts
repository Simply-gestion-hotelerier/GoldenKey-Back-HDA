import { Router } from "express";
import { sseManager } from "../sse/SSEManager";
import jwt from "jsonwebtoken";
import { ENV } from "../env";

const router = Router();

router.get("/stream", (req, res) => {

  // Le middleware authenticate ne passe pas ici (monté avant),
  // donc req.user est toujours undefined — on lit uniquement le query param.
  const rawToken = req.query.token as string | undefined;

  if (!rawToken) {
    console.warn("SSE: no token provided");
    return res.status(401).json({ error: "Unauthorized: no token" });
  }

  let payload: { sub?: number; id?: number; role: string } | null = null;

  try {
    payload = jwt.verify(rawToken, ENV.JWT_SECRET) as {
      sub?: number;
      id?: number;
      role: string;
    };
  } catch (err) {
    console.warn("SSE: invalid token", err);
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }

  // ✅ Supporte à la fois sub (standard JWT) et id (custom)
  const userId = payload.id ?? payload.sub;
  const userRole = payload.role ?? "staff";

  if (!userId) {
    console.warn("SSE: token has no user id", payload);
    return res.status(401).json({ error: "Unauthorized: missing user id" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  // ✅ Header CORS explicite pour les requêtes cross-origin (port 4000 ≠ port 8080)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  res.write(
    `event: connected\ndata: ${JSON.stringify({ userId, role: userRole })}\n\n`
  );

  sseManager.add(userId, userRole, res);

  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseManager.remove(userId);
  });
});

export default router;