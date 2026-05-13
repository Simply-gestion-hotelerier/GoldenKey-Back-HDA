"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
// Rooms
r.get("/rooms", (0, requireScope_1.requireScope)("rooms:read"), async (_req, res) => {
    const rooms = await db_1.prisma.room.findMany({ orderBy: { number: "asc" } });
    res.json(rooms);
});
r.get("/rooms/:id", (0, requireScope_1.requireScope)("rooms:read"), async (req, res) => {
    const id = Number(req.params.id);
    const room = await db_1.prisma.room.findUnique({ where: { id } });
    if (!room)
        return res.status(404).json({ error: "Room not found" });
    res.json(room);
});
r.post("/rooms", (0, requireScope_1.requireScope)("rooms:write"), async (req, res) => {
    const schema = zod_1.z.object({ number: zod_1.z.string(), type: zod_1.z.string(), status: zod_1.z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]) });
    const created = await db_1.prisma.room.create({ data: schema.parse(req.body) });
    res.status(201).json(created);
});
r.patch("/rooms/:id", (0, requireScope_1.requireScope)("rooms:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ number: zod_1.z.string().optional(), type: zod_1.z.string().optional(), status: zod_1.z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]).optional() });
    const updated = await db_1.prisma.room.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
});
// Backwards-compatible endpoint: update only status
r.patch("/rooms/:id/status", (0, requireScope_1.requireScope)("rooms:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ status: zod_1.z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]) });
    const input = schema.parse(req.body);
    const updated = await db_1.prisma.room.update({ where: { id }, data: { status: input.status } });
    res.json(updated);
});
r.delete("/rooms/:id", (0, requireScope_1.requireScope)("rooms:write"), async (req, res) => {
    const id = Number(req.params.id);
    const hasRes = await db_1.prisma.reservation.count({ where: { roomId: id } });
    if (hasRes)
        return res.status(400).json({ error: "Cannot delete room with reservations" });
    await db_1.prisma.room.delete({ where: { id } });
    res.status(204).end();
});
// Guests
r.get("/guests", (0, requireScope_1.requireScope)("reservations:read"), async (_req, res) => {
    const guests = await db_1.prisma.guest.findMany({ orderBy: { id: "desc" } });
    res.json(guests);
});
r.post("/guests", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const schema = zod_1.z.object({ fullName: zod_1.z.string(), phone: zod_1.z.string().optional(), email: zod_1.z.string().optional(), notes: zod_1.z.string().optional() });
    const created = await db_1.prisma.guest.create({ data: schema.parse(req.body) });
    res.status(201).json(created);
});
r.patch("/guests/:id", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ fullName: zod_1.z.string().optional(), phone: zod_1.z.string().optional(), email: zod_1.z.string().optional(), notes: zod_1.z.string().optional() });
    const updated = await db_1.prisma.guest.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
});
r.delete("/guests/:id", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const id = Number(req.params.id);
    const hasReservations = await db_1.prisma.reservation.count({ where: { guestId: id } });
    if (hasReservations)
        return res.status(400).json({ error: "Cannot delete guest with reservations" });
    await db_1.prisma.guest.delete({ where: { id } });
    res.status(204).end();
});
// Reservations
r.get("/reservations", (0, requireScope_1.requireScope)("reservations:read"), async (req, res) => {
    const { date } = req.query;
    const where = date ? { OR: [{ checkIn: { lte: new Date(date) }, checkOut: { gte: new Date(date) } }] } : {};
    const reservations = await db_1.prisma.reservation.findMany({ where, include: { room: true, guest: true, folio: true } });
    res.json(reservations);
});
r.get("/reservations/:id", (0, requireScope_1.requireScope)("reservations:read"), async (req, res) => {
    const id = Number(req.params.id);
    const reservation = await db_1.prisma.reservation.findUnique({ where: { id }, include: { room: true, guest: true, folio: true } });
    if (!reservation)
        return res.status(404).json({ error: "Reservation not found" });
    res.json(reservation);
});
r.post("/reservations", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const schema = zod_1.z.object({
        roomId: zod_1.z.number().int(),
        guest: zod_1.z.object({
            fullName: zod_1.z.string(),
            phone: zod_1.z.string().optional(),
            email: zod_1.z.string().optional()
        }),
        checkIn: zod_1.z.string(),
        checkOut: zod_1.z.string(),
        status: zod_1.z.enum(["booked", "checked_in", "checked_out", "cancelled", "no_show"]).default("booked"),
        rate: zod_1.z.number().int().min(0)
    });
    const input = schema.parse(req.body);
    const start = new Date(input.checkIn);
    const end = new Date(input.checkOut);
    // Surbooking: blocage si la chambre est déjà réservée sur l'intervalle
    const overlap = await db_1.prisma.reservation.findFirst({
        where: {
            roomId: input.roomId,
            status: { in: ["booked", "checked_in"] },
            AND: [
                { checkIn: { lt: end } },
                { checkOut: { gt: start } },
            ],
        },
    });
    if (overlap)
        return res.status(409).json({ error: "Room already booked for selected dates" });
    const created = await db_1.prisma.$transaction(async (tx) => {
        const guest = await tx.guest.create({ data: input.guest });
        const reservation = await tx.reservation.create({
            data: {
                roomId: input.roomId,
                guestId: guest.id,
                checkIn: start,
                checkOut: end,
                status: input.status,
                rate: input.rate
            }
        });
        const folio = await tx.folio.create({
            data: {
                reservationId: reservation.id,
                total: 0,
                balance: 0
            }
        });
        return { reservation, folio };
    });
    res.status(201).json(created);
});
r.patch("/reservations/:id", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({ roomId: zod_1.z.number().int().optional(), checkIn: zod_1.z.string().optional(), checkOut: zod_1.z.string().optional(), status: zod_1.z.enum(["booked", "checked_in", "checked_out", "cancelled", "no_show"]).optional(), rate: zod_1.z.number().int().min(0).optional() });
    const input = schema.parse(req.body);
    // If dates or room are changing, ensure no overlap (prevent overbooking)
    if (input.roomId || input.checkIn || input.checkOut) {
        const current = await db_1.prisma.reservation.findUnique({ where: { id } });
        if (!current)
            return res.status(404).json({ error: "Reservation not found" });
        const roomId = input.roomId ?? current.roomId;
        const start = new Date(input.checkIn ?? current.checkIn);
        const end = new Date(input.checkOut ?? current.checkOut);
        const overlap = await db_1.prisma.reservation.findFirst({
            where: {
                id: { not: id },
                roomId,
                status: { in: ["booked", "checked_in"] },
                AND: [
                    { checkIn: { lt: end } },
                    { checkOut: { gt: start } },
                ],
            },
        });
        if (overlap)
            return res.status(409).json({ error: "Room already booked for selected dates" });
    }
    const updated = await db_1.prisma.reservation.update({ where: { id }, data: { ...input, ...(input.checkIn ? { checkIn: new Date(input.checkIn) } : {}), ...(input.checkOut ? { checkOut: new Date(input.checkOut) } : {}) } });
    res.json(updated);
});
r.delete("/reservations/:id", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const id = Number(req.params.id);
    await db_1.prisma.folio.deleteMany({ where: { reservationId: id } });
    await db_1.prisma.reservation.delete({ where: { id } });
    res.status(204).end();
});
r.post("/reservations/:id/checkin", (0, requireScope_1.requireScope)("checkin:write"), async (req, res) => {
    const id = Number(req.params.id);
    const updated = await db_1.prisma.reservation.update({ where: { id }, data: { status: "checked_in" } });
    await db_1.prisma.room.update({ where: { id: updated.roomId }, data: { status: "occupied" } });
    res.json(updated);
});
r.post("/reservations/:id/checkout", (0, requireScope_1.requireScope)("checkout:write"), async (req, res) => {
    const id = Number(req.params.id);
    const updated = await db_1.prisma.reservation.update({ where: { id }, data: { status: "checked_out" } });
    await db_1.prisma.room.update({ where: { id: updated.roomId }, data: { status: "cleaning" } });
    res.json(updated);
});
// Folios
r.get("/folios/:id", (0, requireScope_1.requireScope)("folios:read"), async (req, res) => {
    const id = Number(req.params.id);
    const folio = await db_1.prisma.folio.findUnique({ where: { id }, include: { charges: true, payments: true, reservation: { include: { room: true, guest: true } } } });
    if (!folio)
        return res.status(404).json({ error: "Folio not found" });
    res.json(folio);
});
r.post("/folios/:id/charge", (0, requireScope_1.requireScope)("folios:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({
        description: zod_1.z.string(),
        qty: zod_1.z.number().int().min(1),
        unitPrice: zod_1.z.number().int().min(0),
        department: zod_1.z.enum(["hotel", "restaurant", "pub", "spa"])
    });
    const input = schema.parse(req.body);
    const charge = await db_1.prisma.folioCharge.create({
        data: { ...input, folioId: id }
    });
    const charges = await db_1.prisma.folioCharge.findMany({
        where: { folioId: id }
    });
    const total = charges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    await db_1.prisma.folio.update({
        where: { id },
        data: { total, balance: total }
    });
    res.status(201).json(charge);
});
r.post("/folios/:id/close", (0, requireScope_1.requireScope)("folios:write"), async (req, res) => {
    const id = Number(req.params.id);
    const folio = await db_1.prisma.folio.update({ where: { id }, data: { closedAt: new Date() } });
    res.json(folio);
});
exports.default = r;
