import { Router } from "express";
import { prisma } from "../db";
import bcrypt from "bcrypt";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { requireScope } from "../middleware/requireScope";

const r = Router();

const ALL_ROLES = [
  "ADMIN","MANAGER","RECEPTION","HOUSEKEEPING",
  "WAITER","KITCHEN","BARTENDER","CASHIER","GUEST","STAFF",
] as const;

// ─── GET /users ──────────────────────────────────────────────────────────────
r.get("/", authenticate, requireScope("*"), async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return res.json(users);
});

// ─── POST /users ─────────────────────────────────────────────────────────────
r.post("/", authenticate, requireScope("*"), async (req, res) => {
  const schema = z.object({
    email:    z.string().email(),
    password: z.string().min(4),
    name:     z.string().optional(),
    role:     z.enum(ALL_ROLES),
  });

  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.body); }
  catch (err) { return res.status(400).json({ error: "Données invalides", details: err }); }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return res.status(409).json({ error: "Cet email est déjà utilisé" });

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: { email: input.email, password: passwordHash, name: input.name, role: input.role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return res.status(201).json(user);
});

// ─── PATCH /users/:id ────────────────────────────────────────────────────────
r.patch("/:id", authenticate, requireScope("*"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

  const schema = z.object({
    email:    z.string().email().optional(),
    password: z.string().min(4).optional(),
    name:     z.string().optional(),
    role:     z.enum(ALL_ROLES).optional(),
  });

  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.body); }
  catch (err) { return res.status(400).json({ error: "Données invalides", details: err }); }

  const data: Record<string, unknown> = {};
  if (input.email    !== undefined) data.email    = input.email;
  if (input.name     !== undefined) data.name     = input.name;
  if (input.role     !== undefined) data.role     = input.role;
  if (input.password !== undefined) data.password = await bcrypt.hash(input.password, 10);

  if (Object.keys(data).length === 0)
    return res.status(400).json({ error: "Aucun champ à mettre à jour" });

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return res.json(updated);
});

// ─── DELETE /users/:id ───────────────────────────────────────────────────────
r.delete("/:id", authenticate, requireScope("*"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

  const caller = (req as any).user;
  if (caller.id === id)
    return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });

  await prisma.user.delete({ where: { id } });
  return res.status(204).send();
});

export default r;