import { Router } from "express";
import { prisma } from "../db";
import { requireScope } from "../middleware/requireScope";

const r = Router();

/* ─────────────────────────────────────────────
   GET /api/folios/search?q=...
───────────────────────────────────────────── */
r.get("/search", requireScope("reports:read"), async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json([]);

  const isNumeric = !isNaN(+q);

  const folios = await prisma.folio.findMany({
    where: {
      reservation: {
        OR: [
          { guest: { fullName: { contains: q, mode: "insensitive" } } },
          { room:  { number: { contains: q, mode: "insensitive" } } },
          ...(isNumeric ? [{ id: +q }] : []),
        ],
      },
    },
    take: 20,
    include: {
      reservation: {
        include: {
          guest: { select: { fullName: true } },
          room:  { select: { number: true } },
        },
      },
    },
  });

  res.json(
    folios.map((f) => ({
      folioId:    f.id,
      guestName:  f.reservation.guest.fullName,
      roomNumber: f.reservation.room.number,
      checkIn:    new Date(f.reservation.checkIn).toLocaleDateString("fr-FR"),
      status:     f.closedAt ? "closed" : "open",
    }))
  );
});

/* ─────────────────────────────────────────────
   GET /api/folios/:id
   Returns folio with:
   - FolioCharges
   - Payments on folio
   - Linked Orders (via guestId on the same stay dates)
     Each order includes its lines + payments,
     and a computed paid / unpaid status
───────────────────────────────────────────── */
r.get("/:id", requireScope("reports:read"), async (req, res) => {
  const id = +req.params.id;
  if (isNaN(id)) return res.status(400).json({ error: "id invalide" });

  const folio = await prisma.folio.findUnique({
    where: { id },
    include: {
      charges:  true,
      payments: true,
      reservation: {
        include: {
          guest: true,
          room:  true,
        },
      },
    },
  });

  if (!folio) return res.status(404).json({ error: "Folio introuvable" });

  const res_ = folio.reservation;

  // ── Compute nights & amounts ──────────────────────────
  const nights = Math.max(
    1,
    Math.ceil(
      (new Date(res_.checkOut).getTime() - new Date(res_.checkIn).getTime()) / 86_400_000
    )
  );
  const chargesTotal  = folio.charges.reduce((s, c) => s + c.unitPrice * c.qty, 0);
  const roomTotal     = res_.rate * nights;
  const totalCharges  = chargesTotal + roomTotal;
  const totalPayments = folio.payments.reduce((s, p) => s + p.amount, 0);

  // ── Fetch linked orders ───────────────────────────────
  // Orders are linked to a folio via Payment.folioId  OR
  // we find orders opened during the stay period.
  // Strategy: look for orders whose payments reference this folio,
  // PLUS any order opened between checkIn/checkOut for the guest's tab
  // (covers room-charge restaurant/bar orders).

  // 1) Orders referenced by payments on this folio
  const paymentOrderIds = folio.payments
    .map((p) => p.orderId)
    .filter((oid): oid is number => oid !== null);

  // 2) Orders opened in the stay window (any dept) — useful when
  //    the order wasn't directly tied via payment to this folio
  const stayOrders = await prisma.order.findMany({
    where: {
      OR: [
        // Directly linked via a payment that references this folio
        { id: { in: paymentOrderIds } },
        // OR opened during stay dates (date window approach)
        {
          openedAt: {
            gte: res_.checkIn,
            lte: res_.checkOut,
          },
          // Only include orders that were charged to this guest's folio
          // via FolioCharge.description match — OR simply all stay-window
          // orders if you prefer a broad view. Adjust as needed.
          payments: {
            some: { folioId: id },
          },
        },
      ],
    },
    include: {
      lines:    true,
      payments: true,
    },
    orderBy: { openedAt: "asc" },
  });

  // ── Enrich each order with paid/unpaid status ─────────
  const enrichedOrders = stayOrders.map((o) => {
    const totalAmount = o.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const paidAmount  = o.payments.reduce((s, p) => s + p.amount, 0);
    // An order is considered "paid" if paidAmount >= totalAmount
    const paid = totalAmount > 0 && paidAmount >= totalAmount;

    return {
      id:          o.id,
      dept:        o.dept,
      openedAt:    o.openedAt.toISOString(),
      closedAt:    o.closedAt ? o.closedAt.toISOString() : null,
      status:      o.status,
      paid,
      totalAmount,
      paidAmount,
      lines: o.lines.map((l) => ({
        id:        l.id,
        itemName:  l.itemName,
        qty:       l.qty,
        unitPrice: l.unitPrice,
      })),
    };
  });

  res.json({
    folioId:       folio.id,
    reservationId: res_.id,
    guestName:     res_.guest.fullName,
    guestPhone:    res_.guest.phone    ?? null,
    guestEmail:    res_.guest.email    ?? null,
    guestAddress:  res_.guest.address  ?? null,
    guestCompany:  res_.guest.company  ?? null,
    roomNumber:    res_.room.number,
    roomType:      res_.room.type,
    checkIn:       new Date(res_.checkIn).toLocaleDateString("fr-FR"),
    checkOut:      new Date(res_.checkOut).toLocaleDateString("fr-FR"),
    nights,
    ratePerNight:  res_.rate,
    charges:       folio.charges,
    payments:      folio.payments,
    orders:        enrichedOrders,          // ← NEW
    totalCharges,
    totalPayments,
    balance:       totalCharges - totalPayments,
    status:        folio.closedAt ? "closed" : "open",
  });
});

export default r;