import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const gateways = pgTable("gateways", {
  id: uuid("id").primaryKey().defaultRandom(),
  deviceCode: varchar("device_code", { length: 50 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("online"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Gateway = typeof gateways.$inferSelect;
export type NewGateway = typeof gateways.$inferInsert;

