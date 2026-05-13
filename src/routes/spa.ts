import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";
import type { AppointmentStatus } from "@prisma/client";

const r = Router();

r.get("/appointments", requireScope("spa:read"), async (req, res) => {
  const { date, start, end } = req.query as any;
  let where: any = {};
  if (start && end) {
    where.start = { gte: new Date(String(start)), lt: new Date(String(end)) };
  } else if (date) {
    const d = new Date(String(date));
    where.start = { gte: d, lt: new Date(d.getTime() + 24 * 3600 * 1000) };
  }
  const apps = await prisma.appointment.findMany({
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

r.get("/appointments/:id", requireScope("spa:read"), async (req, res) => {
  const id = Number(req.params.id);
  const app = await prisma.appointment.findUnique({
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
  if (!app) return res.status(404).json({ error: "Appointment not found" });
  res.json(app);
});

r.post("/appointments", requireScope("spa:write"), async (req, res) => {
  const schema = z.object({
    clientName: z.string(),
    serviceName: z.string(),
    start: z.string(),
    durationMin: z.number().int().min(10),
    price: z.number().int().min(0),
    room: z.string().optional().nullable(),
    therapistId: z.number().int().optional().nullable(),
  });
  const input = schema.parse(req.body);

  // Optional: basic overlap check if therapist provided
  if (input.therapistId) {
    const start = new Date(input.start);
    const end = new Date(start.getTime() + input.durationMin * 60000);
    const conflict = await prisma.appointment.findFirst({
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

  const created = await prisma.appointment.create({
    data: { ...input, start: new Date(input.start) }
  });
  res.status(201).json(created);
});

r.patch("/appointments/:id/status", requireScope("spa:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ status: z.enum(["booked","waiting","in_progress","completed","no_show","cancelled"]) });
  const status = schema.parse(req.body).status as AppointmentStatus;
  const updated = await prisma.appointment.update({ where: { id }, data: { status } });
  res.json(updated);
});

r.post("/appointments/:id/pay", requireScope("payments:write"), async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ amount: z.number().int().min(1), method: z.enum(["cash","card","mobile","bank"]) });
  const { amount, method } = schema.parse(req.body);
  const app = await prisma.appointment.findUnique({ where: { id } });
  if (!app) return res.status(404).json({ error: "Appointment not found" });
  const payment = await prisma.payment.create({ data: { amount, method, department: "spa", reference: `APPT-${id}` } });
  res.status(201).json(payment);
});

// Services catalog
r.get("/services", requireScope("spa:read"), async (_req, res) => {
  const services = await prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(services);
});

r.post("/services", requireScope("spa:write"), async (req, res) => {
  const schema = z.object({ name: z.string(), durationMin: z.number().int().min(10), salePrice: z.number().int().min(0) });
  const created = await prisma.service.create({ data: { ...schema.parse(req.body), dept: "spa" } });
  res.status(201).json(created);
});

// Staff availability slots
r.get("/staff-slots", requireScope("spa:read"), async (req, res) => {
  const { staffId, date } = req.query as any;
  const where: any = {};
  if (staffId) where.staffId = Number(staffId);
  if (date) {
    const start = new Date(date as string);
    const end = new Date(start.getTime() + 24*3600*1000);
    where.start = { gte: start, lt: end };
  }
  const slots = await prisma.staffSlot.findMany({ where, orderBy: { start: "asc" } });
  res.json(slots);
});

r.post("/staff-slots", requireScope("spa:write"), async (req, res) => {
  const schema = z.object({ staffId: z.number().int(), start: z.string(), end: z.string(), status: z.string().optional() });
  const input = schema.parse(req.body);
  const created = await prisma.staffSlot.create({ data: { staffId: input.staffId, start: new Date(input.start), end: new Date(input.end), status: input.status || "available" } });
  res.status(201).json(created);
});

r.delete("/appointments/:id", requireScope("spa:write"), async (req, res) => {
  const id = Number(req.params.id);
  await prisma.appointment.delete({ where: { id } });
  res.status(204).end();
});

export default r;
