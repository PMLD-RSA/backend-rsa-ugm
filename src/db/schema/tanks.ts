import { pgTable, uuid, varchar, numeric, timestamp } from "drizzle-orm/pg-core";

export const tanks = pgTable("tanks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  location: varchar("location", { length: 150 }),
  capacityLiters: numeric("capacity_liters", { precision: 10, scale: 2 }).notNull(),
  minThresholdPercent: numeric("min_threshold_percent", { precision: 5, scale: 2 }).notNull().default("30.00"),
  maxThresholdPercent: numeric("max_threshold_percent", { precision: 5, scale: 2 }).notNull().default("90.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tank = typeof tanks.$inferSelect;
export type NewTank = typeof tanks.$inferInsert;

