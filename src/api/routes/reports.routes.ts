import { FastifyInstance } from "fastify";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { waterLevelReadings, alerts, tanks } from "../../db/schema/index.js";

export async function reportsRoutes(fastify: FastifyInstance) {
  const authGuard = { preHandler: [fastify.authenticate] };

  // Export CSV riwayat pembacaan sensor level air
  fastify.get<{
    Querystring: { tankId: string; startDate?: string; endDate?: string };
  }>("/api/reports/readings/export", authGuard, async (request, reply) => {
    const { tankId, startDate, endDate } = request.query;

    if (!tankId) {
      return reply.status(400).send({
        success: false,
        message: "Parameter tankId wajib disertakan",
      });
    }

    const conditions = [eq(waterLevelReadings.tankId, tankId)];
    if (startDate) conditions.push(gte(waterLevelReadings.recordedAt, new Date(startDate)));
    if (endDate) conditions.push(lte(waterLevelReadings.recordedAt, new Date(endDate)));

    const readings = await db
      .select()
      .from(waterLevelReadings)
      .where(and(...conditions))
      .orderBy(desc(waterLevelReadings.recordedAt))
      .limit(10000);

    const [tank] = await db.select().from(tanks).where(eq(tanks.id, tankId)).limit(1);
    const tankName = tank ? tank.name.replace(/\s+/g, "_").toLowerCase() : tankId;

    // Susun header dan baris CSV
    const csvRows = [
      "id,tank_id,sensor_node_id,level_percent,volume_liters,raw_value,rssi,recorded_at",
    ];

    for (const r of readings) {
      csvRows.push(
        `${r.id},"${r.tankId}","${r.sensorNodeId || ""}","${r.levelPercent}","${r.volumeLiters}","${r.rawValue || ""}",${r.rssi || ""},"${r.recordedAt.toISOString()}"`
      );
    }

    const csvContent = csvRows.join("\n");
    const filename = `readings_${tankName}_${new Date().toISOString().slice(0, 10)}.csv`;

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csvContent);
  });

  // Export CSV riwayat alert peringatan
  fastify.get<{
    Querystring: { level?: string; startDate?: string; endDate?: string };
  }>("/api/reports/alerts/export", authGuard, async (request, reply) => {
    const { level, startDate, endDate } = request.query;

    const conditions = [];
    if (level) conditions.push(eq(alerts.level, level));
    if (startDate) conditions.push(gte(alerts.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(alerts.createdAt, new Date(endDate)));

    const alertList = await db
      .select()
      .from(alerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(alerts.createdAt))
      .limit(5000);

    const csvRows = [
      "id,tank_id,level,message,status,created_at,resolved_at",
    ];

    for (const a of alertList) {
      csvRows.push(
        `${a.id},"${a.tankId}","${a.level}","${a.message.replace(/"/g, '""')}","${a.status}","${a.createdAt.toISOString()}","${a.resolvedAt ? a.resolvedAt.toISOString() : ""}"`
      );
    }

    const csvContent = csvRows.join("\n");
    const filename = `alerts_${new Date().toISOString().slice(0, 10)}.csv`;

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csvContent);
  });
}
