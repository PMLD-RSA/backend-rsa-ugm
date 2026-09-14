import { FastifyInstance } from "fastify";
import { eq, gte, asc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { waterLevelReadings } from "../../db/schema/index.js";
import { readingsQuerySchema } from "../../schemas/api.schema.js";

export async function readingsRoutes(fastify: FastifyInstance) {
  // Histori pembacaan level air
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; limit?: string };
  }>("/api/tanks/:id/readings", async (request, reply) => {
    const { id } = request.params;
    const query = readingsQuerySchema.parse(request.query);

    const sinceDate = new Date(Date.now() - query.hours * 60 * 60 * 1000);

    const readings = await db
      .select()
      .from(waterLevelReadings)
      .where(
        eq(waterLevelReadings.tankId, id) &&
        gte(waterLevelReadings.recordedAt, sinceDate)
      )
      .orderBy(asc(waterLevelReadings.recordedAt))
      .limit(query.limit);

    return reply.send({
      success: true,
      tankId: id,
      hours: query.hours,
      count: readings.length,
      data: readings,
    });
  });
}

