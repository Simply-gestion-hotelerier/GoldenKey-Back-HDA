import { Router } from "express";
import { prisma } from "../db";
import { z } from "zod";
import { requireScope } from "../middleware/requireScope";

const r = Router();

r.get("/", requireScope("invoices:read"), async (_req, res) => {
  const invs = await prisma.invoice.findMany({ include: { lines: true }, orderBy: { date: "desc" } });
  res.json(invs);
});

r.get("/:id", requireScope("invoices:read"), async (req, res) => {
  const id = Number(req.params.id);
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  res.json(inv);
});

r.post("/from-order", requireScope("invoices:write"), async (req, res) => {
  const schema = z.object({ 
    orderId: z.number().int(), 
    number: z.string() 
  });
  const { orderId, number } = schema.parse(req.body);
  
  const order = await prisma.order.findUniqueOrThrow({ 
    where: { id: orderId }, 
    include: { lines: true } 
  });
  
  const { totalHT, totalTVA, totalTTC, lines } = computeFromLines(
    order.lines.map((l: typeof order.lines[0]) => ({ 
      description: l.itemName, 
      qty: l.qty, 
      unitPrice: l.unitPrice, 
      vatRate: 20 
    }))
  );
  
  const created = await prisma.invoice.create({ 
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

r.post("/from-folio", requireScope("invoices:write"), async (req, res) => {
  const schema = z.object({ 
    folioId: z.number().int(), 
    number: z.string() 
  });
  const { folioId, number } = schema.parse(req.body);
  
  const folio = await prisma.folio.findUniqueOrThrow({ 
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
  
  const { totalHT, totalTVA, totalTTC, lines } = computeFromLines(
    folio.charges.map((c: typeof folio.charges[0]) => ({ 
      description: c.description, 
      qty: c.qty, 
      unitPrice: c.unitPrice, 
      vatRate: 20 
    }))
  );
  
  const created = await prisma.invoice.create({ 
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

function computeFromLines(lines: { description: string; qty: number; unitPrice: number; vatRate: number }[]) {
  const mapped = lines.map(l => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate, total: l.qty * l.unitPrice }));
  const totalTTC = mapped.reduce((s, l) => s + l.total, 0);
  const totalHT = Math.round(totalTTC / 1.2);
  const totalTVA = totalTTC - totalHT;
  return { totalHT, totalTVA, totalTTC, lines: mapped };
}

export default r;
