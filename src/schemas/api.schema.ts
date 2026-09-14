import { z } from "zod";

export const createTankSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().max(150).optional(),
  capacityLiters: z.number().positive(),
  minThresholdPercent: z.number().min(0).max(100).default(30),
  maxThresholdPercent: z.number().min(0).max(100).default(90),
});

export const updateTankSchema = createTankSchema.partial();

export const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

export const readingsQuerySchema = z.object({
  hours: z.coerce.number().positive().default(24),
  limit: z.coerce.number().positive().default(1000),
});

export const resolveAlertSchema = z.object({
  note: z.string().optional(),
});

