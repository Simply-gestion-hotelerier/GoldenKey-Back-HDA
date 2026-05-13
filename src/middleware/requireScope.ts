import { Request, Response, NextFunction } from "express";
import { hasScopes } from "../auth/rbac";

export function requireScope(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { id: number; email: string; role: string; scopes: string[] } | undefined;
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    if (!hasScopes(user.scopes, required)) {
      return res.status(403).json({ error: "Forbidden", required });
    }

    next();
  };
}
