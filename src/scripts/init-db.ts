import { sql } from "drizzle-orm";
import { db, queryClient } from "../db/index.js";
import { tanks, gateways, sensorNodes, users } from "../db/schema/index.js";

async function initDb() {
  console.log("Inisialisasi database dan data awal...");

  try {
    // Aktifkan TimescaleDB jika tersedia
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;`);
      console.log("Ekstensi TimescaleDB aktif");

      await db.execute(
        sql`SELECT create_hypertable('water_level_readings', 'recorded_at', if_not_exists => TRUE);`
      );
      console.log("Hypertable water_level_readings dibuat");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Catatan TimescaleDB:", msg);
    }

    // Data awal gateway
    const [gw] = await db
      .insert(gateways)
      .values({
        deviceCode: "GW-HUB-01",
        status: "online",
        lastHeartbeat: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    // Data awal tangki dan sensor
    const sampleTanks = [
      {
        name: "Tangki Atap Gedung Utama",
        location: "Atap Gedung A (Utama), Lantai 5",
        capacityLiters: "10000.00",
        minThresholdPercent: "30.00",
        maxThresholdPercent: "90.00",
      },
      {
        name: "Tangki Gedung Rawat Inap",
        location: "Atap Gedung B, Lantai 4",
        capacityLiters: "8000.00",
        minThresholdPercent: "30.00",
        maxThresholdPercent: "90.00",
      },
      {
        name: "Tangki Instalasi Bedah Sentral",
        location: "Gedung IBS Lantai 3",
        capacityLiters: "5000.00",
        minThresholdPercent: "35.00",
        maxThresholdPercent: "90.00",
      },
    ];

    for (const t of sampleTanks) {
      const [insertedTank] = await db
        .insert(tanks)
        .values(t)
        .onConflictDoNothing()
        .returning();

      if (insertedTank && gw) {
        await db
          .insert(sensorNodes)
          .values({
            tankId: insertedTank.id,
            gatewayId: gw.id,
            deviceCode: `STM32-${insertedTank.name.substring(7, 10).toUpperCase()}`,
            sensorType: "ultrasonic",
            status: "active",
            lastSeen: new Date(),
          })
          .onConflictDoNothing();
      }
    }

    // Data user admin (password: admin123)
    await db
      .insert(users)
      .values({
        username: "admin",
        passwordHash: "$2b$10$EpRnTzVlqHNP0.fUbXUwSOyUIXe/QLu7VfO8N91GZ2qFw57g1hK.y",
        role: "admin",
        isActive: true,
      })
      .onConflictDoNothing();

    console.log("Inisialisasi database selesai");
  } catch (err) {
    console.error("Gagal inisialisasi database:", err);
  } finally {
    await queryClient.end();
  }
}

initDb();

