import { FastifyInstance } from "fastify";
import { eq, desc, count, and } from "drizzle-orm";
import { db } from "../../db/index.js";
import { auditLogs } from "../../db/schema/index.js";

export async function auditLogsRoutes(fastify: FastifyInstance) {
  // Hanya admin yang bisa melihat log audit
  const adminGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(["admin"])],
  };

  // Riwayat audit log aktivitas sistem
  fastify.get<{
    Querystring: { page?: string; limit?: string; entity?: string };
  }>("/api/audit-logs", adminGuard, async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page || "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(request.query.limit || "50", 10)));
    const offset = (page - 1) * limit;
    const { entity } = request.query;

    const condition = entity ? eq(auditLogs.entity, entity) : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(auditLogs)
      .where(condition);

    const total = totalResult ? Number(totalResult.total) : 0;

    const logs = await db
      .select()
      .from(auditLogs)
      .where(condition)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      success: true,
      page,
      limit,
      total,
      data: logs,
    });
  });
}
