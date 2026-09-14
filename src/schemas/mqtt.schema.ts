import { z } from "zod";

export const mqttLevelPayloadSchema = z.object({
  tank_id: z.string().min(1, "tank_id is required"),
  sensor_node_id: z.string().min(1, "sensor_node_id is required"),
  level_percent: z.number().min(0).max(100),
  volume_liters: z.number().min(0),
  raw_value: z.number().optional(),
  rssi: z.number().optional(),
  timestamp: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type MqttLevelPayload = z.infer<typeof mqttLevelPayloadSchema>;

export const mqttStatusPayloadSchema = z.object({
  tank_id: z.string().min(1),
  sensor_node_id: z.string().min(1),
  status: z.enum(["online", "offline", "active", "error"]),
  battery_level: z.number().min(0).max(100).optional(),
  timestamp: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type MqttStatusPayload = z.infer<typeof mqttStatusPayloadSchema>;

export const mqttHeartbeatPayloadSchema = z.object({
  device_code: z.string().min(1),
  type: z.enum(["gateway", "sensor_node"]).default("sensor_node"),
  timestamp: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type MqttHeartbeatPayload = z.infer<typeof mqttHeartbeatPayloadSchema>;

