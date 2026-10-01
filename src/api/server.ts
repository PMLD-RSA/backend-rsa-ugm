import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { env } from "../config/env.js";
import { jwtPlugin } from "./plugins/jwt.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { usersRoutes } from "./routes/users.routes.js";
import { tanksRoutes } from "./routes/tanks.routes.js";
import { readingsRoutes } from "./routes/readings.routes.js";
import { alertsRoutes } from "./routes/alerts.routes.js";
import { gatewaysRoutes } from "./routes/gateways.routes.js";
import { auditLogsRoutes } from "./routes/audit-logs.routes.js";
import { reportsRoutes } from "./routes/reports.routes.js";
import { protoRoutes } from "./routes/proto.routes.js";

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname",
              },
            }
          : undefined,
    },
  });

  // Plugin Fastify
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(sensible);
  await fastify.register(jwtPlugin);
  await fastify.register(websocketPlugin);
  await fastify.register(swaggerPlugin);

  // Route API
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(tanksRoutes);
  await fastify.register(readingsRoutes);
  await fastify.register(alertsRoutes);
  await fastify.register(gatewaysRoutes);
  await fastify.register(auditLogsRoutes);
  await fastify.register(reportsRoutes);
  await fastify.register(protoRoutes);

  return fastify;
}

export async function startServer() {
  const server = await createServer();

  try {
    const address = await server.listen({
      port: env.PORT,
      host: env.HOST,
    });
    console.log(`Server API & WebSocket berjalan di ${address}`);
    console.log(`WebSocket stream: ws://${env.HOST === "0.0.0.0" ? "localhost" : env.HOST}:${env.PORT}/ws`);
    console.log(`Swagger UI API Docs: http://${env.HOST === "0.0.0.0" ? "localhost" : env.HOST}:${env.PORT}/docs`);
    return server;
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Direct execution check
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  startServer();
}

