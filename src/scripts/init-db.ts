import { sql, eq } from "drizzle-orm";
import { db, queryClient } from "../db/index.js";
import { tanks, gateways, sensorNodes, users } from "../db/schema/index.js";
import { hashPassword } from "../utils/password.js";

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
    let [gw] = await db
      .insert(gateways)
      .values({
        deviceCode: "GW-HUB-01",
        status: "online",
        lastHeartbeat: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (!gw) {
      const [existingGw] = await db
        .select()
        .from(gateways)
        .where(eq(gateways.deviceCode, "GW-HUB-01"))
        .limit(1);
      gw = existingGw;
    }

    // Data awal tangki dan sensor (2 tangki utama dengan koordinat RSA UGM)
    const sampleTanks = [
      {
        name: "Tangki Atap Gedung Utama",
        location: "Atap Gedung A (Utama), Lantai 5",
        capacityLiters: "10000.00",
        minThresholdPercent: "30.00",
        maxThresholdPercent: "90.00",
        latitude: "-7.7428450",
        longitude: "110.3511200",
      },
      {
        name: "Tangki Gedung Rawat Inap",
        location: "Atap Gedung B (Rawat Inap), Lantai 4",
        capacityLiters: "8000.00",
        minThresholdPercent: "30.00",
        maxThresholdPercent: "90.00",
        latitude: "-7.7431200",
        longitude: "110.3515400",
      },
    ];

    for (const t of sampleTanks) {
      const existing = await db
        .select()
        .from(tanks)
        .where(eq(tanks.name, t.name))
        .limit(1);

      let tankId: string | undefined;

      if (existing.length > 0) {
        await db
          .update(tanks)
          .set({
            location: t.location,
            capacityLiters: t.capacityLiters,
            minThresholdPercent: t.minThresholdPercent,
            maxThresholdPercent: t.maxThresholdPercent,
            latitude: t.latitude,
            longitude: t.longitude,
          })
          .where(eq(tanks.id, existing[0].id));
        tankId = existing[0].id;
      } else {
        const [insertedTank] = await db
          .insert(tanks)
          .values(t)
          .returning();
        tankId = insertedTank?.id;
      }

      if (tankId && gw) {
        const deviceCode = `STM32-${t.name.substring(7, 10).toUpperCase()}`;
        const [existingNode] = await db
          .select()
          .from(sensorNodes)
          .where(eq(sensorNodes.deviceCode, deviceCode))
          .limit(1);

        if (existingNode) {
          await db
            .update(sensorNodes)
            .set({
              tankId: tankId,
              gatewayId: gw.id,
              status: "active",
              lastSeen: new Date(),
            })
            .where(eq(sensorNodes.id, existingNode.id));
        } else {
          await db
            .insert(sensorNodes)
            .values({
              tankId: tankId,
              gatewayId: gw.id,
              deviceCode: deviceCode,
              sensorType: "ultrasonic",
              status: "active",
              lastSeen: new Date(),
            });
        }
      }
    }

    // Data user admin (password: admin123)
    await db
      .insert(users)
      .values({
        username: "admin",
        passwordHash: hashPassword("admin123"),
        role: "admin",
        isActive: true,
      })
      .onConflictDoUpdate({
        target: users.username,
        set: {
          passwordHash: hashPassword("admin123"),
          role: "admin",
          isActive: true,
        },
      });

    console.log("Inisialisasi database selesai");
  } catch (err) {
    console.error("Gagal inisialisasi database:", err);
  } finally {
    await queryClient.end();
  }
}

initDb();

