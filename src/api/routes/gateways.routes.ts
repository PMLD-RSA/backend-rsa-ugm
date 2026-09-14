import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { gateways, sensorNodes, tanks } from "../../db/schema/index.js";

export async function gatewaysRoutes(fastify: FastifyInstance) {
  // List gateway
  fastify.get("/api/gateways", async (_request, reply) => {
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
  });

  // List node sensor
  fastify.get("/api/nodes", async (_request, reply) => {
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
  });
}

