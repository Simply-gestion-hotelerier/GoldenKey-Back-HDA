"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/", (0, requireScope_1.requireScope)("invoices:read"), async (_req, res) => {
    const invs = await db_1.prisma.invoice.findMany({ include: { lines: true }, orderBy: { date: "desc" } });
    res.json(invs);
});
r.get("/:id", (0, requireScope_1.requireScope)("invoices:read"), async (req, res) => {
    const id = Number(req.params.id);
    const inv = await db_1.prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv)
        return res.status(404).json({ error: "Invoice not found" });
    res.json(inv);
});
r.post("/from-order", (0, requireScope_1.requireScope)("invoices:write"), async (req, res) => {
    const schema = zod_1.z.object({
        orderId: zod_1.z.number().int(),
        number: zod_1.z.string()
    });
    const { orderId, number } = schema.parse(req.body);
    const order = await db_1.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { lines: true }
    });
    const { totalHT, totalTVA, totalTTC, lines } = computeFromLines(order.lines.map((l) => ({
        description: l.itemName,
        qty: l.qty,
        unitPrice: l.unitPrice,
        vatRate: 20
    })));
    const created = await db_1.prisma.invoice.create({
        data: {
            number,
            department: order.dept,
            totalHT,
            totalTVA,
            totalTTC,
            sourceOrderId: order.id,
            lines: {
                createMany: {
                    data: lines
                }
            }
        }
    });
    res.status(201).json(created);
});
r.post("/from-folio", (0, requireScope_1.requireScope)("invoices:write"), async (req, res) => {
    const schema = zod_1.z.object({
        folioId: zod_1.z.number().int(),
        number: zod_1.z.string()
    });
    const { folioId, number } = schema.parse(req.body);
    const folio = await db_1.prisma.folio.findUniqueOrThrow({
        where: { id: folioId },
        include: {
            charges: true,
            reservation: {
                include: {
                    room: true,
                    guest: true
                }
            }
        }
    });
    const { totalHT, totalTVA, totalTTC, lines } = computeFromLines(folio.charges.map((c) => ({
        description: c.description,
        qty: c.qty,
        unitPrice: c.unitPrice,
        vatRate: 20
    })));
    const created = await db_1.prisma.invoice.create({
        data: {
            number,
            department: "hotel",
            totalHT,
            totalTVA,
            totalTTC,
            sourceFolioId: folio.id,
            customerName: folio.reservation.guest.fullName,
            lines: {
                createMany: {
                    data: lines
                }
            }
        }
    });
    res.status(201).json(created);
});
function computeFromLines(lines) {
    const mapped = lines.map(l => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate, total: l.qty * l.unitPrice }));
    const totalTTC = mapped.reduce((s, l) => s + l.total, 0);
    const totalHT = Math.round(totalTTC / 1.2);
    const totalTVA = totalTTC - totalHT;
    return { totalHT, totalTVA, totalTTC, lines: mapped };
}
exports.default = r;
