import { z } from "zod";

export const createTankSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().max(150).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  capacityLiters: z.number().positive(),
  minThresholdPercent: z.number().min(0).max(100).default(30),
  maxThresholdPercent: z.number().min(0).max(100).default(90),
  minDistanceCm: z.number().nonnegative().default(30),
  maxDistanceCm: z.number().positive().default(350),
});

export const updateTankSchema = createTankSchema.partial();

export const sensorNodeInputSchema = z.object({
  deviceCode: z.string().trim().min(1).max(50),
  gatewayId: z.string().uuid(),
  sensorType: z.string().trim().min(1).max(50).default("ultrasonic"),
});

export const createTankWithSensorSchema = createTankSchema
  .extend({
    sensorNode: sensorNodeInputSchema,
  })
  .superRefine((data, ctx) => {
    if (data.minThresholdPercent >= data.maxThresholdPercent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minThresholdPercent"],
        message: "minThresholdPercent harus lebih kecil dari maxThresholdPercent",
      });
    }
    if (data.minDistanceCm >= data.maxDistanceCm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minDistanceCm"],
        message: "minDistanceCm harus lebih kecil dari maxDistanceCm",
      });
    }
  });

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
