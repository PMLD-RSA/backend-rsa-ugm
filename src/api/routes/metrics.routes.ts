import { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { getMetricsContentType, getMetricsText } from "../../services/metrics.js";

/**
 * Endpoint /metrics untuk di-scrape oleh Prometheus.
 * Jika METRICS_TOKEN disetel di environment, akses wajib menyertakan header Authorization: Bearer <token>.
 */
export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get("/metrics", async (request, reply) => {
    if (env.METRICS_TOKEN) {
      const authHeader = request.headers.authorization;
      if (authHeader !== `Bearer ${env.METRICS_TOKEN}`) {
        return reply.status(401).send({
          success: false,
          message: "Unauthorized: Token metrik Prometheus tidak valid",
        });
      }
    }

    const metricsPayload = await getMetricsText();
    return reply
      .header("Content-Type", getMetricsContentType())
      .header("Cache-Control", "no-store")
      .send(metricsPayload);
  });
}
