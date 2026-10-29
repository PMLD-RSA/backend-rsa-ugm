import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { env } from "../config/env.js";
import { isAllowedOrigin } from "../utils/security.js";
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

  // 1. Header Keamanan HTTP (Helmet)
  await fastify.register(helmet, {
    contentSecurityPolicy: env.ENABLE_SWAGGER
      ? false // Menghindari pemblokiran file script dan css internal Swagger UI
      : {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "wss:", "https:"],
          },
        },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // 2. Proteksi CORS Dinamis (Mendukung Tailscale *.ts.net, Localhost, dan Whitelist Kustom)
  await fastify.register(cors, {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Akses ditolak oleh kebijakan CORS: Origin tidak diizinkan"), false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Gateway-Key"],
  });

  // 3. Rate Limiting Global
  await fastify.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: "1 minute",
    allowList: (req) => {
      // Pengecualian rate limit untuk health check dan panggilan sinkronisasi gateway yang valid
      if (req.url === "/health") return true;
      if (req.url.startsWith("/api/gateways/") && req.headers["x-gateway-key"]) return true;
      return false;
    },
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Batas laju request terlampaui. Silakan coba kembali dalam ${Math.ceil(context.ttl / 1000)} detik.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // 4. Utilitas, JWT, WebSocket, dan Dokumentasi API
  await fastify.register(sensible);
  await fastify.register(jwtPlugin);
  await fastify.register(websocketPlugin);
  await fastify.register(swaggerPlugin);

  // 5. Registrasi Rute API
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(tanksRoutes);
  await fastify.register(readingsRoutes);
  await fastify.register(alertsRoutes);
  await fastify.register(gatewaysRoutes);
  await fastify.register(auditLogsRoutes);
  await fastify.register(reportsRoutes);

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
    if (env.ENABLE_SWAGGER) {
      console.log(`Swagger UI API Docs: http://${env.HOST === "0.0.0.0" ? "localhost" : env.HOST}:${env.PORT}/docs`);
    }
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
