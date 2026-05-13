import { NextFunction, Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";

interface OrderLine {
  qty: number;
  unitPrice: number;
}

interface Order {
  lines: OrderLine[];
}

const r = Router();

r.get("/tabs", requireScope("tabs:read"), async (_req, res) => {
  try {
    const tabs = await prisma.tab.findMany({ include: { orders: true } });
    res.json(tabs);
  } catch (error) {
    console.error('Error accessing database:', error);
    // Fallback: return empty array if database is not accessible
    res.json([]);
  }
});

r.post("/tabs", requireScope("tabs:write"), async (req, res) => {
  const schema = z.object({ customerName: z.string(), dept: z.enum(["pub"]).default("pub") });
  const t = await prisma.tab.create({ data: schema.parse(req.body) });
  res.status(201).json(t);
});

r.post("/tabs/:id/pay", requireScope("payments:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ amount: z.number().int().min(0), method: z.enum(["cash","card","mobile","bank"]) });
  const input = schema.parse(req.body);
  const tab = await prisma.tab.findUniqueOrThrow({ where: { id }, include: { orders: { include: { lines: true } } } });
  
  const total = tab.orders.reduce((so: number, o: Order) => 
    so + o.lines.reduce((sl: number, l: OrderLine) => 
      sl + l.qty * l.unitPrice, 0), 0);
  
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.payment.create({ data: { amount: input.amount, method: input.method, department: "pub", tabId: id, reference: `TAB-${id}` } });
    const paid = input.amount >= total;
    await tx.tab.update({ where: { id }, data: { status: paid ? "paid" : "unpaid", balance: Math.max(0, total - input.amount) } });
  });
  
  res.json({ ok: true });
});

r.post("/tabs/:id/mark-unpaid", requireScope("tabs:write"), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.tab.update({ where: { id }, data: { status: "unpaid" } });
  res.json({ ok: true });
});

export default r;
