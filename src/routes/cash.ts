import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireScope } from "../middleware/requireScope";
import { pushNotification } from "../services/notificationService";

const r = Router();

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

const METHOD_LBL: Record<string, string> = {
  cash:   "Espèces",
  card:   "Carte bancaire",
  mobile: "Mobile Money",
  bank:   "Virement bancaire",
};

const DEPT_LBL: Record<string, string> = {
  hotel:      "Hôtel",
  restaurant: "Restaurant",
  pub:        "Pub/Bar",
  spa:        "Spa",
};

// ── Sessions caisse ────────────────────────────────────────────────────────────

r.get("/sessions", requireScope("cash:read"), async (req, res) => {
  const { dept } = req.query as any;
  const sessions = await prisma.cashSession.findMany({
    where: { ...(dept ? { department: dept } : {}) },
    orderBy: { openedAt: "desc" },
  });
  res.json(sessions);
});

r.post("/sessions/open", requireScope("cash:open"), async (req, res) => {
  const schema = z.object({
    department:   z.enum(["hotel", "restaurant", "pub", "spa"]),
    openedBy:     z.string(),
    openingFloat: z.number().int().min(0),
  });

  const body = schema.parse(req.body);

  const created = await prisma.cashSession.create({
    data: { ...body, status: "open" },
  });

  // Notification ouverture de caisse
  pushNotification({
    event: "info",
    title: `🏦 Caisse ouverte — ${DEPT_LBL[body.department] ?? body.department}`,
    body: `Par ${body.openedBy} · Fond : ${fmt(body.openingFloat)} Ar`,
    targetRoles: ["admin", "manager", "cashier"],
    meta: { sessionId: created.id, department: body.department, openingFloat: body.openingFloat },
  }).catch(() => {});

  res.status(201).json(created);
});

r.post("/sessions/:id/close", requireScope("cash:close"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ closingAmount: z.number().int().min(0) });
  const input = schema.parse(req.body);

  const closed = await prisma.cashSession.update({
    where: { id },
    data: { status: "closed", closedAt: new Date(), closingAmount: input.closingAmount },
  });

  // Notification fermeture de caisse
  pushNotification({
    event: "info",
    title: `🔒 Caisse clôturée — ${DEPT_LBL[closed.department] ?? closed.department}`,
    body: `Montant de clôture : ${fmt(input.closingAmount)} Ar`,
    targetRoles: ["admin", "manager", "cashier"],
    meta: { sessionId: id, closingAmount: input.closingAmount, department: closed.department },
  }).catch(() => {});

  res.json(closed);
});

// ── Paiements ─────────────────────────────────────────────────────────────────

r.get("/payments", requireScope("payments:read"), async (req, res) => {
  const { dept } = req.query as any;
  const pays = await prisma.payment.findMany({
    where: { ...(dept ? { department: dept } : {}) },
    orderBy: { receivedAt: "desc" },
  });
  res.json(pays);
});

