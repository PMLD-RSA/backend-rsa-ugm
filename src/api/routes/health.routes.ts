import { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { redis } from "../../services/redis-stream.js";
import { wsBroadcaster } from "../../services/ws-broadcaster.js";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (_request, reply) => {
    let dbStatus = "down";
    let redisStatus = "down";

    try {
      await db.execute(sql`SELECT 1`);
      dbStatus = "up";
    } catch {
      dbStatus = "down";
    }

    try {
      const pong = await redis.ping();
      if (pong === "PONG") redisStatus = "up";
    } catch {
      redisStatus = "down";
    }

    const healthy = dbStatus === "up" && redisStatus === "up";

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "healthy" : "degraded",
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
      websocketClients: wsBroadcaster.getConnectedClientsCount(),
      timestamp: new Date().toISOString(),
    });
  });
}

