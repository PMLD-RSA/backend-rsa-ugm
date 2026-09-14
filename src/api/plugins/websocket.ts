import fp from "fastify-plugin";
import fastifyWebsocket from "@fastify/websocket";
import { FastifyInstance } from "fastify";
import { wsBroadcaster } from "../../services/ws-broadcaster.js";
import { WebSocket } from "ws";

export const websocketPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB
    },
  });

  // Endpoint WebSocket untuk data sensor dan alert realtime
  fastify.get("/ws", { websocket: true }, (socket, _req) => {
    const ws = socket as unknown as WebSocket;
    wsBroadcaster.addClient(ws);
    fastify.log.info(
      `[WebSocket] Client terhubung. Total client aktif: ${wsBroadcaster.getConnectedClientsCount()}`
    );

    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        message: "Terhubung ke stream realtime monitoring tangki",
        timestamp: new Date().toISOString(),
      })
    );
  });
});

