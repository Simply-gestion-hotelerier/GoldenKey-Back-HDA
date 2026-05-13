"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/tabs", (0, requireScope_1.requireScope)("tabs:read"), async (_req, res) => {
    try {
        const tabs = await db_1.prisma.tab.findMany({ include: { orders: true } });
        res.json(tabs);
    }
    catch (error) {
        console.error('Error accessing database:', error);
        // Fallback: return empty array if database is not accessible
        res.json([]);
    }
});
r.post("/tabs", (0, requireScope_1.requireScope)("tabs:write"), async (req, res) => {
    const schema = zod_1.z.object({ customerName: zod_1.z.string(), dept: zod_1.z.enum(["pub"]).default("pub") });
    const t = await db_1.prisma.tab.create({ data: schema.parse(req.body) });
    res.status(201).json(t);
});
r.post("/tabs/:id/pay", (0, requireScope_1.requireScope)("payments:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ amount: zod_1.z.number().int().min(0), method: zod_1.z.enum(["cash", "card", "mobile", "bank"]) });
    const input = schema.parse(req.body);
    const tab = await db_1.prisma.tab.findUniqueOrThrow({ where: { id }, include: { orders: { include: { lines: true } } } });
    const total = tab.orders.reduce((so, o) => so + o.lines.reduce((sl, l) => sl + l.qty * l.unitPrice, 0), 0);
    await db_1.prisma.$transaction(async (tx) => {
        await tx.payment.create({ data: { amount: input.amount, method: input.method, department: "pub", tabId: id, reference: `TAB-${id}` } });
        const paid = input.amount >= total;
        await tx.tab.update({ where: { id }, data: { status: paid ? "paid" : "unpaid", balance: Math.max(0, total - input.amount) } });
    });
    res.json({ ok: true });
});
r.post("/tabs/:id/mark-unpaid", (0, requireScope_1.requireScope)("tabs:write"), async (req, res) => {
    const id = Number(req.params.id);
    await db_1.prisma.tab.update({ where: { id }, data: { status: "unpaid" } });
    res.json({ ok: true });
});
exports.default = r;
