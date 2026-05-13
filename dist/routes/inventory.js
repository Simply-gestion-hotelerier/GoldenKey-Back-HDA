"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/items", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    const { isMenu, dept } = req.query;
    const items = await db_1.prisma.item.findMany({
        where: {
            isActive: true,
            ...(isMenu !== undefined ? { isMenu: isMenu === "true" } : {}),
            ...(dept ? { menuDept: dept } : {}),
        },
        orderBy: { name: "asc" },
    });
    res.json(items);
});
r.get("/items/:id", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    const id = Number(req.params.id);
    const item = await db_1.prisma.item.findUnique({ where: { id } });
    if (!item)
        return res.status(404).json({ error: "Item not found" });
    res.json(item);
});
r.post("/items", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const schema = zod_1.z.object({
        sku: zod_1.z.string(),
        name: zod_1.z.string(),
        unit: zod_1.z.enum(["piece", "kg", "g", "L", "cl", "ml"]),
        vatRate: zod_1.z.number().int().min(0).max(100),
        costPrice: zod_1.z.number().int().min(0),
        salePriceDefault: zod_1.z.number().int().min(0),
        isActive: zod_1.z.boolean().optional().default(true),
        isMenu: zod_1.z.boolean().optional(),
        menuDept: zod_1.z.enum(["hotel", "restaurant", "pub", "spa"]).optional(),
    });
    const data = schema.parse(req.body);
    const created = await db_1.prisma.item.create({ data });
    res.status(201).json(created);
});
r.patch("/items/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({
        name: zod_1.z.string().optional(),
        vatRate: zod_1.z.number().int().min(0).max(100).optional(),
        costPrice: zod_1.z.number().int().min(0).optional(),
        salePriceDefault: zod_1.z.number().int().min(0).optional(),
        isActive: zod_1.z.boolean().optional(),
        isMenu: zod_1.z.boolean().optional(),
        maxQty: zod_1.z.number().int().min(1).nullable().optional(),
        menuDept: zod_1.z.enum(["hotel", "restaurant", "pub", "spa"]).nullable().optional(),
    });
    const data = schema.parse(req.body);
    const updated = await db_1.prisma.item.update({ where: { id }, data });
    res.json(updated);
});
r.delete("/items/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    await db_1.prisma.stock.deleteMany({ where: { itemId: id } });
    await db_1.prisma.orderLine.deleteMany({ where: { itemId: id } });
    await db_1.prisma.item.delete({ where: { id } });
    res.status(204).end();
});
r.get("/stores", (0, requireScope_1.requireScope)("inventory:read"), async (_req, res) => {
    const stores = await db_1.prisma.store.findMany();
    res.json(stores);
});
r.get("/stores/:id", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    const id = Number(req.params.id);
    const store = await db_1.prisma.store.findUnique({ where: { id } });
    if (!store)
        return res.status(404).json({ error: "Store not found" });
    res.json(store);
});
r.post("/stores", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const schema = zod_1.z.object({ name: zod_1.z.string(), department: zod_1.z.enum(["hotel", "restaurant", "pub", "spa"]) });
    const created = await db_1.prisma.store.create({ data: schema.parse(req.body) });
    res.status(201).json(created);
});
r.patch("/stores/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ name: zod_1.z.string().optional() });
    const updated = await db_1.prisma.store.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
});
r.delete("/stores/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    const hasStocks = await db_1.prisma.stock.count({ where: { storeId: id } });
    if (hasStocks)
        return res.status(400).json({ error: "Cannot delete store with stocks" });
    await db_1.prisma.store.delete({ where: { id } });
    res.status(204).end();
});
r.get("/stocks", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    const { storeId } = req.query;
    const stocks = await db_1.prisma.stock.findMany({
        where: { ...(storeId ? { storeId: Number(storeId) } : {}) },
        include: { item: true, store: true },
    });
    res.json(stocks);
});
r.post("/stocks", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const schema = zod_1.z.object({
        storeId: zod_1.z.number().int(),
        itemId: zod_1.z.number().int(),
        qty: zod_1.z.number().int().min(0),
        minQty: zod_1.z.number().int().min(0).default(0),
        maxQty: zod_1.z.number().int().min(1).optional() // Ajout pour seuil max
    });
    try {
        const data = schema.parse(req.body);
        const store = await db_1.prisma.store.findUnique({ where: { id: data.storeId } });
        if (!store)
            return res.status(400).json({ error: "Store not found" });
        const item = await db_1.prisma.item.findUnique({ where: { id: data.itemId } });
        if (!item)
            return res.status(400).json({ error: "Item not found" });
        const created = await db_1.prisma.stock.create({
            data: {
                storeId: data.storeId,
                itemId: data.itemId,
                qty: data.qty,
                minQty: data.minQty,
                maxQty: data.maxQty
            }
        });
        res.status(201).json(created);
    }
    catch (e) {
        if (e?.code === 'P2003')
            return res.status(400).json({ error: 'Foreign key constraint failed' });
        res.status(500).json({ error: String(e) });
    }
});
r.patch("/stocks/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ qty: zod_1.z.number().int().optional(), minQty: zod_1.z.number().int().optional(), maxQty: zod_1.z.number().int().optional() });
    const updated = await db_1.prisma.stock.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
});
r.get("/movements", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    try {
        const { limit } = req.query;
        const l = limit ? Math.min(200, Number(limit)) : 100;
        const moves = await db_1.prisma.stockMovement.findMany({
            include: { item: true, store: true },
            orderBy: { createdAt: "desc" },
            take: l
        });
        res.json(moves);
    }
    catch (error) {
        console.error('Error fetching stock movements:', error);
        res.json([]);
    }
});
r.post("/movements", (0, requireScope_1.requireScope)("inventory:adjust"), async (req, res) => {
    const schema = zod_1.z.object({
        storeId: zod_1.z.number().int(),
        itemId: zod_1.z.number().int(),
        qty: zod_1.z.number().int(),
        type: zod_1.z.enum(["IN", "OUT", "ADJUST"]),
        reason: zod_1.z.string().optional()
    });
    const input = schema.parse(req.body);
    const created = await db_1.prisma.$transaction(async (tx) => {
        const mv = await tx.stockMovement.create({ data: { ...input } });
        const stock = await tx.stock.upsert({
            where: {
                stock_unique: {
                    storeId: input.storeId,
                    itemId: input.itemId
                }
            },
            create: {
                storeId: input.storeId,
                itemId: input.itemId,
                qty: 0,
                minQty: 0,
                maxQty: 100 // valeur par défaut
            },
            update: {},
        });
        let qty = stock.qty;
        if (input.type === "IN")
            qty += input.qty;
        else if (input.type === "OUT")
            qty -= input.qty;
        else
            qty = input.qty;
        await tx.stock.update({
            where: { id: stock.id },
            data: { qty }
        });
        return mv;
    });
    res.status(201).json(created);
});
r.delete("/stocks/:id", (0, requireScope_1.requireScope)("inventory:write"), async (req, res) => {
    const id = Number(req.params.id);
    try {
        await db_1.prisma.stock.delete({ where: { id } });
        res.status(204).end();
    }
    catch (e) {
        res.status(500).json({ error: String(e) });
    }
});
r.get("/alerts", (0, requireScope_1.requireScope)("inventory:read"), async (req, res) => {
    const { storeId } = req.query;
    const where = storeId ? { storeId: Number(storeId) } : {};
    const stocks = await db_1.prisma.stock.findMany({ where, include: { item: true, store: true } });
    const out = stocks.filter(s => (s.qty || 0) === 0).map(s => ({ id: s.id, item: s.item, store: s.store, qty: s.qty }));
    const low = stocks.filter(s => (s.qty || 0) <= (s.minQty || 0) && (s.qty || 0) > 0).map(s => ({ id: s.id, item: s.item, store: s.store, qty: s.qty, minQty: s.minQty }));
    res.json({ out, low });
});
exports.default = r;
