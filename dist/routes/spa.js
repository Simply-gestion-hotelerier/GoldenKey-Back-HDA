"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
r.get("/appointments", (0, requireScope_1.requireScope)("spa:read"), async (req, res) => {
    const { date, start, end } = req.query;
    let where = {};
    if (start && end) {
        where.start = { gte: new Date(String(start)), lt: new Date(String(end)) };
    }
    else if (date) {
        const d = new Date(String(date));
        where.start = { gte: d, lt: new Date(d.getTime() + 24 * 3600 * 1000) };
    }
    const apps = await db_1.prisma.appointment.findMany({
        where,
        orderBy: { start: "asc" },
        select: {
            id: true,
            clientName: true,
            serviceName: true,
            start: true,
            durationMin: true,
            status: true,
            price: true,
            therapistId: true,
        },
    });
    res.json(apps);
});
r.get("/appointments/:id", (0, requireScope_1.requireScope)("spa:read"), async (req, res) => {
    const id = Number(req.params.id);
    const app = await db_1.prisma.appointment.findUnique({
        where: { id },
        select: {
            id: true,
            clientName: true,
            serviceName: true,
            start: true,
            durationMin: true,
            status: true,
            price: true,
            therapistId: true,
        },
    });
    if (!app)
        return res.status(404).json({ error: "Appointment not found" });
    res.json(app);
});
r.post("/appointments", (0, requireScope_1.requireScope)("spa:write"), async (req, res) => {
    const schema = zod_1.z.object({
        clientName: zod_1.z.string(),
        serviceName: zod_1.z.string(),
        start: zod_1.z.string(),
        durationMin: zod_1.z.number().int().min(10),
        price: zod_1.z.number().int().min(0),
        room: zod_1.z.string().optional().nullable(),
        therapistId: zod_1.z.number().int().optional().nullable(),
    });
    const input = schema.parse(req.body);
    // Optional: basic overlap check if therapist provided
    if (input.therapistId) {
        const start = new Date(input.start);
        const end = new Date(start.getTime() + input.durationMin * 60000);
        const conflict = await db_1.prisma.appointment.findFirst({
            where: {
                therapistId: input.therapistId,
                start: { lt: end },
                // approximate overlap check: existing start < new end AND (existing start + duration) > new start
            },
            orderBy: { start: "asc" },
        });
        if (conflict) {
            // For MVP we just warn via header, but still create. In real-case, block creation.
            res.setHeader("X-Warning", "Therapist may be double-booked");
        }
    }
    const created = await db_1.prisma.appointment.create({
        data: { ...input, start: new Date(input.start) }
    });
    res.status(201).json(created);
});
r.patch("/appointments/:id/status", (0, requireScope_1.requireScope)("spa:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ status: zod_1.z.enum(["booked", "waiting", "in_progress", "completed", "no_show", "cancelled"]) });
    const status = schema.parse(req.body).status;
    const updated = await db_1.prisma.appointment.update({ where: { id }, data: { status } });
    res.json(updated);
});
r.post("/appointments/:id/pay", (0, requireScope_1.requireScope)("payments:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ amount: zod_1.z.number().int().min(1), method: zod_1.z.enum(["cash", "card", "mobile", "bank"]) });
    const { amount, method } = schema.parse(req.body);
    const app = await db_1.prisma.appointment.findUnique({ where: { id } });
    if (!app)
        return res.status(404).json({ error: "Appointment not found" });
    const payment = await db_1.prisma.payment.create({ data: { amount, method, department: "spa", reference: `APPT-${id}` } });
    res.status(201).json(payment);
});
// Services catalog
r.get("/services", (0, requireScope_1.requireScope)("spa:read"), async (_req, res) => {
    const services = await db_1.prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    res.json(services);
});
r.post("/services", (0, requireScope_1.requireScope)("spa:write"), async (req, res) => {
    const schema = zod_1.z.object({ name: zod_1.z.string(), durationMin: zod_1.z.number().int().min(10), salePrice: zod_1.z.number().int().min(0) });
    const created = await db_1.prisma.service.create({ data: { ...schema.parse(req.body), dept: "spa" } });
    res.status(201).json(created);
});
// Staff availability slots
r.get("/staff-slots", (0, requireScope_1.requireScope)("spa:read"), async (req, res) => {
    const { staffId, date } = req.query;
    const where = {};
    if (staffId)
        where.staffId = Number(staffId);
    if (date) {
        const start = new Date(date);
        const end = new Date(start.getTime() + 24 * 3600 * 1000);
        where.start = { gte: start, lt: end };
    }
    const slots = await db_1.prisma.staffSlot.findMany({ where, orderBy: { start: "asc" } });
    res.json(slots);
});
r.post("/staff-slots", (0, requireScope_1.requireScope)("spa:write"), async (req, res) => {
    const schema = zod_1.z.object({ staffId: zod_1.z.number().int(), start: zod_1.z.string(), end: zod_1.z.string(), status: zod_1.z.string().optional() });
    const input = schema.parse(req.body);
    const created = await db_1.prisma.staffSlot.create({ data: { staffId: input.staffId, start: new Date(input.start), end: new Date(input.end), status: input.status || "available" } });
    res.status(201).json(created);
});
r.delete("/appointments/:id", (0, requireScope_1.requireScope)("spa:write"), async (req, res) => {
    const id = Number(req.params.id);
    await db_1.prisma.appointment.delete({ where: { id } });
    res.status(204).end();
});
exports.default = r;
