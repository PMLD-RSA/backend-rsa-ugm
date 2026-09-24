import { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, auditLogs } from "../../db/schema/index.js";
import { loginSchema } from "../../schemas/auth.schema.js";
import { verifyPassword } from "../../utils/password.js";

export async function authRoutes(fastify: FastifyInstance) {
  // Login pengguna & penerbitan token JWT
  fastify.post("/api/auth/login", async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validasi gagal",
        errors: parseResult.error.format(),
      });
    }

    const { username, password } = parseResult.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user || !user.isActive) {
      return reply.status(401).send({
        success: false,
        message: "Username atau password salah",
      });
    }

    const isMatch = verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      return reply.status(401).send({
        success: false,
        message: "Username atau password salah",
      });
    }

    // Terbitkan token JWT
    const token = fastify.jwt.sign({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    // Catat log aktivitas login
    await db.insert(auditLogs).values({
      userId: user.id,
      action: "LOGIN",
      entity: "users",
      entityId: user.id,
      detail: `User ${user.username} berhasil login`,
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      message: "Login berhasil",
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      },
    });
  });

  // Profil pengguna aktif
  fastify.get(
    "/api/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userPayload = request.user as { id: string };

      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userPayload.id))
        .limit(1);

      if (!user) {
        return reply.status(404).send({
          success: false,
          message: "User tidak ditemukan",
        });
      }

      return reply.send({
        success: true,
        data: user,
      });
    }
  );
}
