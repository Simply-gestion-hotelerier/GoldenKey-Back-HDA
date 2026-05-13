// routes/hotel.ts
// ─────────────────────────────────────────────────────────────────────────────
// rateMode = label uniquement (pas de calcul).
//   - per_night : rate = prix par nuit, total = rate × nights
//   - per_stay  : rate = prix total du séjour, total = rate (pas de multiplication)
//
// Le champ rateMode est stocké tel quel en base (String @default("per_night")).
// ─────────────────────────────────────────────────────────────────────────────

import { Router }               from "express";
import { prisma }               from "../db";
import { z }                    from "zod";
import { Prisma }               from "@prisma/client";
import { requireScope }         from "../middleware/requireScope";

const r = Router();

// ════════════════════════════════════════════════════════════════════════════
// MAINTENANCES  (inchangé)
// ════════════════════════════════════════════════════════════════════════════

const maintenanceStatusEnum = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

const createMaintenanceSchema = z.object({
  roomId:    z.number().int().positive(),
  startDate: z.string().datetime({ message: "startDate doit être une date ISO 8601" }),
  endDate:   z.string().datetime({ message: "endDate doit être une date ISO 8601" }),
  reason:    z.string().max(500).optional(),
  status:    maintenanceStatusEnum.default("scheduled"),
});

const updateMaintenanceSchema = z.object({
  roomId:    z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate:   z.string().datetime().optional(),
  reason:    z.string().max(500).nullable().optional(),
  status:    maintenanceStatusEnum.optional(),
});

