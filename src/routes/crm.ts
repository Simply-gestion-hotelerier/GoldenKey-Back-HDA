import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";

const r = Router();

function slugify(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// List customers (hotel guests + spa + bar + restaurant) with aggregates useful for CRM
r.get("/customers", requireScope("reservations:read"), async (_req, res) => {
  // HOTEL GUESTS
  const guests = await prisma.guest.findMany({
    include: {
      reservations: {
        include: {
          folio: { include: { charges: true } },
        },
      },
    },
    orderBy: { id: "desc" },
  });

  type Row = {
    id: string;
    fullName: string;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    visitCount: number;
    lastVisit: string | null;
    totalSpent: number;
    source: "hotel" | "spa" | "bar" | "restaurant";
    nationality?: string | null;
    segment?: string | null;
    loyaltyPoints?: number | null;
    loyaltyTier?: string | null;
  };

  const byName = new Map<string, Row>();

  const pushOrMerge = (row: Row) => {
    const key = row.fullName.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      return;
    }
    existing.visitCount += row.visitCount;
    existing.totalSpent += row.totalSpent;
    if (!existing.lastVisit) existing.lastVisit = row.lastVisit;
    else if (row.lastVisit && row.lastVisit > existing.lastVisit) existing.lastVisit = row.lastVisit;
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
    const lastVisitDate = g.reservations.reduce<Date | null>((acc, r) => {
      const d = r.checkOut;
      if (!acc) return d;
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
      nationality: (g as any).nationality || null,
      segment: (g as any).segment || null,
      loyaltyPoints: (g as any).loyaltyPoints ?? 0,
      loyaltyTier: (g as any).loyaltyTier || null,
    });
  }

  // SPA CLIENTS
  const apps = await prisma.appointment.findMany({ select: { clientName: true, start: true, price: true } });
  const spaGroups = new Map<string, { name: string; count: number; last: Date | null; total: number }>();
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
  const tabs = await prisma.tab.findMany({ include: { payments: true } });
  const barGroups = new Map<string, { name: string; count: number; last: Date | null; total: number }>();
  for (const t of tabs) {
    const name = t.customerName.trim();
    const g = barGroups.get(name) || { name, count: 0, last: null, total: 0 };
    g.count += 1;
    const paymentsTotal = t.payments.reduce((s, p) => s + p.amount, 0);
    g.total += paymentsTotal;
    const lastPayment = t.payments.reduce<Date | null>((acc, p) => (!acc || p.receivedAt > acc ? p.receivedAt : acc), null);
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
  const rInvoices = await prisma.invoice.findMany({ where: { department: "restaurant", NOT: { customerName: null } } });
  const restGroups = new Map<string, { name: string; count: number; last: Date | null; total: number }>();
  for (const inv of rInvoices) {
    const name = (inv.customerName || "").trim();
    if (!name) continue;
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
r.post("/customers", requireScope("reservations:write"), async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    notes: z.string().optional(),
    nationality: z.string().optional(),
    address: z.string().optional(),
    company: z.string().optional(),
    birthDate: z.string().optional(),
    segment: z.enum(["vip","corporate","leisure","ota"]).optional(),
    loyaltyPoints: z.number().int().min(0).optional(),
    loyaltyTier: z.enum(["Bronze","Silver","Gold","Platinum"]).optional(),
  });
  const input = schema.parse(req.body);

  const created = await prisma.guest.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      nationality: input.nationality,
      address: input.address,
      company: input.company,
      birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
      segment: (input as any).segment,
      loyaltyPoints: input.loyaltyPoints ?? 0,
      loyaltyTier: (input as any).loyaltyTier,
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
    nationality: (created as any).nationality || null,
    segment: (created as any).segment || null,
    loyaltyPoints: (created as any).loyaltyPoints ?? 0,
    loyaltyTier: (created as any).loyaltyTier || null,
  });
});

// Update an existing customer (guest)
r.patch("/customers/:id", requireScope("reservations:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    fullName: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    notes: z.string().optional(),
    nationality: z.string().optional(),
    address: z.string().optional(),
    company: z.string().optional(),
    birthDate: z.string().optional(),
    segment: z.enum(["vip","corporate","leisure","ota"]).optional(),
    loyaltyPoints: z.number().int().min(0).optional(),
    loyaltyTier: z.enum(["Bronze","Silver","Gold","Platinum"]).optional(),
  });
  const input = schema.parse(req.body);

  const updated = await prisma.guest.update({
    where: { id },
    data: {
      ...input,
      birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    } as any,
  });
  res.json({
    id: `hotel:${updated.id}`,
    fullName: updated.fullName,
    email: updated.email || null,
    phone: updated.phone || null,
    notes: updated.notes || null,
    nationality: (updated as any).nationality || null,
    segment: (updated as any).segment || null,
    loyaltyPoints: (updated as any).loyaltyPoints ?? 0,
    loyaltyTier: (updated as any).loyaltyTier || null,
  });
});

export default r;
