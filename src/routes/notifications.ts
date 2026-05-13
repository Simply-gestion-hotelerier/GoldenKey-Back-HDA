import express from "express";
import { prisma } from "../db";
import { pushNotification, NotificationEvent } from "../services/notificationService";

const router = express.Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function getDismissedBy(n: { dismissedBy?: string | null }): number[] {
  try {
    return n.dismissedBy ? JSON.parse(n.dismissedBy) : [];
  } catch {
    return [];
  }
}

function isVisible(
  n: { targetUserId: number | null; targetRoles: string | null; dismissedBy?: string | null },
  userId: number,
  userRole: string
): boolean {
  // Masquée par cet utilisateur → invisible
  if (getDismissedBy(n).includes(userId)) return false;

  const roles: string[] = n.targetRoles
    ? JSON.parse(n.targetRoles).map((r: string) => r.toLowerCase().trim())
    : [];
  const normalizedRole = userRole.toLowerCase().trim();

  if (!n.targetUserId && roles.length === 0) return true;  // broadcast
  if (n.targetUserId === userId)              return true;  // ciblage direct
  if (roles.includes(normalizedRole))         return true;  // ciblage par rôle
  if (normalizedRole === "admin")             return true;  // admin voit tout
  return false;
}

// ── GET / ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const user = (req as any).user;
  const userRole = user?.role ?? "";
  const userId   = user?.id;

  try {
    const all = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const visible = all.filter((n) => isVisible(n, userId, userRole));
    res.json(visible);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ── POST / ────────────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { event, title, body, targetRoles, targetUserId, meta } = req.body;

  if (!title) return res.status(400).json({ error: "title is required" });
  if (!event) return res.status(400).json({ error: "event is required" });

  const validEvents: NotificationEvent[] = [
    "payment", "order_created", "order_closed",
    "order_line_status", "checkin", "checkout", "low_stock", "info",
  ];
  if (!validEvents.includes(event)) {
    return res.status(400).json({
      error: `event must be one of: ${validEvents.join(", ")}`,
    });
  }

  try {
    const notification = await pushNotification({
      event, title, body, targetRoles, targetUserId, meta,
    });
    res.status(201).json(notification);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ── PATCH /:id/read ───────────────────────────────────────────────────────────

router.patch("/:id/read", async (req, res) => {
  const id     = Number(req.params.id);
  const userId = (req as any).user?.id;

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  try {
    // "read" reste global (première lecture suffit pour le badge)
    const updated = await prisma.notification.update({
      where: { id },
      data:  { read: true },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ── POST /mark-all-read ───────────────────────────────────────────────────────

router.post("/mark-all-read", async (req, res) => {
  const user     = (req as any).user;
  const userId   = user?.id;
  const userRole = user?.role ?? "";

  try {
    const all = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Marquer comme lu uniquement les notifs visibles par cet utilisateur
    const visibleIds = all
      .filter((n) => isVisible(n, userId, userRole))
      .map((n) => n.id);

    if (visibleIds.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: visibleIds } },
        data:  { read: true },
      });
    }

    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ── DELETE /:id — soft delete par utilisateur ─────────────────────────────────

router.delete("/:id", async (req, res) => {
  const id       = Number(req.params.id);
  const userId   = (req as any).user?.id;
  const userRole = ((req as any).user?.role ?? "").toLowerCase().trim();

  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  if (!userId)              return res.status(401).json({ error: "Unauthorized" });

  try {
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ error: "Not found" });

    if (userRole === "admin") {
      // ✅ Admin : suppression physique pour tout le monde
      await prisma.notification.delete({ where: { id } });
    } else {
      // ✅ Autres rôles : soft delete — masqué uniquement pour cet utilisateur
      const dismissed = getDismissedBy(notif);
      if (!dismissed.includes(userId)) {
        dismissed.push(userId);
      }
      await prisma.notification.update({
        where: { id },
        data:  { dismissedBy: JSON.stringify(dismissed) },
      });
    }

    res.status(204).end();
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

export default router;