r.post("/payments", requireScope("payments:write"), async (req, res) => {
  const schema = z.object({
    department:     z.enum(["hotel", "restaurant", "pub", "spa"]),
    method:         z.enum(["cash", "card", "mobile", "bank"]),
    amount:         z.number().int().min(0),
    receivedAmount: z.number().int().min(0).optional(),
    orderId:        z.number().int().optional(),
    folioId:        z.number().int().optional(),
    tabId:          z.number().int().optional(),
    cashSessionId:  z.number().int().optional(),
    reference:      z.string().optional(),
  });

  const input = schema.parse(req.body);

  const targets = [input.orderId, input.folioId, input.tabId].filter(Boolean);
  if (targets.length !== 1)
    return res.status(400).json({ error: "Provide exactly one of orderId, folioId or tabId" });

  // ── Frais carte ───────────────────────────────────────────────────────────
  let cardFee   = 0;
  let cardTotal = 0;

  if (input.method === "card") {
    cardFee   = Math.round(input.amount * 0.05);
    cardTotal = input.amount + cardFee;
    if (input.receivedAmount === undefined) input.receivedAmount = cardTotal;
  }

  if (
    input.method !== "card" &&
    input.receivedAmount !== undefined &&
    input.receivedAmount < input.amount
  ) {
    return res.status(400).json({ error: "receivedAmount cannot be less than amount" });
  }

  // ── Reference ────────────────────────────────────────────────────────────
  let referenceNote = input.reference || "";
  if (input.method === "card") {
    const feeNote = `Frais banque 5% = ${cardFee} Ar (informatif, gardé par banque) | Total carte = ${cardTotal} Ar`;
    referenceNote = referenceNote ? `${referenceNote} | ${feeNote}` : feeNote;
  }

  // ── Opérateur JWT ─────────────────────────────────────────────────────────
  const jwtUser = (req as any).user;
  const operatorName: string | null = jwtUser?.name ?? jwtUser?.email ?? null;
  const operatorId: number | null   = jwtUser?.id ?? null;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const payment = await tx.payment.create({
      data: {
        amount:         input.amount,
        receivedAmount: input.receivedAmount ?? null,
        method:         input.method,
        department:     input.department,
        orderId:        input.orderId,
        folioId:        input.folioId,
        tabId:          input.tabId,
        cashSessionId:  input.cashSessionId,
        reference:      referenceNote || null,
        operatorName,
        operatorId,
      },
    });

    const change =
      input.method === "cash" && input.receivedAmount
        ? Math.max(0, input.receivedAmount - input.amount)
        : 0;

    // ── Commande ─────────────────────────────────────────────────────────
    if (input.orderId) {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        include: { lines: true, payments: true },
      });
      const subtotal  = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const discount  = (order as any).discountAmount ?? 0;
      const total     = Math.max(0, subtotal - discount);
      const paid      = order.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = Math.max(0, total - paid);
      return {
        payment,
        cardFee:   input.method === "card" ? cardFee : 0,
        cardTotal: input.method === "card" ? cardTotal : 0,
        context: { type: "order", total, paid, remaining, change },
      };
    }

    // ── Folio ─────────────────────────────────────────────────────────────
    if (input.folioId) {
      const folio      = await tx.folio.findUniqueOrThrow({ where: { id: input.folioId } });
      const newBalance = Math.max(0, folio.balance - input.amount);
      const updated    = await tx.folio.update({
        where: { id: folio.id },
        data:  { balance: newBalance, closedAt: newBalance === 0 ? new Date() : folio.closedAt },
      });
      return {
        payment,
        cardFee:   input.method === "card" ? cardFee : 0,
        cardTotal: input.method === "card" ? cardTotal : 0,
        context: { type: "folio", balance: updated.balance, closed: !!updated.closedAt, change },
      };
    }

    // ── Tab ───────────────────────────────────────────────────────────────
    if (input.tabId) {
      const tab = await tx.tab.findUniqueOrThrow({
        where:   { id: input.tabId },
        include: { orders: { include: { lines: true } }, payments: true },
      });
      const total   = tab.orders.reduce((so, o) => so + o.lines.reduce((sl, l) => sl + l.qty * l.unitPrice, 0), 0);
      const paid    = tab.payments.reduce((s, p) => s + p.amount, 0);
      const balance = Math.max(0, total - paid);
      const status  = balance === 0 ? "paid" : ("unpaid" as const);
      await tx.tab.update({ where: { id: tab.id }, data: { status, balance } });
      return {
        payment,
        cardFee:   input.method === "card" ? cardFee : 0,
        cardTotal: input.method === "card" ? cardTotal : 0,
        context: { type: "tab", total, paid, balance, status, change },
      };
    }

    return {
      payment,
      cardFee:   input.method === "card" ? cardFee : 0,
      cardTotal: input.method === "card" ? cardTotal : 0,
    };
  });

  // ── Notification paiement (après transaction réussie) ─────────────────────
  const ctx = result.context as any;
  const methodLabel   = METHOD_LBL[input.method] ?? input.method;
  const deptLabel     = DEPT_LBL[input.department] ?? input.department;
  const changeInfo    = ctx?.change > 0 ? ` · Monnaie : ${fmt(ctx.change)} Ar` : "";
  const cardFeeInfo   = input.method === "card" ? ` · Frais banque : ${fmt(cardFee)} Ar` : "";
  const remainingInfo = ctx?.remaining > 0
    ? ` · Reste dû : ${fmt(ctx.remaining)} Ar`
    : ctx?.remaining === 0 ? " · Soldé ✓" : "";
  const folioInfo     = ctx?.type === "folio"
    ? ` · Folio solde : ${fmt(ctx.balance)} Ar${ctx.closed ? " (clos)" : ""}`
    : "";

  // Cible : admin, manager, cashier + l'opérateur lui-même si différent
  const notifTargetRoles = ["admin", "manager", "cashier"];

  // Notification principale (rôles caisse/admin)
  pushNotification({
    event: "payment",
    title: `💳 Paiement reçu — ${deptLabel}`,
    body: `${fmt(input.amount)} Ar via ${methodLabel}${cardFeeInfo}${changeInfo}${remainingInfo}${folioInfo}`,
    targetRoles: notifTargetRoles,
    meta: {
      paymentId:  result.payment.id,
      amount:     input.amount,
      method:     input.method,
      department: input.department,
      orderId:    input.orderId,
      folioId:    input.folioId,
      tabId:      input.tabId,
      cardFee:    input.method === "card" ? cardFee : 0,
      cardTotal:  input.method === "card" ? cardTotal : 0,
      change:     ctx?.change ?? 0,
      remaining:  ctx?.remaining ?? null,
      operatorId,
      operatorName,
    },
  }).catch(() => {});

  // Notification spécifique si folio soldé → réception
  if (ctx?.type === "folio" && ctx?.closed) {
    pushNotification({
      event: "info",
      title: `🏨 Folio soldé`,
      body: `Folio #${input.folioId} entièrement réglé (${fmt(input.amount)} Ar via ${methodLabel})`,
      targetRoles: ["admin", "manager", "reception"],
      meta: { folioId: input.folioId, amount: input.amount, method: input.method },
    }).catch(() => {});
  }

  // Notification si commande entièrement soldée → cuisine/serveur
  if (ctx?.type === "order" && ctx?.remaining === 0) {
    pushNotification({
      event: "order_closed",
      title: `✅ Commande soldée — ${deptLabel}`,
      body: `Commande #${input.orderId} — ${fmt(ctx.total)} Ar encaissés`,
      targetRoles: ["admin", "manager", "cashier", "serveur"],
      meta: { orderId: input.orderId, total: ctx.total },
    }).catch(() => {});
  }

  res.status(201).json(result);
});

