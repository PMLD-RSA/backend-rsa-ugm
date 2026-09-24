import { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { alerts, tanks, auditLogs } from "../../db/schema/index.js";
import { wsBroadcaster } from "../../services/ws-broadcaster.js";

export async function alertsRoutes(fastify: FastifyInstance) {
  const authGuard = { preHandler: [fastify.authenticate] };
  const operatorGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(["admin", "operator"])],
  };

  // List alert (opsional filter ?status=active atau resolved)
  fastify.get<{ Querystring: { status?: string } }>(
    "/api/alerts",
    authGuard,
    async (request, reply) => {
      const { status } = request.query;

      let query = db
        .select({
          id: alerts.id,
          tankId: alerts.tankId,
          tankName: tanks.name,
          tankLocation: tanks.location,
          level: alerts.level,
          message: alerts.message,
          status: alerts.status,
          createdAt: alerts.createdAt,
          resolvedAt: alerts.resolvedAt,
        })
        .from(alerts)
        .leftJoin(tanks, eq(alerts.tankId, tanks.id))
        .orderBy(desc(alerts.createdAt));

      if (status === "active" || status === "resolved") {
        query = query.where(eq(alerts.status, status)) as typeof query;
      }

      const results = await query;
      return reply.send({ success: true, count: results.length, data: results });
    }
  );

  // Selesaikan alert secara manual (Mendukung PATCH dan PUT, khusus role admin & operator)
  const handleResolveAlert = async (request: any, reply: any) => {
    const id = parseInt(request.params.id, 10);

    const [resolved] = await db
      .update(alerts)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
      })
      .where(eq(alerts.id, id))
      .returning();

    if (!resolved) {
      return reply.status(404).send({ success: false, message: "Alert not found" });
    }

    // Catat log audit
    const currentUser = request.user as { id: string; username: string };
    await db.insert(auditLogs).values({
      userId: currentUser.id,
      action: "RESOLVE_ALERT",
      entity: "alerts",
      entityId: resolved.id.toString(),
      detail: `Alert level ${resolved.level} diselesaikan secara manual oleh ${currentUser.username}`,
      ipAddress: request.ip,
    });

    wsBroadcaster.broadcast("ALERT_RESOLVED", resolved);

    return reply.send({ success: true, data: resolved });
  };

  fastify.patch<{ Params: { id: string } }>("/api/alerts/:id/resolve", operatorGuard, handleResolveAlert);
  fastify.put<{ Params: { id: string } }>("/api/alerts/:id/resolve", operatorGuard, handleResolveAlert);
}
