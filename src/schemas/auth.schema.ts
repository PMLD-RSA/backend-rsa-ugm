import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(3, "Username minimal 3 karakter"),
  password: z.string().min(6, "Password minimal 6 karakter"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  username: z.string().min(3, "Username minimal 3 karakter"),
  password: z.string().min(6, "Password minimal 6 karakter"),
  role: z.enum(["admin", "operator", "viewer"]).default("operator"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  role: z.enum(["admin", "operator", "viewer"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6, "Password minimal 6 karakter").optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
