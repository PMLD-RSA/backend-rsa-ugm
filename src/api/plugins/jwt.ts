import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: {
      id: string;
      username: string;
      role: "admin" | "operator" | "viewer";
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      allowedRoles: Array<"admin" | "operator" | "viewer">
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const jwtPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });

  // Middleware verifikasi token JWT
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized",
          message: "Invalid or missing token",
        });
      }
    }
  );

  // Middleware otorisasi Role-Based Access Control (RBAC)
  fastify.decorate(
    "authorize",
    (allowedRoles: Array<"admin" | "operator" | "viewer">) => {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.user as {
          id: string;
          username: string;
          role: "admin" | "operator" | "viewer";
        };

        if (!user || !allowedRoles.includes(user.role)) {
          return reply.status(403).send({
            success: false,
            error: "Forbidden",
            message: "Akses ditolak: role pengguna tidak memiliki izin untuk aksi ini",
          });
        }
      };
    }
  );
});
