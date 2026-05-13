import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt";
import { scopesForRole } from "../auth/rbac";

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const auth  = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });

    const payload = verifyToken(token);
    if (!payload?.sub) return res.status(401).json({ error: "Invalid token" });

    // ✅ Plus de DB lookup — le JWT est la source de vérité
    // La révocation de token se gère via expiration (exp) ou blacklist si besoin
    (req as any).user = {
      id:     payload.sub,
      email:  payload.email,
      role:   payload.role,
      sub:    payload.sub,
      scopes: payload.scopes?.length
        ? payload.scopes
        : scopesForRole(payload.role),
    };

    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}