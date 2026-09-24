import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { gateways, sensorNodes, tanks } from "../../db/schema/index.js";
import { env } from "../../config/env.js";

export async function gatewaysRoutes(fastify: FastifyInstance) {
  // List gateway
  fastify.get(
    "/api/gateways",
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const allGateways = await db.select().from(gateways);

      const data = await Promise.all(
        allGateways.map(async (gw) => {
          const nodes = await db
            .select()
            .from(sensorNodes)
            .where(eq(sensorNodes.gatewayId, gw.id));

          return {
            ...gw,
            nodesCount: nodes.length,
            nodes,
          };
        })
      );

      return reply.send({ success: true, data });
    }
  );

  // List node sensor
  fastify.get(
    "/api/nodes",
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const nodes = await db
        .select({
          id: sensorNodes.id,
          deviceCode: sensorNodes.deviceCode,
          sensorType: sensorNodes.sensorType,
          status: sensorNodes.status,
          lastRssi: sensorNodes.lastRssi,
          lastSeen: sensorNodes.lastSeen,
          tankId: sensorNodes.tankId,
          tankName: tanks.name,
          gatewayId: sensorNodes.gatewayId,
          gatewayCode: gateways.deviceCode,
        })
        .from(sensorNodes)
        .leftJoin(tanks, eq(sensorNodes.tankId, tanks.id))
        .leftJoin(gateways, eq(sensorNodes.gatewayId, gateways.id));

      return reply.send({ success: true, count: nodes.length, data: nodes });
    }
  );

  // Endpoint sinkronisasi mapping tangki & sensor node untuk Raspberry Pi saat booting
  fastify.get<{ Params: { deviceCode: string } }>(
    "/api/gateways/:deviceCode/sync",
    async (request, reply) => {
      const { deviceCode } = request.params;
      const gatewayKey = request.headers["x-gateway-key"];

      // Validasi kunci gateway atau token otentikasi
      if (gatewayKey !== env.GATEWAY_SYNC_KEY) {
        try {
          await request.jwtVerify();
        } catch {
          return reply.status(401).send({
            success: false,
            message: "Unauthorized: Header X-Gateway-Key tidak valid atau token tidak tersedia",
          });
        }
      }

      const [gateway] = await db
        .select()
        .from(gateways)
        .where(eq(gateways.deviceCode, deviceCode))
        .limit(1);

      if (!gateway) {
        return reply.status(404).send({
          success: false,
          message: `Gateway dengan deviceCode '${deviceCode}' tidak ditemukan`,
        });
      }

      // Update heartbeat gateway
      await db
        .update(gateways)
        .set({
          status: "online",
          lastHeartbeat: new Date(),
        })
        .where(eq(gateways.id, gateway.id));

      // Ambil relasi sensor node dan tangki terkait
      const nodes = await db
        .select({
          deviceCode: sensorNodes.deviceCode,
          sensorNodeId: sensorNodes.id,
          tankId: sensorNodes.tankId,
          tankName: tanks.name,
          capacityLiters: tanks.capacityLiters,
        })
        .from(sensorNodes)
        .innerJoin(tanks, eq(sensorNodes.tankId, tanks.id))
        .where(eq(sensorNodes.gatewayId, gateway.id));

      return reply.send({
        success: true,
        gatewayCode: gateway.deviceCode,
        syncedAt: new Date().toISOString(),
        mappings: nodes,
      });
    }
  );
}
