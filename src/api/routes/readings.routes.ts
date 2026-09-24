import { FastifyInstance } from "fastify";
import { eq, gte, desc, asc, and } from "drizzle-orm";
import { db } from "../../db/index.js";
import { waterLevelReadings, tanks } from "../../db/schema/index.js";

export async function readingsRoutes(fastify: FastifyInstance) {
  const authGuard = { preHandler: [fastify.authenticate] };

  // Pembacaan level air terkini seluruh tangki
  fastify.get("/api/readings/latest", authGuard, async (_request, reply) => {
    const allTanks = await db.select().from(tanks);

    const data = await Promise.all(
      allTanks.map(async (t) => {
        const [latest] = await db
          .select()
          .from(waterLevelReadings)
          .where(eq(waterLevelReadings.tankId, t.id))
          .orderBy(desc(waterLevelReadings.recordedAt))
          .limit(1);

        return {
          tankId: t.id,
          tankName: t.name,
          reading: latest ?? null,
        };
      })
    );

    return reply.send({ success: true, data });
  });

  // Histori agregasi seluruh tangki
  fastify.get<{
    Querystring: { hours?: string };
  }>("/api/readings/history", authGuard, async (request, reply) => {
    const hours = parseInt(request.query.hours || "24", 10);
    const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const readings = await db
      .select({
        id: waterLevelReadings.id,
        tankId: waterLevelReadings.tankId,
        levelPercent: waterLevelReadings.levelPercent,
        volumeLiters: waterLevelReadings.volumeLiters,
        recordedAt: waterLevelReadings.recordedAt,
      })
      .from(waterLevelReadings)
      .where(gte(waterLevelReadings.recordedAt, sinceDate))
      .orderBy(desc(waterLevelReadings.recordedAt))
      .limit(1000);

    return reply.send({ success: true, data: readings });
  });
}

