import fp from "fastify-plugin";
import fastifyWebsocket from "@fastify/websocket";
import { FastifyInstance, FastifyRequest } from "fastify";
import { wsBroadcaster } from "../../services/ws-broadcaster.js";
import { isAllowedOrigin } from "../../utils/security.js";
import { WebSocket } from "ws";

interface AuthenticatedWebSocket extends WebSocket {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export const websocketPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  // Endpoint WebSocket untuk data sensor dan alert realtime
  fastify.get("/ws", { websocket: true }, (socket, req: FastifyRequest) => {
    const ws = socket as unknown as AuthenticatedWebSocket;

    // 1. Validasi Origin untuk mencegah Cross-Site WebSocket Hijacking (CSWSH)
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      fastify.log.warn(`[WebSocket] Koneksi ditolak: Origin tidak diizinkan (${origin})`);
      try {
        ws.send(
          JSON.stringify({
            type: "ERROR",
            message: "Kebijakan keamanan: Origin tidak diizinkan",
            timestamp: new Date().toISOString(),
          })
        );
      } catch {}
      ws.close(1008, "Policy Violation: Forbidden Origin");
      return;
    }

    // 2. Ekstraksi Token JWT (dari query string ?token=<jwt> atau header Authorization)
    const query = req.query as Record<string, string | undefined>;
    let token = query?.token;

    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    // 3. Validasi Keberadaan Token
    if (!token) {
      fastify.log.warn(`[WebSocket] Koneksi ditolak: Token autentikasi tidak ditemukan`);
      try {
        ws.send(
          JSON.stringify({
            type: "ERROR",
            message: "Autentikasi gagal: Parameter ?token=<jwt> atau header Authorization diperlukan",
            timestamp: new Date().toISOString(),
          })
        );
      } catch {}
      ws.close(1008, "Policy Violation: Missing Authentication Token");
      return;
    }

    // 4. Verifikasi Keaslian & Kedaluwarsa Token JWT
    try {
      const decoded = fastify.jwt.verify<{ id: string; username: string; role: string }>(token);
      ws.user = decoded;
    } catch {
      fastify.log.warn(`[WebSocket] Koneksi ditolak: Token tidak valid atau kedaluwarsa`);
      try {
        ws.send(
          JSON.stringify({
            type: "ERROR",
            message: "Autentikasi gagal: Token JWT tidak valid atau sudah kedaluwarsa",
            timestamp: new Date().toISOString(),
          })
        );
      } catch {}
      ws.close(1008, "Policy Violation: Invalid Token");
      return;
    }

    // 5. Daftarkan client ke broadcaster setelah lolos seluruh validasi
    wsBroadcaster.addClient(ws);
    fastify.log.info(
      `[WebSocket] Client authenticated (${ws.user.username}). Total client aktif: ${wsBroadcaster.getConnectedClientsCount()}`
    );

    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        message: "Terhubung ke stream realtime monitoring tangki",
        user: ws.user.username,
        timestamp: new Date().toISOString(),
      })
    );
  });
});
