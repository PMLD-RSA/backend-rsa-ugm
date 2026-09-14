import { pgTable, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { tanks } from "./tanks.js";
import { gateways } from "./gateways.js";

export const sensorNodes = pgTable("sensor_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tankId: uuid("tank_id").references(() => tanks.id, { onDelete: "cascade" }),
  gatewayId: uuid("gateway_id").references(() => gateways.id, { onDelete: "set null" }),
  deviceCode: varchar("device_code", { length: 50 }).notNull().unique(),
  sensorType: varchar("sensor_type", { length: 50 }).notNull().default("ultrasonic"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  lastRssi: integer("last_rssi"),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SensorNode = typeof sensorNodes.$inferSelect;
export type NewSensorNode = typeof sensorNodes.$inferInsert;