r.get("/maintenances", requireScope("rooms:read"), async (req, res) => {
  try {
    const { roomId, status, from, to } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};

    if (roomId) {
      const rid = Number(roomId);
      if (isNaN(rid)) return res.status(400).json({ error: "roomId invalide" });
      where.roomId = rid;
    }
    if (status) {
      const parsed = maintenanceStatusEnum.safeParse(status);
      if (!parsed.success)
        return res.status(400).json({ error: "status invalide", valid: maintenanceStatusEnum.options });
      where.status = parsed.data;
    }
    if (from || to) {
      const andClauses: unknown[] = [];
      if (to)   andClauses.push({ startDate: { lte: new Date(to) } });
      if (from) andClauses.push({ endDate:   { gte: new Date(from) } });
      if (andClauses.length) where.AND = andClauses;
    }

    const maintenances = await prisma.roomMaintenance.findMany({
      where,
      include:  { room: true },
      orderBy:  { startDate: "asc" },
    });
    res.json(maintenances);
  } catch (err) {
    console.error("[GET /maintenances]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.get("/maintenances/:id", requireScope("rooms:read"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const maintenance = await prisma.roomMaintenance.findUnique({ where: { id }, include: { room: true } });
    if (!maintenance) return res.status(404).json({ error: "Maintenance introuvable" });
    res.json(maintenance);
  } catch (err) {
    console.error("[GET /maintenances/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/maintenances", requireScope("rooms:write"), async (req, res) => {
  try {
    const input     = createMaintenanceSchema.parse(req.body);
    const startDate = new Date(input.startDate);
    const endDate   = new Date(input.endDate);

    if (endDate <= startDate)
      return res.status(400).json({ error: "endDate doit être postérieure à startDate" });

    const room = await prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room) return res.status(404).json({ error: "Chambre introuvable" });

    const overlap = await prisma.roomMaintenance.findFirst({
      where: {
        roomId: input.roomId,
        status: { in: ["scheduled", "in_progress"] },
        AND: [{ startDate: { lte: endDate } }, { endDate: { gte: startDate } }],
      },
    });
    if (overlap) {
      return res.status(409).json({
        error: "Cette chambre a déjà une maintenance planifiée sur cette période",
        conflictId: overlap.id,
        conflictPeriod: { startDate: overlap.startDate, endDate: overlap.endDate },
      });
    }

    const maintenance = await prisma.roomMaintenance.create({
      data:    { roomId: input.roomId, startDate, endDate, reason: input.reason, status: input.status },
      include: { room: true },
    });

    const now = new Date();
    if (startDate <= now && endDate >= now && input.status === "in_progress") {
      await prisma.room.update({ where: { id: input.roomId }, data: { status: "maintenance" } });
    }

    res.status(201).json(maintenance);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[POST /maintenances]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/maintenances/:id", requireScope("rooms:write"), async (req, res) => {
  try {
    const id      = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const input   = updateMaintenanceSchema.parse(req.body);
    const current = await prisma.roomMaintenance.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Maintenance introuvable" });

    const startDate = input.startDate ? new Date(input.startDate) : current.startDate;
    const endDate   = input.endDate   ? new Date(input.endDate)   : current.endDate;
    const roomId    = input.roomId    ?? current.roomId;
    if (endDate <= startDate)
      return res.status(400).json({ error: "endDate doit être postérieure à startDate" });

    if (input.roomId || input.startDate || input.endDate) {
      const overlap = await prisma.roomMaintenance.findFirst({
        where: {
          id:     { not: id },
          roomId,
          status: { in: ["scheduled", "in_progress"] },
          AND: [{ startDate: { lte: endDate } }, { endDate: { gte: startDate } }],
        },
      });
      if (overlap)
        return res.status(409).json({ error: "Cette chambre a déjà une maintenance planifiée sur cette période", conflictId: overlap.id });
    }

    const updated = await prisma.roomMaintenance.update({
      where: { id },
      data:  {
        ...(input.roomId    !== undefined && { roomId:    input.roomId }),
        ...(input.startDate !== undefined && { startDate: new Date(input.startDate) }),
        ...(input.endDate   !== undefined && { endDate:   new Date(input.endDate) }),
        ...(input.reason    !== undefined && { reason:    input.reason }),
        ...(input.status    !== undefined && { status:    input.status }),
      },
      include: { room: true },
    });

    const now = new Date();
    if (input.status === "in_progress" && updated.startDate <= now && updated.endDate >= now) {
      await prisma.room.update({ where: { id: updated.roomId }, data: { status: "maintenance" } });
    } else if (input.status === "completed" || input.status === "cancelled") {
      const otherActive = await prisma.roomMaintenance.findFirst({
        where: { id: { not: id }, roomId: updated.roomId, status: { in: ["scheduled", "in_progress"] }, startDate: { lte: now }, endDate: { gte: now } },
      });
      if (!otherActive)
        await prisma.room.update({ where: { id: updated.roomId }, data: { status: "available" } });
    }

    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[PATCH /maintenances/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/maintenances/:id/status", requireScope("rooms:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const { status } = z.object({ status: maintenanceStatusEnum }).parse(req.body);
    const maintenance = await prisma.roomMaintenance.findUnique({ where: { id } });
    if (!maintenance) return res.status(404).json({ error: "Maintenance introuvable" });

    const updated = await prisma.roomMaintenance.update({ where: { id }, data: { status }, include: { room: true } });

    const now = new Date();
    if (status === "in_progress") {
      await prisma.room.update({ where: { id: updated.roomId }, data: { status: "maintenance" } });
    } else if (status === "completed" || status === "cancelled") {
      const otherActive = await prisma.roomMaintenance.findFirst({
        where: { id: { not: id }, roomId: updated.roomId, status: { in: ["scheduled", "in_progress"] }, startDate: { lte: now }, endDate: { gte: now } },
      });
      if (!otherActive)
        await prisma.room.update({ where: { id: updated.roomId }, data: { status: "available" } });
    }

    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[PATCH /maintenances/:id/status]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.delete("/maintenances/:id", requireScope("rooms:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const maintenance = await prisma.roomMaintenance.findUnique({ where: { id } });
    if (!maintenance) return res.status(404).json({ error: "Maintenance introuvable" });
    if (maintenance.status === "in_progress")
      return res.status(400).json({ error: "Impossible de supprimer une maintenance en cours. Terminez-la ou annulez-la d'abord." });
    await prisma.roomMaintenance.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error("[DELETE /maintenances/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ROOMS
// ════════════════════════════════════════════════════════════════════════════

r.get("/rooms", requireScope("rooms:read"), async (_req, res) => {
  try {
    const rooms = await prisma.room.findMany({ orderBy: { number: "asc" } });
    res.json(rooms);
  } catch (err) {
    console.error("[GET /rooms]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.get("/rooms/:id", requireScope("rooms:read"), async (req, res) => {
  try {
    const id   = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room) return res.status(404).json({ error: "Chambre introuvable" });
    res.json(room);
  } catch (err) {
    console.error("[GET /rooms/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/rooms", requireScope("rooms:write"), async (req, res) => {
  try {
    const schema = z.object({
      number: z.string(),
      type:   z.string(),
      status: z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]),
    });
    const data    = schema.parse(req.body);
    const created = await prisma.room.create({ data });
    res.status(201).json(created);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return res.status(409).json({ error: "Ce numéro de chambre est déjà utilisé" });
    console.error("[POST /rooms]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/rooms/:id", requireScope("rooms:write"), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const schema = z.object({
      number: z.string().optional(),
      type:   z.string().optional(),
      status: z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]).optional(),
    });
    const updated = await prisma.room.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      return res.status(404).json({ error: "Chambre introuvable" });
    console.error("[PATCH /rooms/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/rooms/:id/status", requireScope("rooms:write"), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const schema = z.object({
      status: z.enum(["available", "occupied", "cleaning", "maintenance", "out_of_order"]),
    });
    const updated = await prisma.room.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      return res.status(404).json({ error: "Chambre introuvable" });
    console.error("[PATCH /rooms/:id/status]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.delete("/rooms/:id", requireScope("rooms:write"), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const hasRes = await prisma.reservation.count({ where: { roomId: id } });
    if (hasRes) return res.status(400).json({ error: "Impossible de supprimer une chambre ayant des réservations" });
    await prisma.room.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error("[DELETE /rooms/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GUESTS
// ════════════════════════════════════════════════════════════════════════════

r.get("/guests", requireScope("reservations:read"), async (_req, res) => {
  try {
    const guests = await prisma.guest.findMany({ orderBy: { id: "desc" } });
    res.json(guests);
  } catch (err) {
    console.error("[GET /guests]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/guests", requireScope("reservations:write"), async (req, res) => {
  try {
    const schema = z.object({
      fullName: z.string().min(1),
      phone:    z.string().optional(),
      email:    z.string().email().optional(),
      notes:    z.string().optional(),
    });
    const created = await prisma.guest.create({ data: schema.parse(req.body) });
    res.status(201).json(created);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[POST /guests]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/guests/:id", requireScope("reservations:write"), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const schema = z.object({
      fullName: z.string().min(1).optional(),
      phone:    z.string().optional(),
      email:    z.string().email().optional(),
      notes:    z.string().optional(),
    });
    const updated = await prisma.guest.update({ where: { id }, data: schema.parse(req.body) });
    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")
      return res.status(404).json({ error: "Client introuvable" });
    console.error("[PATCH /guests/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.delete("/guests/:id", requireScope("reservations:write"), async (req, res) => {
  try {
    const id             = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const hasReservations = await prisma.reservation.count({ where: { guestId: id } });
    if (hasReservations) return res.status(400).json({ error: "Impossible de supprimer un client ayant des réservations" });
    await prisma.guest.delete({ where: { id } });
    res.status(204).end();
  } catch (err) {
    console.error("[DELETE /guests/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RESERVATIONS
// ════════════════════════════════════════════════════════════════════════════

const reservationInclude = {
  room:  true,
  guest: true,
  folio: { include: { payments: true } },
} as const;

r.get("/reservations", requireScope("reservations:read"), async (req, res) => {
  try {
    const { date } = req.query as { date?: string };
    const where    = date
      ? { checkIn: { lte: new Date(date) }, checkOut: { gte: new Date(date) } }
      : {};
    const reservations = await prisma.reservation.findMany({
      where,
      include:  reservationInclude,
      orderBy:  { createdAt: "desc" },
    });
    res.json(reservations);
  } catch (err) {
    console.error("[GET /reservations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.get("/reservations/:id", requireScope("reservations:read"), async (req, res) => {
  try {
    const id          = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const reservation = await prisma.reservation.findUnique({
      where:   { id },
      include: reservationInclude,
    });
    if (!reservation) return res.status(404).json({ error: "Réservation introuvable" });
    res.json(reservation);
  } catch (err) {
    console.error("[GET /reservations/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /hotel/reservations
// ─────────────────────────────────────────────────────────────────────────────
// rateMode = titre d'affichage uniquement — aucun impact sur les calculs.
// total folio = rate × nights, toujours, quelle que soit la valeur de rateMode.
// ─────────────────────────────────────────────────────────────────────────────
r.post("/reservations", requireScope("reservations:write"), async (req, res) => {
  try {
    const schema = z.object({
      roomId:   z.number().int().positive(),
      guest:    z.object({
        fullName: z.string().min(1),
        phone:    z.string().optional(),
        email:    z.string().optional(),
      }),
      checkIn:  z.string().datetime({ offset: true }).or(z.string().min(1)),
      checkOut: z.string().datetime({ offset: true }).or(z.string().min(1)),
      status:   z.enum(["booked", "checked_in", "checked_out", "cancelled", "no_show"]).default("booked"),
      rate:     z.number().int().min(0),
      // rateMode stocké tel quel — juste un label d'affichage
      rateMode: z.enum(["per_night", "per_stay"]).default("per_night"),
    });
    const input = schema.parse(req.body);

    const checkIn  = new Date(input.checkIn);
    const checkOut = new Date(input.checkOut);

    if (checkOut <= checkIn)
      return res.status(400).json({ error: "checkOut doit être postérieur à checkIn" });

    const room = await prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room) return res.status(404).json({ error: "Chambre introuvable" });

    // Anti-overbooking
    const overlap = await prisma.reservation.findFirst({
      where: {
        roomId: input.roomId,
        status: { in: ["booked", "checked_in"] },
        AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
      },
    });
    if (overlap) return res.status(409).json({ error: "Chambre déjà réservée sur ces dates" });

    const nights = Math.ceil(
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
    );

    // rateMode = titre uniquement, pas de logique de calcul.
    // total = rate × nights dans tous les cas.
    const totalAmount = input.rate * nights;

    const { reservationId } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const guest = await tx.guest.create({ data: input.guest });

      // Stocker rate ET rateMode tels qu'envoyés par le front, sans conversion
      const reservation = await tx.reservation.create({
        data: {
          roomId:   input.roomId,
          guestId:  guest.id,
          checkIn,
          checkOut,
          status:   input.status,
          rate:     input.rate,     // valeur brute (pas de conversion)
          rateMode: input.rateMode, // label stocké tel quel
        },
      });

      const folio = await tx.folio.create({
        data: {
          reservationId: reservation.id,
          total:   totalAmount,
          balance: totalAmount,
        },
      });

      // Description de la charge — unité affichée selon rateMode (titre uniquement, pas de calcul)
      const unit = input.rateMode === "per_stay" ? "séjour(s)" : "nuit(s)";
      const chargeDescription = `Hébergement — ${nights} ${unit} × ${new Intl.NumberFormat("fr-FR").format(input.rate)} MGA`;

      await tx.folioCharge.create({
        data: {
          folioId:     folio.id,
          description: chargeDescription,
          qty:         nights,
          unitPrice:   input.rate,
          department:  "hotel",
        },
      });

      return { reservationId: reservation.id };
    });

    const result = await prisma.reservation.findUnique({
      where:   { id: reservationId },
      include: reservationInclude,
    });

    res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[POST /reservations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.patch("/reservations/:id", requireScope("reservations:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

    const current = await prisma.reservation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Réservation introuvable" });

    const schema = z.object({
      roomId:   z.number().int().optional(),
      checkIn:  z.string().optional(),
      checkOut: z.string().optional(),
      status:   z.enum(["booked", "checked_in", "checked_out", "cancelled", "no_show"]).optional(),
      rate:     z.number().int().min(0).optional(),
      rateMode: z.enum(["per_night", "per_stay"]).optional(),
    });
    const input = schema.parse(req.body);

    if (input.roomId || input.checkIn || input.checkOut) {
      const roomId   = input.roomId  ?? current.roomId;
      const checkIn  = new Date(input.checkIn  ?? current.checkIn);
      const checkOut = new Date(input.checkOut ?? current.checkOut);

      if (checkOut <= checkIn)
        return res.status(400).json({ error: "checkOut doit être postérieur à checkIn" });

      const overlap = await prisma.reservation.findFirst({
        where: {
          id:     { not: id },
          roomId,
          status: { in: ["booked", "checked_in"] },
          AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
        },
      });
      if (overlap) return res.status(409).json({ error: "Chambre déjà réservée sur ces dates" });
    }

    const updated = await prisma.reservation.update({
      where:   { id },
      data:    {
        ...input,
        ...(input.checkIn  ? { checkIn:  new Date(input.checkIn) }  : {}),
        ...(input.checkOut ? { checkOut: new Date(input.checkOut) } : {}),
      },
      include: reservationInclude,
    });

    res.json(updated);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[PATCH /reservations/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.delete("/reservations/:id", requireScope("reservations:write"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

    const reservation = await prisma.reservation.findUnique({
      where:   { id },
      include: { folio: true },
    });
    if (!reservation) return res.status(404).json({ error: "Réservation introuvable" });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (reservation.folio) {
        const folioId = reservation.folio.id;
        await tx.payment.deleteMany({ where: { folioId } });
        await tx.folioCharge.deleteMany({ where: { folioId } });
        await tx.folio.delete({ where: { id: folioId } });
      }
      await tx.reservation.delete({ where: { id } });
    });

    res.status(204).end();
  } catch (err) {
    console.error("[DELETE /reservations/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/reservations/:id/checkin", requireScope("checkin:write"), async (req, res) => {
  try {
    const id      = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

    const current = await prisma.reservation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Réservation introuvable" });

    if (current.status !== "booked") {
      return res.status(400).json({
        error:          "Impossible d'effectuer le check-in",
        currentStatus:  current.status,
        expectedStatus: "booked",
      });
    }

    const updated = await prisma.reservation.update({
      where:   { id },
      data:    { status: "checked_in" },
      include: reservationInclude,
    });
    await prisma.room.update({ where: { id: updated.roomId }, data: { status: "occupied" } });

    res.json(updated);
  } catch (err) {
    console.error("[POST /reservations/:id/checkin]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/reservations/:id/checkout", requireScope("checkout:write"), async (req, res) => {
  try {
    const id      = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

    const current = await prisma.reservation.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Réservation introuvable" });

    if (current.status !== "checked_in") {
      return res.status(400).json({
        error:          "Impossible d'effectuer le check-out",
        currentStatus:  current.status,
        expectedStatus: "checked_in",
      });
    }

    const updated = await prisma.reservation.update({
      where:   { id },
      data:    { status: "checked_out" },
      include: reservationInclude,
    });
    await prisma.room.update({ where: { id: updated.roomId }, data: { status: "cleaning" } });

    res.json(updated);
  } catch (err) {
    console.error("[POST /reservations/:id/checkout]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FOLIOS
// ════════════════════════════════════════════════════════════════════════════

r.get("/folios/:id", requireScope("folios:read"), async (req, res) => {
  try {
    const id    = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const folio = await prisma.folio.findUnique({
      where:   { id },
      include: {
        charges:     true,
        payments:    true,
        reservation: { include: { room: true, guest: true } },
      },
    });
    if (!folio) return res.status(404).json({ error: "Folio introuvable" });
    res.json(folio);
  } catch (err) {
    console.error("[GET /folios/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/folios/:id/charge", requireScope("folios:write"), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

    const folio = await prisma.folio.findUnique({ where: { id } });
    if (!folio) return res.status(404).json({ error: "Folio introuvable" });
    if (folio.closedAt) return res.status(400).json({ error: "Impossible d'ajouter une charge sur un folio clôturé" });

    const schema = z.object({
      description: z.string().min(1),
      qty:         z.number().int().min(1),
      unitPrice:   z.number().int().min(0),
      department:  z.enum(["hotel", "restaurant", "pub", "spa"]),
    });
    const input  = schema.parse(req.body);
    const charge = await prisma.folioCharge.create({ data: { ...input, folioId: id } });

    const allCharges  = await prisma.folioCharge.findMany({ where: { folioId: id } });
    const allPayments = await prisma.payment.findMany({ where: { folioId: id } });
    const total   = allCharges.reduce((s, c) => s + c.qty * c.unitPrice, 0);
    const paid    = allPayments.reduce((s, p) => s + p.amount, 0);
    const balance = Math.max(0, total - paid);

    await prisma.folio.update({ where: { id }, data: { total, balance } });

    res.status(201).json(charge);
  } catch (err: unknown) {
    if (err instanceof z.ZodError)
      return res.status(422).json({ error: "Données invalides", details: err.errors });
    console.error("[POST /folios/:id/charge]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

r.post("/folios/:id/close", requireScope("folios:write"), async (req, res) => {
  try {
    const id    = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "id invalide" });
    const folio = await prisma.folio.findUnique({ where: { id } });
    if (!folio) return res.status(404).json({ error: "Folio introuvable" });
    if (folio.closedAt) return res.status(400).json({ error: "Folio déjà clôturé" });
    const updated = await prisma.folio.update({ where: { id }, data: { closedAt: new Date() } });
    res.json(updated);
  } catch (err) {
    console.error("[POST /folios/:id/close]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default r;