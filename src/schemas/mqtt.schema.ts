import { z } from "zod";

export const mqttLevelPayloadSchema = z.object({
  tank_id: z.string().optional(),
  sensor_node_id: z.string().min(1, "sensor_node_id is required"),
  distance_cm: z.number().nonnegative("distance_cm must be positive"),
  rssi: z.number().optional(),
  sequence: z.number().int().optional(),
  is_buffered: z.boolean().optional().default(false),
  level_percent: z.number().optional(),
  volume_liters: z.number().optional(),
  raw_value: z.number().optional(),
  timestamp: z
    .preprocess((val) => {
      if (typeof val === "number" || (typeof val === "string" && val.trim().length > 0)) {
        const d = new Date(val);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      return new Date().toISOString();
    }, z.string())
    .optional()
    .default(() => new Date().toISOString()),
});

export type MqttLevelPayload = z.infer<typeof mqttLevelPayloadSchema>;

export const mqttStatusPayloadSchema = z.object({
  tank_id: z.string().optional(),
  sensor_node_id: z.string().min(1, "sensor_node_id wajib diisi"),
  status: z
    .preprocess(
      (val) => (typeof val === "string" ? val.toLowerCase().trim() : val),
      z.enum(["online", "offline", "active", "error", "inactive"])
    )
    .transform((val) => (val === "inactive" ? "offline" : val)),
  battery_level: z.number().min(0).max(100).optional(),
  timestamp: z
    .preprocess((val) => {
      if (typeof val === "number" || (typeof val === "string" && val.trim().length > 0)) {
        const d = new Date(val);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      return new Date().toISOString();
    }, z.string())
    .optional()
    .default(() => new Date().toISOString()),
});

export type MqttStatusPayload = z.infer<typeof mqttStatusPayloadSchema>;

export const mqttHeartbeatPayloadSchema = z.object({
  device_code: z.string().min(1),
  type: z.enum(["gateway", "sensor_node"]).default("sensor_node"),
  timestamp: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type MqttHeartbeatPayload = z.infer<typeof mqttHeartbeatPayloadSchema>;

