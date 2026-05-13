// src/sse/SSEManager.ts
import { Response } from "express";

interface SSEClient {
  userId: number;
  role: string;
  res: Response;
}

class SSEManager {
  private clients: Map<number, SSEClient> = new Map();

  add(userId: number, role: string, res: Response) {
    this.clients.set(userId, { userId, role, res });
  }

  remove(userId: number) {
    this.clients.delete(userId);
  }

  /** Envoie à un utilisateur précis */
  sendToUser(userId: number, event: string, data: object) {
    const client = this.clients.get(userId);
    if (client) this._write(client.res, event, data);
  }

  /** Envoie à tous les utilisateurs ayant l'un des rôles listés */
  sendToRoles(roles: string[], event: string, data: object) {
    const normalizedRoles = roles.map(r => r.toLowerCase().trim());
    for (const client of this.clients.values()) {
      // ✅ Comparer en lowercase des deux côtés
      if (normalizedRoles.includes(client.role.toLowerCase().trim())) {
        this._write(client.res, event, data);
      }
    }
  }

  /** Broadcast à tous les connectés */
  broadcast(event: string, data: object) {
    for (const client of this.clients.values()) {
      this._write(client.res, event, data);
    }
  }

  private _write(res: Response, event: string, data: object) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client déconnecté — sera nettoyé via l'événement 'close'
    }
  }

  get connectedCount() {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();