"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/daily", (0, requireScope_1.requireScope)("reports:read"), async (req, res) => {
    const { dept, date } = req.query;
    if (!dept || !date)
        return res.status(400).json({ error: "dept and date are required" });
    const ymd = String(date);
    const lines = [];
    if (dept === "restaurant" || dept === "pub") {
        const start = new Date(ymd);
        const end = new Date(new Date(ymd).getTime() + 24 * 3600 * 1000);
        const orders = await db_1.prisma.order.findMany({ where: { dept, openedAt: { gte: start, lt: end } }, include: { lines: true } });
        for (const o of orders) {
            for (const l of o.lines) {
                const unit = l.unitPrice;
                const total = unit * l.qty;
                lines.push({ label: l.itemName, qty: l.qty, unit, total });
            }
        }
    }
    else if (dept === "spa") {
        const start = new Date(ymd);
        const end = new Date(new Date(ymd).getTime() + 24 * 3600 * 1000);
        const apps = await db_1.prisma.appointment.findMany({
            where: { status: "completed", start: { gte: start, lt: end } },
            select: { serviceName: true, price: true }
        });
        for (const a of apps)
            lines.push({ label: a.serviceName, qty: 1, unit: a.price, total: a.price });
    }
    else if (dept === "hotel") {
        // No pricing per day here; relies on folio charges if needed
        const start = new Date(ymd);
        const end = new Date(new Date(ymd).getTime() + 24 * 3600 * 1000);
        const charges = await db_1.prisma.folioCharge.findMany({ where: { createdAt: { gte: start, lt: end }, department: "hotel" } });
        for (const c of charges)
            lines.push({ label: c.description, qty: c.qty, unit: c.unitPrice, total: c.qty * c.unitPrice });
    }
    const total = lines.reduce((s, l) => s + l.total, 0);
    res.json({ date: ymd, dept, lines, total });
});
exports.default = r;
