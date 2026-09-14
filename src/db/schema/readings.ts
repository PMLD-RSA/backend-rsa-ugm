import { pgTable, bigserial, uuid, numeric, integer, timestamp, index } from "drizzle-orm/pg-core";
import { tanks } from "./tanks.js";
import { sensorNodes } from "./sensor-nodes.js";

export const waterLevelReadings = pgTable(
  "water_level_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tankId: uuid("tank_id").references(() => tanks.id, { onDelete: "cascade" }),
    sensorNodeId: uuid("sensor_node_id").references(() => sensorNodes.id, { onDelete: "set null" }),
    levelPercent: numeric("level_percent", { precision: 5, scale: 2 }).notNull(),
    volumeLiters: numeric("volume_liters", { precision: 10, scale: 2 }).notNull(),
    rawValue: numeric("raw_value", { precision: 10, scale: 2 }),
    rssi: integer("rssi"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_readings_tank_recorded").on(table.tankId, table.recordedAt),
  ]
);

export type WaterLevelReading = typeof waterLevelReadings.$inferSelect;
export type NewWaterLevelReading = typeof waterLevelReadings.$inferInsert;

