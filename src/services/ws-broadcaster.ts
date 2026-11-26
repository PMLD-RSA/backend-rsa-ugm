import { WebSocket } from "ws";
import { wsConnectedClients, wsBroadcastMessagesTotal } from "./metrics.js";

export interface BroadcastMessage {
  type: "LEVEL_UPDATE" | "ALERT_TRIGGERED" | "ALERT_RESOLVED" | "NODE_STATUS";
  data: unknown;
  timestamp: string;
}

class WebSocketBroadcaster {
  private clients: Set<WebSocket> = new Set();

  public addClient(ws: WebSocket) {
    this.clients.add(ws);
    wsConnectedClients.set(this.clients.size);
    ws.on("close", () => this.removeClient(ws));
    ws.on("error", () => this.removeClient(ws));
  }

  public removeClient(ws: WebSocket) {
    this.clients.delete(ws);
    wsConnectedClients.set(this.clients.size);
  }

  public broadcast(type: BroadcastMessage["type"], data: unknown) {
    wsBroadcastMessagesTotal.inc({ event_type: type });

    const payload: BroadcastMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    const messageString = JSON.stringify(payload);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    }
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}

export const wsBroadcaster = new WebSocketBroadcaster();

