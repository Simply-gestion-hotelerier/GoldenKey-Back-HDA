"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/tables", (0, requireScope_1.requireScope)("orders:read"), async (_req, res) => {
    const tables = await db_1.prisma.diningTable.findMany({ where: { department: { in: ["restaurant", "pub"] } } });
    res.json(tables);
});
r.post("/tables", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const schema = zod_1.z.object({ code: zod_1.z.string(), department: zod_1.z.enum(["restaurant", "pub"]) });
    const created = await db_1.prisma.diningTable.create({ data: schema.parse(req.body) });
    res.status(201).json(created);
});
r.patch("/tables/:id", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ code: zod_1.z.string().optional() });
    const updated = await db_1.prisma.diningTable.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
});
r.delete("/tables/:id", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const hasOrders = await db_1.prisma.order.count({ where: { tableId: id } });
    if (hasOrders)
        return res.status(400).json({ error: "Cannot delete table with orders" });
    await db_1.prisma.diningTable.delete({ where: { id } });
    res.status(204).end();
});
r.get("/orders", (0, requireScope_1.requireScope)("orders:read"), async (req, res) => {
    try {
        // Validation des paramètres de requête
        const schema = zod_1.z.object({
            dept: zod_1.z.enum(["restaurant", "pub", "spa"]).optional(),
            status: zod_1.z.enum(["open", "closed", "cancelled"]).optional(),
        });
        const { dept, status } = schema.parse(req.query);
        const orders = await db_1.prisma.order.findMany({
            where: {
                ...(dept ? { dept } : {}),
                ...(status ? { status } : {}),
            },
            include: {
                lines: true,
                table: true,
            },
            orderBy: {
                openedAt: "desc",
            },
        });
        // Ajouter des en-têtes de cache pour optimiser les performances
        res.set({
            'Cache-Control': 'private, max-age=10',
            'ETag': `"orders-${dept}-${status}-${Date.now()}"`,
        });
        res.json(orders);
    }
    catch (error) {
        console.error('Error fetching orders:', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                error: "Invalid parameters",
                details: error.errors,
            });
        }
        // En cas d'erreur de base de données, renvoyer un tableau vide
        // mais avec un code d'état approprié
        res.status(503).json({
            data: [],
            error: "Database temporarily unavailable",
            retry: true,
        });
    }
});
r.get("/orders/:id", (0, requireScope_1.requireScope)("orders:read"), async (req, res) => {
    const id = Number(req.params.id);
    const order = await db_1.prisma.order.findUnique({ where: { id }, include: { lines: true, table: true, payments: true } });
    if (!order)
        return res.status(404).json({ error: "Order not found" });
    res.json(order);
});
r.post("/orders", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const schema = zod_1.z.object({ dept: zod_1.z.enum(["restaurant", "pub", "spa"]).default("restaurant"), tableCode: zod_1.z.string().optional(), tabId: zod_1.z.number().int().optional() });
    const input = schema.parse(req.body);
    const table = input.tableCode ? await db_1.prisma.diningTable.findUnique({ where: { code: input.tableCode } }) : null;
    const created = await db_1.prisma.order.create({ data: { dept: input.dept, tableId: table?.id, status: "open", tabId: input.tabId } });
    res.status(201).json(created);
});
r.post("/orders/:id/lines", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ itemId: zod_1.z.number().int(), qty: zod_1.z.number().int().min(1) });
    const input = schema.parse(req.body);
    const item = await db_1.prisma.item.findUniqueOrThrow({ where: { id: input.itemId } });
    const line = await db_1.prisma.orderLine.create({ data: { orderId: id, itemId: item.id, itemName: item.name, qty: input.qty, unitPrice: item.salePriceDefault, fireStatus: "commanded" } });
    res.status(201).json(line);
});
r.delete("/orders/:id/lines/:lineId", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    const order = await db_1.prisma.order.findUniqueOrThrow({ where: { id } });
    if (order.status !== "open")
        return res.status(400).json({ error: "Cannot modify closed/cancelled order" });
    await db_1.prisma.orderLine.delete({ where: { id: lineId } });
    res.status(204).end();
});
r.patch("/orders/:id/lines/:lineId/status", (0, requireScope_1.requireScope)("orders:status"), async (req, res) => {
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    await db_1.prisma.order.findUniqueOrThrow({ where: { id } });
    const schema = zod_1.z.object({ status: zod_1.z.enum(["commanded", "preparing", "ready", "delivered", "voided"]) });
    const updated = await db_1.prisma.orderLine.update({ where: { id: lineId }, data: { fireStatus: schema.parse(req.body).status } });
    res.json(updated);
});
// Update order line (qty / unitPrice)
r.patch("/orders/:id/lines/:lineId", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    await db_1.prisma.order.findUniqueOrThrow({ where: { id } });
    const schema = zod_1.z.object({ qty: zod_1.z.number().int().min(1).optional(), unitPrice: zod_1.z.number().int().min(0).optional() });
    const data = schema.parse(req.body);
    const updated = await db_1.prisma.orderLine.update({ where: { id: lineId }, data });
    res.json(updated);
});
r.patch("/orders/:id/status", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ status: zod_1.z.enum(["open", "closed", "cancelled"]) });
    const updated = await db_1.prisma.order.update({ where: { id }, data: { status: schema.parse(req.body).status, ...(req.body.status === "closed" ? { closedAt: new Date() } : {}) } });
    res.json(updated);
});
r.delete("/orders/:id", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const order = await db_1.prisma.order.findUnique({ where: { id }, include: { payments: true } });
    if (!order)
        return res.status(404).json({ error: "Order not found" });
    if (order.payments.length)
        return res.status(400).json({ error: "Cannot delete order with payments" });
    await db_1.prisma.orderLine.deleteMany({ where: { orderId: id } });
    await db_1.prisma.order.delete({ where: { id } });
    res.status(204).end();
});
r.post("/orders/:id/close", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const order = await db_1.prisma.order.findUnique({
        where: { id },
        include: { lines: true }
    });
    if (!order)
        return res.status(404).json({ error: "Order not found" });
    const total = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const closed = await db_1.prisma.order.update({
        where: { id },
        data: {
            status: "closed",
            closedAt: new Date()
        }
    });
    res.json({ ...closed, total });
});
// Charge the full order to a hotel folio (creates FolioCharges from order lines)
r.post("/orders/:id/charge-to-folio", (0, requireScope_1.requireScope)("orders:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ folioId: zod_1.z.number().int(), closeOrder: zod_1.z.boolean().optional().default(false) });
    const input = schema.parse(req.body);
    const order = await db_1.prisma.order.findUnique({ where: { id }, include: { lines: true } });
    if (!order)
        return res.status(404).json({ error: "Order not found" });
    if (!order.lines.length)
        return res.status(400).json({ error: "Order has no lines" });
    const result = await db_1.prisma.$transaction(async (tx) => {
        // Create charges for each line
        for (const l of order.lines) {
            await tx.folioCharge.create({
                data: {
                    folioId: input.folioId,
                    description: `${l.itemName} x${l.qty}`,
                    qty: 1,
                    unitPrice: l.qty * l.unitPrice,
                    department: order.dept,
                },
            });
        }
        // Recompute folio totals and balance (consider payments)
        const charges = await tx.folioCharge.findMany({ where: { folioId: input.folioId } });
        const payments = await tx.payment.findMany({ where: { folioId: input.folioId } });
        const total = charges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
        const paid = payments.reduce((s, p) => s + p.amount, 0);
        const folio = await tx.folio.update({ where: { id: input.folioId }, data: { total, balance: Math.max(0, total - paid) } });
        // Optionally close order
        let closed = null;
        if (input.closeOrder) {
            closed = await tx.order.update({ where: { id }, data: { status: "closed", closedAt: new Date() } });
        }
        return { folio, closed };
    });
    res.status(201).json(result);
});
exports.default = r;
