import { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { tanks, waterLevelReadings, alerts, sensorNodes } from "../../db/schema/index.js";
import { createTankSchema, updateTankSchema } from "../../schemas/api.schema.js";

export async function tanksRoutes(fastify: FastifyInstance) {
  // List semua tangki
  fastify.get("/api/tanks", async (_request, reply) => {
    const allTanks = await db.select().from(tanks);

    const results = await Promise.all(
      allTanks.map(async (tank) => {
        const [latestReading] = await db
          .select()
          .from(waterLevelReadings)
          .where(eq(waterLevelReadings.tankId, tank.id))
          .orderBy(desc(waterLevelReadings.recordedAt))
          .limit(1);

        const [activeAlert] = await db
          .select()
          .from(alerts)
          .where(eq(alerts.tankId, tank.id))
          .orderBy(desc(alerts.createdAt))
          .limit(1);

        const nodes = await db
          .select()
          .from(sensorNodes)
          .where(eq(sensorNodes.tankId, tank.id));

        return {
          ...tank,
          latestReading: latestReading ?? null,
          activeAlert: activeAlert?.status === "active" ? activeAlert : null,
          nodes,
        };
      })
    );

    return reply.send({ success: true, data: results });
  });

  // Detail tangki
  fastify.get<{ Params: { id: string } }>("/api/tanks/:id", async (request, reply) => {
    const { id } = request.params;

    const [tank] = await db.select().from(tanks).where(eq(tanks.id, id)).limit(1);

    if (!tank) {
      return reply.status(404).send({ success: false, message: "Tank not found" });
    }

    const recentReadings = await db
      .select()
      .from(waterLevelReadings)
      .where(eq(waterLevelReadings.tankId, id))
      .orderBy(desc(waterLevelReadings.recordedAt))
      .limit(50);

    const recentAlerts = await db
      .select()
      .from(alerts)
      .where(eq(alerts.tankId, id))
      .orderBy(desc(alerts.createdAt))
      .limit(10);

    return reply.send({
      success: true,
      data: {
        ...tank,
        recentReadings,
        recentAlerts,
      },
    });
  });

  // Tambah tangki baru
  fastify.post("/api/tanks", async (request, reply) => {
    const parseResult = createTankSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: parseResult.error.format(),
      });
    }

    const { name, location, capacityLiters, minThresholdPercent, maxThresholdPercent } =
      parseResult.data;

    const [newTank] = await db
      .insert(tanks)
      .values({
        name,
        location: location ?? null,
        capacityLiters: capacityLiters.toString(),
        minThresholdPercent: minThresholdPercent.toString(),
        maxThresholdPercent: maxThresholdPercent.toString(),
      })
      .returning();

    return reply.status(201).send({ success: true, data: newTank });
  });

  // Update tangki
  fastify.patch<{ Params: { id: string } }>("/api/tanks/:id", async (request, reply) => {
    const { id } = request.params;
    const parseResult = updateTankSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: parseResult.error.format(),
      });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (parseResult.data.name !== undefined) updateData.name = parseResult.data.name;
    if (parseResult.data.location !== undefined) updateData.location = parseResult.data.location;
    if (parseResult.data.capacityLiters !== undefined)
      updateData.capacityLiters = parseResult.data.capacityLiters.toString();
    if (parseResult.data.minThresholdPercent !== undefined)
      updateData.minThresholdPercent = parseResult.data.minThresholdPercent.toString();
    if (parseResult.data.maxThresholdPercent !== undefined)
      updateData.maxThresholdPercent = parseResult.data.maxThresholdPercent.toString();

    const [updated] = await db
      .update(tanks)
      .set(updateData)
      .where(eq(tanks.id, id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ success: false, message: "Tank not found" });
    }

    return reply.send({ success: true, data: updated });
  });
}

