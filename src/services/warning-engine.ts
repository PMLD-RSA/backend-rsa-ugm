import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { alerts, tanks } from "../db/schema/index.js";
import { MqttLevelPayload } from "../schemas/mqtt.schema.js";
import { wsBroadcaster } from "./ws-broadcaster.js";

export class WarningEngine {
  // Evaluasi level air terhadap threshold tangki
  public static async evaluateLevel(payload: MqttLevelPayload): Promise<void> {
    const { tank_id, level_percent } = payload;

    try {
      const tankResult = await db
        .select()
        .from(tanks)
        .where(eq(tanks.id, tank_id))
        .limit(1);

      const tank = tankResult[0];
      const minThreshold = tank ? parseFloat(tank.minThresholdPercent) : 30.0;

      let alertLevel: "CRITICAL" | "WARNING" | null = null;
      let alertMessage = "";

      if (level_percent < minThreshold) {
        alertLevel = "CRITICAL";
        alertMessage = `Level air tangki ${tank ? tank.name : tank_id} CRITICAL: ${level_percent}% (di bawah ${minThreshold}%)`;
      } else if (level_percent >= minThreshold && level_percent <= 60.0) {
        alertLevel = "WARNING";
        alertMessage = `Level air tangki ${tank ? tank.name : tank_id} WARNING: ${level_percent}% (rentang 30%-60%)`;
      }

      // Cek alert aktif untuk tangki ini
      const activeAlerts = await db
        .select()
        .from(alerts)
        .where(and(eq(alerts.tankId, tank_id), eq(alerts.status, "active")))
        .limit(1);

      const currentActiveAlert = activeAlerts[0];

      if (alertLevel) {
        if (!currentActiveAlert || currentActiveAlert.level !== alertLevel) {
          if (currentActiveAlert) {
            await db
              .update(alerts)
              .set({ status: "resolved", resolvedAt: new Date() })
              .where(eq(alerts.id, currentActiveAlert.id));
          }

          const [newAlert] = await db
            .insert(alerts)
            .values({
              tankId: tank_id,
              level: alertLevel,
              message: alertMessage,
              status: "active",
            })
            .returning();

          wsBroadcaster.broadcast("ALERT_TRIGGERED", newAlert);
        }
      } else {
        // Kondisi normal (>60%): selesaikan alert aktif jika ada
        if (currentActiveAlert) {
          const [resolved] = await db
            .update(alerts)
            .set({ status: "resolved", resolvedAt: new Date() })
            .where(eq(alerts.id, currentActiveAlert.id))
            .returning();

          wsBroadcaster.broadcast("ALERT_RESOLVED", resolved);
        }
      }
    } catch (error) {
      console.error(`[WarningEngine] Gagal evaluasi tangki ${tank_id}:`, error);
    }
  }
}

