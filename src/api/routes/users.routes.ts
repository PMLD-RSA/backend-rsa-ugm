import { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users, auditLogs } from "../../db/schema/index.js";
import { createUserSchema, updateUserSchema } from "../../schemas/auth.schema.js";
import { hashPassword } from "../../utils/password.js";

export async function usersRoutes(fastify: FastifyInstance) {
  // Hanya admin yang bisa mengelola akun pengguna
  const adminGuard = {
    preHandler: [fastify.authenticate, fastify.authorize(["admin"])],
  };

  // List seluruh akun pengguna
  fastify.get("/api/users", adminGuard, async (_request, reply) => {
    const list = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return reply.send({
      success: true,
      count: list.length,
      data: list,
    });
  });

  // Tambah akun pengguna baru
  fastify.post("/api/users", adminGuard, async (request, reply) => {
    const parseResult = createUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validasi gagal",
        errors: parseResult.error.format(),
      });
    }

    const { username, password, role } = parseResult.data;

    // Cek apakah username sudah dipakai
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existing) {
      return reply.status(409).send({
        success: false,
        message: "Username sudah digunakan",
      });
    }

    const passwordHash = hashPassword(password);
    const [newUser] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        role,
        isActive: true,
      })
      .returning({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      });

    // Catat log audit
    const adminUser = request.user as { id: string };
    await db.insert(auditLogs).values({
      userId: adminUser.id,
      action: "CREATE_USER",
      entity: "users",
      entityId: newUser.id,
      detail: `Membuat akun user '${newUser.username}' dengan role '${newUser.role}'`,
      ipAddress: request.ip,
    });

    return reply.status(201).send({
      success: true,
      message: "Pengguna baru berhasil dibuat",
      data: newUser,
    });
  });

  // Handler update akun pengguna (mendukung PATCH dan PUT)
  const handleUpdateUser = async (
    request: any,
    reply: any
  ) => {
    const { id } = request.params;
    const parseResult = updateUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        message: "Validasi gagal",
        errors: parseResult.error.format(),
      });
    }

    const updateData: Record<string, unknown> = {};
    if (parseResult.data.role !== undefined) updateData.role = parseResult.data.role;
    if (parseResult.data.isActive !== undefined) updateData.isActive = parseResult.data.isActive;
    if (parseResult.data.password) {
      updateData.passwordHash = hashPassword(parseResult.data.password);
    }

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({
        success: false,
        message: "Tidak ada field data yang diubah",
      });
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
      });

    if (!updatedUser) {
      return reply.status(404).send({
        success: false,
        message: "Pengguna tidak ditemukan",
      });
    }

    // Catat log audit
    const adminUser = request.user as { id: string };
    await db.insert(auditLogs).values({
      userId: adminUser.id,
      action: "UPDATE_USER",
      entity: "users",
      entityId: updatedUser.id,
      detail: `Memperbarui akun user '${updatedUser.username}': ${JSON.stringify(parseResult.data)}`,
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      message: "Pengguna berhasil diperbarui",
      data: updatedUser,
    });
  };

  fastify.patch<{ Params: { id: string } }>("/api/users/:id", adminGuard, handleUpdateUser);
  fastify.put<{ Params: { id: string } }>("/api/users/:id", adminGuard, handleUpdateUser);

  // Hapus akun pengguna
  fastify.delete<{ Params: { id: string } }>(
    "/api/users/:id",
    adminGuard,
    async (request, reply) => {
      const { id } = request.params;

      const [deleted] = await db
        .delete(users)
        .where(eq(users.id, id))
        .returning({ id: users.id, username: users.username });

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          message: "Pengguna tidak ditemukan",
        });
      }

      // Catat log audit
      const adminUser = request.user as { id: string };
      await db.insert(auditLogs).values({
        userId: adminUser.id,
        action: "DELETE_USER",
        entity: "users",
        entityId: deleted.id,
        detail: `Menghapus akun user '${deleted.username}'`,
        ipAddress: request.ip,
      });

      return reply.send({
        success: true,
        message: "User deleted successfully",
      });
    }
  );
}
