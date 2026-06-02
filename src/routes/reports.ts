import { Router } from "express";
import { prisma } from "../db";
import { requireScope } from "../middleware/requireScope";
import { z } from "zod";
import { pushNotification } from "../services/notificationService";

const r = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayRange(dateStr: string) {
  const start = new Date(dateStr);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function periodRange(from: string, to: string) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ── GET /reports/daily ────────────────────────────────────────────────────────

r.get("/daily", requireScope("reports:read"), async (req, res) => {
  const { dept, date } = req.query as any;
  if (!dept || !date) return res.status(400).json({ error: "dept and date are required" });

  const { start, end } = dayRange(String(date));
  const lines: { label: string; qty: number; unit: number; total: number }[] = [];

  if (dept === "restaurant" || dept === "lounge" || dept === "hotel_services" || dept === "casino") {
    const mappedDept = dept === "hotel_services" ? "hotel" : dept;

    const orders = await prisma.order.findMany({
      where: { dept: mappedDept, openedAt: { gte: start, lt: end } },
      include: {
        lines: true,
        payments: {
          include: {
            operator: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { openedAt: "asc" },
    });

    for (const o of orders)
      for (const l of o.lines)
        lines.push({ label: l.itemName, qty: l.qty, unit: l.unitPrice, total: l.unitPrice * l.qty });

    const ordersDetail = orders.map((o) => {
      const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const discountAmount = (o as any).discountAmount ?? 0;
      const orderTotal = Math.max(0, subtotal - discountAmount);
      const paid = o.payments.reduce((s, p) => s + p.amount, 0);

      const payments = (o.payments as any[]).map((p) => {
        const received = p.receivedAmount != null ? p.receivedAmount : null;
        const change = received != null ? Math.max(0, received - p.amount) : 0;
        const operatorName = p.operator?.name ?? p.operatorName ?? null;
        const operatorUser = p.operator?.email ?? null;
        const operatorDisplay = p.operator
          ? (p.operator.name ?? p.operator.email ?? null)
          : (p.operatorName ?? null);

        return {
          id: p.id,
          method: p.method,
          amount: p.amount,
          receivedAmount: received,
          change,
          receivedAt: p.receivedAt,
          operatorName,
          operatorUser,
          operatorDisplay,
        };
      });

      const totalReceived = payments.reduce((s, p) => s + (p.receivedAmount ?? 0), 0);
      const totalChange = payments.reduce((s, p) => s + p.change, 0);

      return {
        id: o.id,
        tableId: o.tableId,
        openedAt: o.openedAt,
        closedAt: o.closedAt,
        status: o.status,
        discountAmount,
        discountType: (o as any).discountType ?? "fixed",
        discountReason: (o as any).discountReason ?? null,
        lines: o.lines.map((l) => ({
          itemName: l.itemName,
          qty: l.qty,
          unitPrice: l.unitPrice,
          total: l.qty * l.unitPrice,
        })),
        payments,
        subtotal,
        orderTotal,
        paid,
        receivedAmount: totalReceived,
        change: totalChange,
        remaining: Math.max(0, orderTotal - paid),
      };
    });

    const total = ordersDetail.reduce((s, o) => s + o.orderTotal, 0);
    return res.json({ date: String(date), dept: mappedDept, lines, total, ordersDetail });
  }

  if (dept === "hotel_reservations") {
    const reservations = await prisma.reservation.findMany({
      where: {
        OR: [
          { checkIn: { gte: start, lt: end } },
          { checkOut: { gte: start, lt: end } },
          { AND: [{ checkIn: { lte: start } }, { checkOut: { gte: end } }] },
        ],
      },
      include: {
        room: { select: { number: true, type: true } },
        guest: { select: { fullName: true } },
        folio: { include: { payments: true, charges: true } },
      },
      orderBy: { checkIn: "asc" },
    });

    const reservationsDetail = reservations.map((res) => {
      const nights = Math.max(1, Math.ceil(
        (new Date(res.checkOut).getTime() - new Date(res.checkIn).getTime()) / 86_400_000
      ));
      const charges = res.folio?.charges.reduce((s, c) => s + c.qty * c.unitPrice, 0) ?? 0;
      const paid = res.folio?.payments.reduce((s, p) => s + p.amount, 0) ?? 0;
      const folioBalance = Math.max(0, charges - paid);

      return {
        guestName: res.guest.fullName,
        roomNumber: res.room.number,
        roomType: res.room.type,
        checkIn: res.checkIn.toISOString().slice(0, 10),
        checkOut: res.checkOut.toISOString().slice(0, 10),
        nights,
        rate: res.rate,
        total: nights * res.rate,
        status: res.status,
        folioBalance,
      };
    });

    const total = reservationsDetail.reduce((s, r) => s + r.total, 0);
    const totalInHouse = await prisma.reservation.count({ where: { status: "checked_in" } });
    const totalRooms = await prisma.room.count({ where: { status: { not: "out_of_order" } } });
    const occupancyRate = totalRooms > 0 ? Math.round((totalInHouse / totalRooms) * 100) : 0;
    const arrivals = reservations.filter(
      (r) => r.status === "checked_in" && new Date(r.checkIn) >= start && new Date(r.checkIn) < end
    ).length;
    const departures = reservations.filter(
      (r) => r.status === "checked_out" && new Date(r.checkOut) >= start && new Date(r.checkOut) < end
    ).length;

    return res.json({
      date: String(date),
      dept,
      lines,
      total,
      reservations: reservationsDetail,
      occupancyRate,
      arrivals,
      departures,
      inHouse: totalInHouse,
    });
  }

  const total = lines.reduce((s, l) => s + l.total, 0);
  return res.json({ date: String(date), dept, lines, total });
});

// ── GET /reports/sales ────────────────────────────────────────────────────────

r.get("/sales", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({
    from: z.string(),
    to: z.string(),
    dept: z.enum(["all", "restaurant", "lounge", "hotel", "casino"]).default("all"),
  });

  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);
  const result: Record<string, any> = { from: input.from, to: input.to, dept: input.dept };

  // ── Restaurant / Lounge ───────────────────────────────────────────────────
  if (input.dept === "all" || input.dept === "restaurant" || input.dept === "lounge") {
    const depts = input.dept === "all" ? ["restaurant", "lounge"] : [input.dept];

    const orders = await prisma.order.findMany({
      where: { dept: { in: depts as any }, openedAt: { gte: start, lte: end } },
      include: {
        lines: true,
        payments: { include: { operator: { select: { name: true, email: true } } } },
        table: { select: { code: true } },
      },
      orderBy: { openedAt: "asc" },
    });

    const ordersSummary = orders.map((o) => {
      const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const discount = (o as any).discountAmount ?? 0;
      const total = Math.max(0, subtotal - discount);
      const paid = o.payments.reduce((s, p) => s + p.amount, 0);
      return {
        id: o.id,
        dept: o.dept,
        tableCode: (o as any).table?.code ?? null,
        openedAt: o.openedAt,
        closedAt: o.closedAt,
        status: o.status,
        subtotal,
        discount,
        total,
        paid,
        balance: Math.max(0, total - paid),
        itemCount: o.lines.reduce((s, l) => s + l.qty, 0),
        paymentMethods: [...new Set(o.payments.map((p) => p.method))],
        lines: o.lines.map((l) => ({
          name: l.itemName,
          qty: l.qty,
          unitPrice: l.unitPrice,
          total: l.qty * l.unitPrice,
        })),
      };
    });

    const totalRevenue = ordersSummary.reduce((s, o) => s + o.total, 0);
    const totalPaid = ordersSummary.reduce((s, o) => s + o.paid, 0);
    const totalDiscount = ordersSummary.reduce((s, o) => s + o.discount, 0);
    const closedOrders = ordersSummary.filter((o) => o.status === "closed").length;

    const itemMap = new Map<string, { qty: number; total: number }>();
    for (const o of orders)
      for (const l of o.lines) {
        const cur = itemMap.get(l.itemName) ?? { qty: 0, total: 0 };
        itemMap.set(l.itemName, { qty: cur.qty + l.qty, total: cur.total + l.qty * l.unitPrice });
      }
    const topItems = [...itemMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const methodMap = new Map<string, number>();
    for (const o of orders)
      for (const p of o.payments)
        methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + p.amount);
    const paymentBreakdown = [...methodMap.entries()].map(([method, amount]) => ({ method, amount }));

    const dayMap = new Map<string, number>();
    for (const o of ordersSummary) {
      const day = new Date(o.openedAt).toISOString().slice(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + o.total);
    }
    const dailyRevenue = [...dayMap.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    result.restaurant = {
      orders: ordersSummary,
      summary: {
        totalOrders: orders.length,
        closedOrders,
        totalRevenue,
        totalPaid,
        totalDiscount,
        unpaidBalance: totalRevenue - totalPaid,
      },
      topItems,
      paymentBreakdown,
      dailyRevenue,
    };
  }

  // ── Hôtel ─────────────────────────────────────────────────────────────────
  if (input.dept === "all" || input.dept === "hotel") {
    const reservations = await prisma.reservation.findMany({
      where: {
        OR: [
          { checkIn: { gte: start, lte: end } },
          { checkOut: { gte: start, lte: end } },
          { AND: [{ checkIn: { lte: start } }, { checkOut: { gte: end } }] },
        ],
      },
      include: {
        room: { select: { number: true, type: true } },
        guest: { select: { fullName: true } },
        folio: { include: { payments: true, charges: true } },
      },
      orderBy: { checkIn: "asc" },
    });

    const resSummary = reservations.map((res) => {
      const nights = Math.max(1, Math.ceil(
        (new Date(res.checkOut).getTime() - new Date(res.checkIn).getTime()) / 86_400_000
      ));
      const charges = res.folio?.charges.reduce((s, c) => s + c.qty * c.unitPrice, 0) ?? 0;
      const paid = res.folio?.payments.reduce((s, p) => s + p.amount, 0) ?? 0;
      return {
        id: res.id,
        status: res.status,
        guestName: res.guest.fullName,
        roomNumber: res.room.number,
        roomType: res.room.type,
        checkIn: res.checkIn,
        checkOut: res.checkOut,
        nights,
        rate: res.rate,
        rateMode: res.rateMode,
        totalCharges: charges,
        paid,
        balance: Math.max(0, charges - paid),
      };
    });

    const totalRevenue = resSummary.reduce((s, r) => s + r.totalCharges, 0);
    const totalPaid = resSummary.reduce((s, r) => s + r.paid, 0);
    const checkedIn = resSummary.filter((r) => r.status === "checked_in").length;
    const checkedOut = resSummary.filter((r) => r.status === "checked_out").length;

    result.hotel = {
      reservations: resSummary,
      summary: {
        totalReservations: reservations.length,
        checkedIn,
        checkedOut,
        totalRevenue,
        totalPaid,
        unpaidBalance: totalRevenue - totalPaid,
      },
    };
  }

  // ── Casino ────────────────────────────────────────────────────────────────
  if (input.dept === "all" || input.dept === "casino") {
    const appointments = await prisma.appointment.findMany({
      where: { start: { gte: start, lte: end } },
      orderBy: { start: "asc" },
    });

    const completed = appointments.filter((a) => a.status === "completed");
    const totalRevenue = completed.reduce((s, a) => s + a.price, 0);

    const serviceMap = new Map<string, { count: number; revenue: number }>();
    for (const a of completed) {
      const cur = serviceMap.get(a.serviceName) ?? { count: 0, revenue: 0 };
      serviceMap.set(a.serviceName, { count: cur.count + 1, revenue: cur.revenue + a.price });
    }
    const serviceBreakdown = [...serviceMap.entries()]
      .map(([service, v]) => ({ service, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    result.casino = {
      appointments: appointments.map((a) => ({
        id: a.id,
        clientName: a.clientName,
        serviceName: a.serviceName,
        start: a.start,
        durationMin: a.durationMin,
        status: a.status,
        price: a.price,
      })),
      summary: {
        total: appointments.length,
        completed: completed.length,
        totalRevenue,
        serviceBreakdown,
      },
    };
  }

  res.json(result);
});

// ── GET /reports/stock ────────────────────────────────────────────────────────

r.get("/stock", requireScope("reports:read"), async (req, res) => {
  const { storeId } = req.query as any;

  const stocks = await prisma.stock.findMany({
    where: storeId ? { storeId: Number(storeId) } : {},
    include: {
      item: { select: { sku: true, name: true, unit: true, category: true, costPrice: true, salePriceDefault: true, isActive: true } },
      store: { select: { name: true, department: true } },
    },
    orderBy: [{ store: { name: "asc" } }, { item: { name: "asc" } }],
  });

  const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });

  const lowStock = stocks.filter((s) => s.qty <= s.minQty);
  const outOfStock = stocks.filter((s) => s.qty === 0);
  const totalValue = stocks.reduce((sum, s) => sum + s.qty * Number(s.item.costPrice), 0);

  const byStore = stores.map((store) => {
    const storeStocks = stocks.filter((s) => s.storeId === store.id);
    const storeValue = storeStocks.reduce((sum, s) => sum + s.qty * Number(s.item.costPrice), 0);
    return {
      store: { id: store.id, name: store.name, department: store.department },
      items: storeStocks.map((s) => ({
        itemId: s.itemId,
        sku: s.item.sku,
        name: s.item.name,
        unit: s.item.unit,
        category: s.item.category,
        qty: s.qty,
        minQty: s.minQty,
        maxQty: s.maxQty,
        costPrice: Number(s.item.costPrice),
        salePrice: Number(s.item.salePriceDefault),
        stockValue: s.qty * Number(s.item.costPrice),
        status: s.qty === 0 ? "out" : s.qty <= s.minQty ? "low" : "ok",
      })),
      totalValue: storeValue,
      itemCount: storeStocks.length,
      lowStockCount: storeStocks.filter((s) => s.qty <= s.minQty && s.qty > 0).length,
      outOfStockCount: storeStocks.filter((s) => s.qty === 0).length,
    };
  });

  const response = {
    summary: {
      totalItems: stocks.length,
      totalValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
    },
    byStore,
    alerts: {
      low: lowStock.map((s) => ({ itemName: s.item.name, storeName: s.store.name, qty: s.qty, minQty: s.minQty })),
      out: outOfStock.map((s) => ({ itemName: s.item.name, storeName: s.store.name })),
    },
  };

  const notifPromises: Promise<any>[] = [];

  if (outOfStock.length > 0) {
    notifPromises.push(pushNotification({
      event: "low_stock",
      title: `${outOfStock.length} article(s) en rupture de stock`,
      body: outOfStock.slice(0, 5).map((s) => `${s.item.name} (${s.store.name})`).join(", ") +
        (outOfStock.length > 5 ? ` +${outOfStock.length - 5} autres` : ""),
      targetRoles: ["admin", "manager"],
      meta: { type: "out_of_stock", count: outOfStock.length, items: outOfStock.map((s) => ({ itemName: s.item.name, storeName: s.store.name })) },
    }));
  }

  if (lowStock.filter((s) => s.qty > 0).length > 0) {
    const lowOnly = lowStock.filter((s) => s.qty > 0);
    notifPromises.push(pushNotification({
      event: "low_stock",
      title: `${lowOnly.length} article(s) sous le seuil minimum`,
      body: lowOnly.slice(0, 5).map((s) => `${s.item.name} — ${s.qty}/${s.minQty} (${s.store.name})`).join(", ") +
        (lowOnly.length > 5 ? ` +${lowOnly.length - 5} autres` : ""),
      targetRoles: ["admin", "manager"],
      meta: { type: "low_stock", count: lowOnly.length, items: lowOnly.map((s) => ({ itemName: s.item.name, storeName: s.store.name, qty: s.qty, minQty: s.minQty })) },
    }));
  }

  await Promise.allSettled(notifPromises);
  return res.json(response);
});

// ── GET /reports/orders ───────────────────────────────────────────────────────

r.get("/orders", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({
    from: z.string(),
    to: z.string(),
    dept: z.enum(["restaurant", "lounge", "casino"]).optional(),
    status: z.enum(["open", "closed", "cancelled"]).optional(),
  });

  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);

  const orders = await prisma.order.findMany({
    where: {
      openedAt: { gte: start, lte: end },
      ...(input.dept ? { dept: input.dept } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: {
      lines: true,
      table: { select: { code: true } },
      payments: { include: { operator: { select: { name: true, email: true } } } },
    },
    orderBy: { openedAt: "desc" },
  });

  const data = orders.map((o) => {
    const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discount = (o as any).discountAmount ?? 0;
    const total = Math.max(0, subtotal - discount);
    const paid = o.payments.reduce((s, p) => s + p.amount, 0);
    return {
      id: o.id,
      dept: o.dept,
      status: o.status,
      tableCode: (o as any).table?.code ?? null,
      openedAt: o.openedAt,
      closedAt: o.closedAt,
      itemCount: o.lines.reduce((s, l) => s + l.qty, 0),
      subtotal,
      discount,
      total,
      paid,
      balance: Math.max(0, total - paid),
      lines: o.lines.map((l) => ({ name: l.itemName, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice })),
      payments: (o.payments as any[]).map((p) => ({
        method: p.method,
        amount: p.amount,
        receivedAmount: p.receivedAmount != null ? p.receivedAmount : null,
        change: p.receivedAmount != null ? Math.max(0, p.receivedAmount - p.amount) : 0,
        operatorName: p.operator?.name ?? p.operator?.email ?? p.operatorName ?? null,
      })),
    };
  });

  const totalRevenue = data.reduce((s, o) => s + o.total, 0);
  const totalPaid = data.reduce((s, o) => s + o.paid, 0);

  res.json({
    from: input.from,
    to: input.to,
    summary: {
      total: orders.length,
      open: data.filter((o) => o.status === "open").length,
      closed: data.filter((o) => o.status === "closed").length,
      cancelled: data.filter((o) => o.status === "cancelled").length,
      totalRevenue,
      totalPaid,
      unpaidBalance: totalRevenue - totalPaid,
    },
    orders: data,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOP 5 ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /reports/revenue-by-room ──────────────────────────────────────────────
// CORRIGÉ: calcul du % basé sur totalRevenue de toutes les chambres

r.get("/revenue-by-room", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({ from: z.string(), to: z.string() });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);

  const reservations = await prisma.reservation.findMany({
    where: {
      OR: [
        { checkIn: { gte: start, lte: end } },
        { checkOut: { gte: start, lte: end } },
        { AND: [{ checkIn: { lte: start } }, { checkOut: { gte: end } }] },
      ],
    },
    include: {
      room: { select: { number: true, type: true } },
      folio: { include: { charges: true } },
    },
  });

  // Agréger par chambre
  const roomMap = new Map<string, { type: string; revenue: number; nights: number; orders: number }>();
  for (const res of reservations) {
    const key = res.room.number;
    const nights = Math.max(1, Math.ceil(
      (new Date(res.checkOut).getTime() - new Date(res.checkIn).getTime()) / 86_400_000
    ));
    // CORRIGÉ: utiliser les charges du folio si disponibles, sinon nights × rate
    const revenue = res.folio?.charges.reduce((s, c) => s + c.qty * c.unitPrice, 0) ?? nights * res.rate;
    const cur = roomMap.get(key) ?? { type: res.room.type, revenue: 0, nights: 0, orders: 0 };
    roomMap.set(key, {
      type: cur.type,
      revenue: cur.revenue + revenue,
      nights: cur.nights + nights,
      orders: cur.orders + 1,
    });
  }

  // CORRIGÉ: total calculé sur l'ensemble des chambres (pas le grandTotal multi-dept)
  const totalRevenue = [...roomMap.values()].reduce((s, v) => s + v.revenue, 0);

  const rooms = [...roomMap.entries()]
    .map(([number, v]) => ({
      number,
      type: v.type,
      revenue: v.revenue,
      nights: v.nights,
      orders: v.orders,
      averagePerNight: v.nights > 0 ? Math.round(v.revenue / v.nights) : 0,
      // CORRIGÉ: % sur le total des chambres uniquement
      percentage: totalRevenue > 0 ? Math.round((v.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // Taux d'occupation
  const totalInHouse = await prisma.reservation.count({ where: { status: "checked_in" } });
  const totalRooms = await prisma.room.count({ where: { status: { not: "out_of_order" } } });
  const occupancyRate = totalRooms > 0 ? Math.round((totalInHouse / totalRooms) * 100) : 0;

  res.json({ from: input.from, to: input.to, totalRevenue, occupancyRate, rooms });
});

// ── GET /reports/revenue-by-client ────────────────────────────────────────────
// CORRIGÉ: inclut les commandes POS + folio hôtel, calcul du % correct

r.get("/revenue-by-client", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({ from: z.string(), to: z.string() });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);

  // Réservations avec folio
  const reservations = await prisma.reservation.findMany({
    where: {
      OR: [
        { checkIn: { gte: start, lte: end } },
        { checkOut: { gte: start, lte: end } },
        { AND: [{ checkIn: { lte: start } }, { checkOut: { gte: end } }] },
      ],
    },
    include: {
      guest: { select: { id: true, fullName: true } },
      folio: { include: { charges: true, payments: true } },
    },
  });

  // Order n'a pas de guestId/guest dans le schéma — on se base uniquement sur les folios hôtel
  type ClientData = { name: string; revenue: number; stays: number; orders: number };
  const clientMap = new Map<number, ClientData>();

  for (const res of reservations) {
    const guestId = res.guest.id;
    const nights = Math.max(1, Math.ceil(
      (new Date(res.checkOut).getTime() - new Date(res.checkIn).getTime()) / 86_400_000
    ));
    // Prioriser les charges du folio, sinon nights × rate
    const revenue = res.folio?.charges.reduce((s, c) => s + c.qty * c.unitPrice, 0) ?? nights * res.rate;
    // Nombre de commandes liées au folio (charges individuelles)
    const folioOrders = res.folio?.charges.length ?? 0;
    const cur = clientMap.get(guestId) ?? { name: res.guest.fullName, revenue: 0, stays: 0, orders: 0 };
    clientMap.set(guestId, {
      name: cur.name,
      revenue: cur.revenue + revenue,
      stays: cur.stays + 1,
      orders: cur.orders + folioOrders,
    });
  }

  // CORRIGÉ: % sur le total des clients uniquement
  const totalRevenue = [...clientMap.values()].reduce((s, v) => s + v.revenue, 0);

  const clients = [...clientMap.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      revenue: v.revenue,
      stays: v.stays,
      orders: v.orders,
      averagePerStay: v.stays > 0 ? Math.round(v.revenue / v.stays) : 0,
      // CORRIGÉ: % sur le total clients, pas grandTotal multi-dept
      percentage: totalRevenue > 0 ? Math.round((v.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({ from: input.from, to: input.to, totalRevenue, clients });
});

// ── GET /reports/revenue-by-pos ───────────────────────────────────────────────
// CORRIGÉ: inclut casino (appointments), calcul du % correct

r.get("/revenue-by-pos", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({ from: z.string(), to: z.string() });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);

  // Commandes par département (restaurant, lounge)
  const orders = await prisma.order.findMany({
    where: { openedAt: { gte: start, lte: end } },
    select: {
      dept: true,
      lines: { select: { qty: true, unitPrice: true } },
      discountAmount: true,
    },
  });

  // CORRIGÉ: deptMap initialisé avec tous les départements connus → évite "0 commandes" manquant
  const deptMap = new Map<string, { revenue: number; orders: number }>([
    ["restaurant", { revenue: 0, orders: 0 }],
    ["lounge", { revenue: 0, orders: 0 }],
  ]);

  for (const o of orders) {
    const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discount = (o as any).discountAmount ?? 0;
    const total = Math.max(0, subtotal - discount);
    const cur = deptMap.get(o.dept) ?? { revenue: 0, orders: 0 };
    deptMap.set(o.dept, { revenue: cur.revenue + total, orders: cur.orders + 1 });
  }

  // Hôtel : somme des charges folio sur la période
  const hotelCharges = await prisma.folioCharge.aggregate({
    where: { createdAt: { gte: start, lte: end } },
    _sum: { qty: true },
  });
  // CORRIGÉ: utiliser une requête agrégée propre
  const hotelFolioItems = await prisma.folioCharge.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { qty: true, unitPrice: true },
  });
  const hotelRevenue = hotelFolioItems.reduce((s, c) => s + c.qty * c.unitPrice, 0);
  const hotelReservationsCount = await prisma.reservation.count({
    where: {
      OR: [
        { checkIn: { gte: start, lte: end } },
        { checkOut: { gte: start, lte: end } },
        { AND: [{ checkIn: { lte: start } }, { checkOut: { gte: end } }] },
      ],
    },
  });
  deptMap.set("hotel", { revenue: hotelRevenue, orders: hotelReservationsCount });

  // AJOUT: Casino (appointments complétés)
  const casinoAppointments = await prisma.appointment.findMany({
    where: { start: { gte: start, lte: end }, status: "completed" },
    select: { price: true },
  });
  const casinoRevenue = casinoAppointments.reduce((s, a) => s + a.price, 0);
  deptMap.set("casino", { revenue: casinoRevenue, orders: casinoAppointments.length });

  // CORRIGÉ: total sur tous les POS (pas grandTotal from salesQuery)
  const totalRevenue = [...deptMap.values()].reduce((s, v) => s + v.revenue, 0);

  const DEPT_LABELS: Record<string, string> = {
    restaurant: "Restaurant",
    lounge: "Lounge",
    hotel: "Hôtel",
    casino: "Casino",
  };

  const pos = [...deptMap.entries()]
    .map(([dept, v]) => ({
      name: DEPT_LABELS[dept] ?? dept,
      dept,
      revenue: v.revenue,
      orders: v.orders,
      // CORRIGÉ: arrondi à 1 décimale pour cohérence avec le frontend
      percentage: totalRevenue > 0 ? parseFloat(((v.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({ from: input.from, to: input.to, totalRevenue, pos });
});

// ── GET /reports/top-items ────────────────────────────────────────────────────
// NOUVEAU: Top 5 des articles les plus vendus (par CA) sur la période

r.get("/top-items", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({
    from: z.string(),
    to: z.string(),
    dept: z.enum(["all", "restaurant", "lounge"]).default("all"),
  });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);
  const depts = input.dept === "all" ? ["restaurant", "lounge"] : [input.dept];

  const lines = await prisma.orderLine.findMany({
    where: {
      order: {
        dept: { in: depts as any },
        openedAt: { gte: start, lte: end },
        status: { not: "cancelled" },
      },
    },
    select: { itemName: true, qty: true, unitPrice: true },
  });

  const itemMap = new Map<string, { qty: number; revenue: number; orders: number }>();
  for (const l of lines) {
    const cur = itemMap.get(l.itemName) ?? { qty: 0, revenue: 0, orders: 0 };
    itemMap.set(l.itemName, {
      qty: cur.qty + l.qty,
      revenue: cur.revenue + l.qty * l.unitPrice,
      orders: cur.orders + 1,
    });
  }

  const totalRevenue = [...itemMap.values()].reduce((s, v) => s + v.revenue, 0);

  const items = [...itemMap.entries()]
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      revenue: v.revenue,
      orders: v.orders,
      averagePrice: v.qty > 0 ? Math.round(v.revenue / v.qty) : 0,
      percentage: totalRevenue > 0 ? parseFloat(((v.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.json({ from: input.from, to: input.to, dept: input.dept, totalRevenue, items });
});

// ── GET /reports/top-tables ───────────────────────────────────────────────────
// NOUVEAU: Top 5 des tables les plus rentables sur la période

r.get("/top-tables", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({
    from: z.string(),
    to: z.string(),
    dept: z.enum(["all", "restaurant", "lounge"]).default("all"),
  });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);
  const depts = input.dept === "all" ? ["restaurant", "lounge"] : [input.dept];

  const orders = await prisma.order.findMany({
    where: {
      dept: { in: depts as any },
      openedAt: { gte: start, lte: end },
      status: { not: "cancelled" },
      tableId: { not: null },
    },
    include: {
      lines: { select: { qty: true, unitPrice: true } },
      table: { select: { code: true } },
    },
  });

  const tableMap = new Map<string, { revenue: number; orders: number; covers: number }>();
  for (const o of orders) {
    const code = (o as any).table?.code ?? `Table #${o.tableId}`;
    const subtotal = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const discount = (o as any).discountAmount ?? 0;
    const total = Math.max(0, subtotal - discount);
    const cur = tableMap.get(code) ?? { revenue: 0, orders: 0, covers: 0 };
    tableMap.set(code, {
      revenue: cur.revenue + total,
      orders: cur.orders + 1,
      covers: cur.covers + ((o as any).covers ?? 0),
    });
  }

  const totalRevenue = [...tableMap.values()].reduce((s, v) => s + v.revenue, 0);

  const tables = [...tableMap.entries()]
    .map(([code, v]) => ({
      code,
      revenue: v.revenue,
      orders: v.orders,
      covers: v.covers,
      averagePerOrder: v.orders > 0 ? Math.round(v.revenue / v.orders) : 0,
      percentage: totalRevenue > 0 ? parseFloat(((v.revenue / totalRevenue) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  res.json({ from: input.from, to: input.to, dept: input.dept, totalRevenue, tables });
});

// ── GET /reports/top-staff ────────────────────────────────────────────────────
// NOUVEAU: Top 5 des opérateurs/serveurs ayant encaissé le plus sur la période

r.get("/top-staff", requireScope("reports:read"), async (req, res) => {
  const schema = z.object({ from: z.string(), to: z.string() });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(req.query); }
  catch (err) { return res.status(400).json({ error: "Paramètres invalides", details: err }); }

  const { start, end } = periodRange(input.from, input.to);

  const payments = await prisma.payment.findMany({
    where: {
      receivedAt: { gte: start, lte: end },
      operatorId: { not: null },
    },
    include: {
      operator: { select: { id: true, name: true, email: true } },
    },
  });

  type StaffData = { name: string; email: string | null; amount: number; transactions: number };
  const staffMap = new Map<number, StaffData>();

  for (const p of payments) {
    if (!p.operator) continue;
    const cur = staffMap.get(p.operator.id) ?? {
      name: p.operator.name ?? p.operator.email ?? "Inconnu",
      email: p.operator.email,
      amount: 0,
      transactions: 0,
    };
    staffMap.set(p.operator.id, {
      name: cur.name,
      email: cur.email,
      amount: cur.amount + p.amount,
      transactions: cur.transactions + 1,
    });
  }

  const totalAmount = [...staffMap.values()].reduce((s, v) => s + v.amount, 0);

  const staff = [...staffMap.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      email: v.email,
      amount: v.amount,
      transactions: v.transactions,
      averagePerTransaction: v.transactions > 0 ? Math.round(v.amount / v.transactions) : 0,
      percentage: totalAmount > 0 ? parseFloat(((v.amount / totalAmount) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  res.json({ from: input.from, to: input.to, totalAmount, staff });
});

export default r;