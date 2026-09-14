import { pgTable, bigserial, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { tanks } from "./tanks.js";

export const alerts = pgTable(
  "alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tankId: uuid("tank_id").references(() => tanks.id, { onDelete: "cascade" }),
    level: varchar("level", { length: 20 }).notNull(), // 'WARNING' | 'CRITICAL'
    message: varchar("message", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"), // 'active' | 'resolved'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_alerts_tank_status").on(table.tankId, table.status),
  ]
);

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;

