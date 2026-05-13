// src/services/notificationService.ts
import { prisma } from "../db";
import { sseManager } from "../sse/SSEManager";

export type NotificationEvent =
  | "payment"
  | "order_created"
  | "order_closed"
  | "order_line_status"
  | "checkin"
  | "checkout"
  | "low_stock"
  | "info";

export interface NotificationPayload {
  event: NotificationEvent;
  title: string;
  body?: string;
  /** Roles qui doivent recevoir la notification (ex: ["admin","cashier"]) */
  targetRoles?: string[];
  /** Utilisateur spécifique (optionnel, cumulable avec targetRoles) */
  targetUserId?: number;
  /** Données métier supplémentaires */
  meta?: Record<string, unknown>;
}

// src/services/notificationService.ts
export async function pushNotification(payload: NotificationPayload) {
  // ✅ Normaliser les rôles en lowercase avant stockage
  const normalizedRoles = payload.targetRoles?.map(r => r.toLowerCase().trim());

  const saved = await prisma.notification.create({
    data: {
      title: payload.title,
      body: payload.body ?? null,
      type: payload.event,
      targetRoles: normalizedRoles?.length
        ? JSON.stringify(normalizedRoles)
        : null,
      targetUserId: payload.targetUserId ?? null,
      meta: payload.meta ? JSON.stringify(payload.meta) : null,
      read: false,
    },
  });

  const ssePayload = {
    id:        saved.id,
    event:     payload.event,
    title:     payload.title,
    body:      payload.body,
    meta:      payload.meta,
    createdAt: saved.createdAt,
  };

  // ✅ Normaliser aussi pour le SSE (sseManager stocke le rôle du JWT tel quel)
  const normalizedForSSE = normalizedRoles ?? [];

  if (payload.targetUserId) {
    sseManager.sendToUser(payload.targetUserId, payload.event, ssePayload);
  }
  if (normalizedForSSE.length) {
    // sendToRoles doit comparer en lowercase aussi
    sseManager.sendToRoles(normalizedForSSE, payload.event, ssePayload);
  }
  if (!payload.targetUserId && !normalizedForSSE.length) {
    sseManager.broadcast(payload.event, ssePayload);
  }

  return saved;
}