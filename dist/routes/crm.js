"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const zod_1 = require("zod");
const requireScope_1 = require("../middleware/requireScope");
const r = (0, express_1.Router)();
function slugify(s) {
    return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// List customers (hotel guests + spa + bar + restaurant) with aggregates useful for CRM
r.get("/customers", (0, requireScope_1.requireScope)("reservations:read"), async (_req, res) => {
    // HOTEL GUESTS
    const guests = await db_1.prisma.guest.findMany({
        include: {
            reservations: {
                include: {
                    folio: { include: { charges: true } },
                },
            },
        },
        orderBy: { id: "desc" },
    });
    const byName = new Map();
    const pushOrMerge = (row) => {
        const key = row.fullName.trim().toLowerCase();
        const existing = byName.get(key);
        if (!existing) {
            byName.set(key, row);
            return;
        }
        existing.visitCount += row.visitCount;
        existing.totalSpent += row.totalSpent;
        if (!existing.lastVisit)
            existing.lastVisit = row.lastVisit;
        else if (row.lastVisit && row.lastVisit > existing.lastVisit)
            existing.lastVisit = row.lastVisit;
        // prefer hotel origin data for contact + loyalty fields
        if (row.source === "hotel") {
            existing.email = row.email ?? existing.email;
            existing.phone = row.phone ?? existing.phone;
            existing.notes = row.notes ?? existing.notes;
            existing.nationality = row.nationality ?? existing.nationality;
            existing.segment = row.segment ?? existing.segment;
            existing.loyaltyPoints = (existing.loyaltyPoints || 0) + (row.loyaltyPoints || 0);
            existing.loyaltyTier = row.loyaltyTier ?? existing.loyaltyTier;
        }
    };
    for (const g of guests) {
        const visitCount = g.reservations.length;
        const lastVisitDate = g.reservations.reduce((acc, r) => {
            const d = r.checkOut;
            if (!acc)
                return d;
            return d > acc ? d : acc;
        }, null);
        const totalSpent = g.reservations.reduce((sum, r) => {
            const charges = r.folio?.charges || [];
            const sub = charges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
            return sum + sub;
        }, 0);
        pushOrMerge({
            id: `hotel:${g.id}`,
            fullName: g.fullName,
            email: g.email || null,
            phone: g.phone || null,
            notes: g.notes || null,
            visitCount,
            lastVisit: lastVisitDate ? lastVisitDate.toISOString() : null,
            totalSpent,
            source: "hotel",
            nationality: g.nationality || null,
            segment: g.segment || null,
            loyaltyPoints: g.loyaltyPoints ?? 0,
            loyaltyTier: g.loyaltyTier || null,
        });
    }
    // SPA CLIENTS
    const apps = await db_1.prisma.appointment.findMany({ select: { clientName: true, start: true, price: true } });
    const spaGroups = new Map();
    for (const a of apps) {
        const name = a.clientName.trim();
        const g = spaGroups.get(name) || { name, count: 0, last: null, total: 0 };
        g.count += 1;
        g.total += a.price;
        g.last = !g.last || a.start > g.last ? a.start : g.last;
        spaGroups.set(name, g);
    }
    for (const g of spaGroups.values()) {
        pushOrMerge({
            id: `spa:${slugify(g.name)}`,
            fullName: g.name,
            visitCount: g.count,
            lastVisit: g.last ? g.last.toISOString() : null,
            totalSpent: g.total,
            source: "spa",
            email: null,
            phone: null,
            notes: null,
            nationality: null,
            segment: null,
            loyaltyPoints: 0,
            loyaltyTier: null,
        });
    }
    // BAR CLIENTS (Tabs)
    const tabs = await db_1.prisma.tab.findMany({ include: { payments: true } });
    const barGroups = new Map();
    for (const t of tabs) {
        const name = t.customerName.trim();
        const g = barGroups.get(name) || { name, count: 0, last: null, total: 0 };
        g.count += 1;
        const paymentsTotal = t.payments.reduce((s, p) => s + p.amount, 0);
        g.total += paymentsTotal;
        const lastPayment = t.payments.reduce((acc, p) => (!acc || p.receivedAt > acc ? p.receivedAt : acc), null);
        g.last = !g.last || (lastPayment && lastPayment > g.last) ? lastPayment : g.last;
        barGroups.set(name, g);
    }
    for (const g of barGroups.values()) {
        pushOrMerge({
            id: `bar:${slugify(g.name)}`,
            fullName: g.name,
            visitCount: g.count,
            lastVisit: g.last ? g.last.toISOString() : null,
            totalSpent: g.total,
            source: "bar",
            email: null,
            phone: null,
            notes: null,
            nationality: null,
            segment: null,
            loyaltyPoints: 0,
            loyaltyTier: null,
        });
    }
    // RESTAURANT CLIENTS (by invoices with customerName defined)
    const rInvoices = await db_1.prisma.invoice.findMany({ where: { department: "restaurant", NOT: { customerName: null } } });
    const restGroups = new Map();
    for (const inv of rInvoices) {
        const name = (inv.customerName || "").trim();
        if (!name)
            continue;
        const g = restGroups.get(name) || { name, count: 0, last: null, total: 0 };
        g.count += 1;
        g.total += inv.totalTTC;
        g.last = !g.last || (inv.date && inv.date > g.last) ? inv.date : g.last;
        restGroups.set(name, g);
    }
    for (const g of restGroups.values()) {
        pushOrMerge({
            id: `restaurant:${slugify(g.name)}`,
            fullName: g.name,
            visitCount: g.count,
            lastVisit: g.last ? g.last.toISOString() : null,
            totalSpent: g.total,
            source: "restaurant",
            email: null,
            phone: null,
            notes: null,
            nationality: null,
            segment: null,
            loyaltyPoints: 0,
            loyaltyTier: null,
        });
    }
    res.json(Array.from(byName.values()));
});
// Create a new customer (guest)
r.post("/customers", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const schema = zod_1.z.object({
        fullName: zod_1.z.string().min(1),
        phone: zod_1.z.string().optional(),
        email: zod_1.z.string().email().optional(),
        notes: zod_1.z.string().optional(),
        nationality: zod_1.z.string().optional(),
        address: zod_1.z.string().optional(),
        company: zod_1.z.string().optional(),
        birthDate: zod_1.z.string().optional(),
        segment: zod_1.z.enum(["vip", "corporate", "leisure", "ota"]).optional(),
        loyaltyPoints: zod_1.z.number().int().min(0).optional(),
        loyaltyTier: zod_1.z.enum(["Bronze", "Silver", "Gold", "Platinum"]).optional(),
    });
    const input = schema.parse(req.body);
    const created = await db_1.prisma.guest.create({
        data: {
            fullName: input.fullName,
            phone: input.phone,
            email: input.email,
            notes: input.notes,
            nationality: input.nationality,
            address: input.address,
            company: input.company,
            birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
            segment: input.segment,
            loyaltyPoints: input.loyaltyPoints ?? 0,
            loyaltyTier: input.loyaltyTier,
        },
    });
    res.status(201).json({
        id: `hotel:${created.id}`,
        fullName: created.fullName,
        email: created.email || null,
        phone: created.phone || null,
        notes: created.notes || null,
        visitCount: 0,
        lastVisit: null,
        totalSpent: 0,
        source: "hotel",
        nationality: created.nationality || null,
        segment: created.segment || null,
        loyaltyPoints: created.loyaltyPoints ?? 0,
        loyaltyTier: created.loyaltyTier || null,
    });
});
// Update an existing customer (guest)
r.patch("/customers/:id", (0, requireScope_1.requireScope)("reservations:write"), async (req, res) => {
    const id = Number(req.params.id);
    const schema = zod_1.z.object({
        fullName: zod_1.z.string().optional(),
        phone: zod_1.z.string().optional(),
        email: zod_1.z.string().email().optional(),
        notes: zod_1.z.string().optional(),
        nationality: zod_1.z.string().optional(),
        address: zod_1.z.string().optional(),
        company: zod_1.z.string().optional(),
        birthDate: zod_1.z.string().optional(),
        segment: zod_1.z.enum(["vip", "corporate", "leisure", "ota"]).optional(),
        loyaltyPoints: zod_1.z.number().int().min(0).optional(),
        loyaltyTier: zod_1.z.enum(["Bronze", "Silver", "Gold", "Platinum"]).optional(),
    });
    const input = schema.parse(req.body);
    const updated = await db_1.prisma.guest.update({
        where: { id },
        data: {
            ...input,
            birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        },
    });
    res.json({
        id: `hotel:${updated.id}`,
        fullName: updated.fullName,
        email: updated.email || null,
        phone: updated.phone || null,
        notes: updated.notes || null,
        nationality: updated.nationality || null,
        segment: updated.segment || null,
        loyaltyPoints: updated.loyaltyPoints ?? 0,
        loyaltyTier: updated.loyaltyTier || null,
    });
});
exports.default = r;