// ── Remise sur commande ────────────────────────────────────────────────────────

r.patch("/orders/:id/discount", requireScope("orders:write"), async (req, res) => {
  const id = Number(req.params.id);

  const schema = z.object({
    discountAmount: z.number().min(0),
    discountReason: z.string().optional().default(""),
    discountType:   z.enum(["fixed", "percent"]).default("fixed"),
  });

  const { discountAmount, discountReason, discountType } = schema.parse(req.body);

  const order = await prisma.order.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return res.status(404).json({ error: "Commande introuvable" });
  if (order.status !== "open")
    return res.status(400).json({ error: "Impossible de modifier une commande clôturée ou annulée" });

  const subtotal = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  let finalDiscount = 0;
  if (discountType === "percent") {
    if (discountAmount < 0 || discountAmount > 100)
      return res.status(400).json({ error: "Le pourcentage doit être entre 0 et 100" });
    finalDiscount = Math.round((discountAmount / 100) * subtotal);
  } else {
    finalDiscount = Math.round(discountAmount);
  }

  if (finalDiscount > subtotal)
    return res.status(400).json({ error: "La remise ne peut pas dépasser le sous-total de la commande" });

  const updated = await (prisma.order as any).update({
    where:   { id },
    data:    { discountAmount: finalDiscount, discountReason: discountReason || null, discountType },
    include: { lines: true, payments: true },
  });

  const paid               = updated.payments.reduce((s: number, p: any) => s + p.amount, 0);
  const totalAfterDiscount = Math.max(0, subtotal - finalDiscount);
  const balance            = Math.max(0, totalAfterDiscount - paid);

  // Notification remise appliquée
  if (finalDiscount > 0) {
    const jwtUser    = (req as any).user;
    const operator   = jwtUser?.name ?? jwtUser?.email ?? "Opérateur";
    const pctDisplay = discountType === "percent"
      ? `${discountAmount}%`
      : `${fmt(finalDiscount)} Ar`;

    pushNotification({
      event: "info",
      title: `🏷️ Remise appliquée — Commande #${id}`,
      body: `${pctDisplay}${discountReason ? ` · ${discountReason}` : ""} · Nouveau total : ${fmt(totalAfterDiscount)} Ar · Par ${operator}`,
      targetRoles: ["admin", "manager"],
      meta: {
        orderId:        id,
        discountAmount: finalDiscount,
        discountType,
        discountReason: discountReason || null,
        totalAfterDiscount,
        operatorName:   operator,
      },
    }).catch(() => {});
  }

  res.json({
    ...updated,
    _computed: { subtotal, discountAmount: finalDiscount, totalAfterDiscount, paid, balance },
  });
});

export default r;