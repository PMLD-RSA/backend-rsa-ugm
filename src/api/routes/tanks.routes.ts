import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { eq, desc, and, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  tanks,
  waterLevelReadings,
  alerts,
  sensorNodes,
  gateways,
  auditLogs,
} from "../../db/schema/index.js";
import {
  createTankSchema,
  createTankWithSensorSchema,
  updateTankSchema,
} from "../../schemas/api.schema.js";

class HttpRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function buildTankInsertValues(data: z.infer<typeof createTankSchema>) {
  return {
    name: data.name,
    location: data.location ?? null,
    latitude: data.latitude !== undefined && data.latitude !== null ? data.latitude.toString() : null,
    longitude: data.longitude !== undefined && data.longitude !== null ? data.longitude.toString() : null,
    capacityLiters: data.capacityLiters.toString(),
    minThresholdPercent: data.minThresholdPercent.toString(),
    maxThresholdPercent: data.maxThresholdPercent.toString(),
    minDistanceCm: data.minDistanceCm.toString(),
    maxDistanceCm: data.maxDistanceCm.toString(),
  };
}

export async function tanksRoutes(fastify: FastifyInstance) {
  const authGuard = { preHandler: [fastify.authenticate] };
  const adminGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(["admin"])],
  };

  // List semua tangki
  fastify.get("/api/tanks", authGuard, async (_request, reply) => {
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

  // Detail tangki (50 pembacaan & 10 alert terakhir)
  fastify.get<{ Params: { id: string } }>("/api/tanks/:id", authGuard, async (request, reply) => {
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

  // Histori pembacaan spesifik satu tangki (untuk grafik time-series)
  fastify.get<{
    Params: { id: string };
    Querystring: { hours?: string; limit?: string };
  }>("/api/tanks/:id/readings", authGuard, async (request, reply) => {
    const { id } = request.params;
    const hours = parseInt(request.query.hours || "24", 10);
    const limit = Math.min(1000, parseInt(request.query.limit || "500", 10));

    const sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    const readings = await db
      .select()
      .from(waterLevelReadings)
      .where(
        and(
          eq(waterLevelReadings.tankId, id),
          gte(waterLevelReadings.recordedAt, sinceDate)
        )
      )
      .orderBy(desc(waterLevelReadings.recordedAt))
      .limit(limit);

    return reply.send({
      success: true,
      tankId: id,
      hours,
      count: readings.length,
      data: readings,
    });
  });

  // Tambah tangki baru (Khusus Admin)
  fastify.post("/api/tanks", adminGuard, async (request, reply) => {
    const parseResult = createTankSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: parseResult.error.format(),
      });
    }

    const [newTank] = await db
      .insert(tanks)
      .values(buildTankInsertValues(parseResult.data))
      .returning();

    // Catat log audit
    const adminUser = request.user as { id: string };
    await db.insert(auditLogs).values({
      userId: adminUser.id,
      action: "CREATE_TANK",
      entity: "tanks",
      entityId: newTank.id,
      detail: `Menambahkan master tangki '${newTank.name}'`,
      ipAddress: request.ip,
    });

    return reply.status(201).send({ success: true, data: newTank });
  });

  // Tambah tangki baru beserta sensor node awal dalam satu transaksi (Khusus Admin)
  fastify.post("/api/tanks/with-sensor", adminGuard, async (request, reply) => {
    const parseResult = createTankWithSensorSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validation failed",
        errors: parseResult.error.format(),
      });
    }

    const { sensorNode, ...tankInput } = parseResult.data;
    const adminUser = request.user as { id: string };

    try {
      const { newTank, newSensor } = await db.transaction(async (tx) => {
        // 1. Pastikan gateway terdaftar
        const [gateway] = await tx
          .select({ id: gateways.id })
          .from(gateways)
          .where(eq(gateways.id, sensorNode.gatewayId))
          .limit(1);

        if (!gateway) {
          throw new HttpRouteError(404, "Gateway not found");
        }

        // 2. Pastikan deviceCode sensor belum digunakan
        const [existingNode] = await tx
          .select({ id: sensorNodes.id })
          .from(sensorNodes)
          .where(eq(sensorNodes.deviceCode, sensorNode.deviceCode))
          .limit(1);

        if (existingNode) {
          throw new HttpRouteError(
            409,
            `Kode sensor '${sensorNode.deviceCode}' sudah digunakan`
          );
        }

        // 3. Simpan tangki baru
        const [createdTank] = await tx
          .insert(tanks)
          .values(buildTankInsertValues(tankInput))
          .returning();

        // 4. Simpan sensor baru dengan status offline dan lastSeen kosong
        const [createdSensor] = await tx
          .insert(sensorNodes)
          .values({
            tankId: createdTank.id,
            gatewayId: gateway.id,
            deviceCode: sensorNode.deviceCode,
            sensorType: sensorNode.sensorType,
            status: "offline",
            lastSeen: null,
          })
          .returning();

        // 5. Catat audit log dalam transaksi yang sama
        await tx.insert(auditLogs).values({
          userId: adminUser.id,
          action: "CREATE_TANK_WITH_SENSOR",
          entity: "tanks",
          entityId: createdTank.id,
          detail: `Menambahkan master tangki '${createdTank.name}' beserta sensor '${createdSensor.deviceCode}'`,
          ipAddress: request.ip,
        });

        return { newTank: createdTank, newSensor: createdSensor };
      });

      return reply.status(201).send({
        success: true,
        data: {
          ...newTank,
          nodes: [newSensor],
          latestReading: null,
          activeAlert: null,
        },
      });
    } catch (err: unknown) {
      if (err instanceof HttpRouteError) {
        return reply.status(err.statusCode).send({
          success: false,
          message: err.message,
        });
      }

      const pgCode =
        (err as { code?: string; cause?: { code?: string } })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;

      if (pgCode === "23505") {
        return reply.status(409).send({
          success: false,
          message: `Kode sensor '${sensorNode.deviceCode}' sudah digunakan`,
        });
      }

      throw err;
    }
  });

  // Handler update tangki (Mendukung PATCH dan PUT)
  const handleUpdateTank = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
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
    if (parseResult.data.latitude !== undefined)
      updateData.latitude = parseResult.data.latitude !== null ? parseResult.data.latitude.toString() : null;
    if (parseResult.data.longitude !== undefined)
      updateData.longitude = parseResult.data.longitude !== null ? parseResult.data.longitude.toString() : null;
    if (parseResult.data.capacityLiters !== undefined)
      updateData.capacityLiters = parseResult.data.capacityLiters.toString();
    if (parseResult.data.minThresholdPercent !== undefined)
      updateData.minThresholdPercent = parseResult.data.minThresholdPercent.toString();
    if (parseResult.data.maxThresholdPercent !== undefined)
      updateData.maxThresholdPercent = parseResult.data.maxThresholdPercent.toString();
    if (parseResult.data.minDistanceCm !== undefined)
      updateData.minDistanceCm = parseResult.data.minDistanceCm.toString();
    if (parseResult.data.maxDistanceCm !== undefined)
      updateData.maxDistanceCm = parseResult.data.maxDistanceCm.toString();

    const [updated] = await db
      .update(tanks)
      .set(updateData)
      .where(eq(tanks.id, id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ success: false, message: "Tank not found" });
    }

    // Catat log audit
    const adminUser = request.user as { id: string };
    await db.insert(auditLogs).values({
      userId: adminUser.id,
      action: "UPDATE_TANK",
      entity: "tanks",
      entityId: updated.id,
      detail: `Memperbarui data/threshold tangki '${updated.name}'`,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, data: updated });
  };

  fastify.patch<{ Params: { id: string } }>("/api/tanks/:id", adminGuard, handleUpdateTank);
  fastify.put<{ Params: { id: string } }>("/api/tanks/:id", adminGuard, handleUpdateTank);

  // Hapus tangki (Khusus Admin)
  fastify.delete<{ Params: { id: string } }>("/api/tanks/:id", adminGuard, async (request, reply) => {
    const { id } = request.params;

    const [deleted] = await db
      .delete(tanks)
      .where(eq(tanks.id, id))
      .returning({ id: tanks.id, name: tanks.name });

    if (!deleted) {
      return reply.status(404).send({ success: false, message: "Tank not found" });
    }

    // Catat log audit
    const adminUser = request.user as { id: string };
    await db.insert(auditLogs).values({
      userId: adminUser.id,
      action: "DELETE_TANK",
      entity: "tanks",
      entityId: deleted.id,
      detail: `Menghapus master tangki '${deleted.name}'`,
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      message: "Tank deleted successfully",
    });
  });
}
