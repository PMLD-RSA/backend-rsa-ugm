import fp from "fastify-plugin";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const swaggerPlugin = fp(async (fastify: FastifyInstance) => {
  // Jika Swagger UI dinonaktifkan di konfigurasi environment (misal di produksi publik)
  if (!env.ENABLE_SWAGGER) {
    fastify.log.info("[Swagger] Dokumentasi Swagger UI dinonaktifkan via konfigurasi ENABLE_SWAGGER=false");
    return;
  }

  // Lokasi dokumen openapi.yaml di folder docs
  const openapiPath = path.resolve(__dirname, "../../../docs/openapi.yaml");

  // Daftarkan Swagger core dengan spesifikasi statis dari file openapi.yaml
  await fastify.register(fastifySwagger, {
    mode: "static",
    specification: {
      path: openapiPath,
      baseDir: path.dirname(openapiPath),
    },
  });

  // Daftarkan antarmuka Swagger UI interaktif di rute /docs
  await fastify.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      displayRequestDuration: true,
      persistAuthorization: true,
    },
    staticCSP: false,
  });

  // Alias /documentation agar otomatis redirect ke /docs
  fastify.get("/documentation", async (_req, reply) => {
    return reply.redirect("/docs");
  });
});
