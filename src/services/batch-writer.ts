import { db } from "../db/index.js";
import { waterLevelReadings, NewWaterLevelReading } from "../db/schema/index.js";
import { RedisStreamService, redis } from "./redis-stream.js";
import { env } from "../config/env.js";

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export class BatchWriterService {
  private static timer: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  public static start(): void {
    if (this.timer) return;

    console.log("[BatchWriter] Menjalankan batch writer...");

    this.timer = setInterval(() => {
      this.processBatch();
    }, env.BATCH_INTERVAL_MS);
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[BatchWriter] Batch writer dihentikan");
    }
  }

  public static async processBatch(): Promise<void> {
    if (this.isProcessing) return;
    if (redis.status !== "ready") return;
    this.isProcessing = true;

    try {
      const batch = await RedisStreamService.readBatch(env.BATCH_SIZE);

      if (batch.length === 0) {
        this.isProcessing = false;
        return;
      }

      const allBatchIds = batch.map((item) => item.id);
      const recordsToInsert: NewWaterLevelReading[] = [];

      for (const { payload } of batch) {
        let tankId: string | null = isUUID(payload.tank_id) ? payload.tank_id : null;
        let nodeId: string | null = isUUID(payload.sensor_node_id) ? payload.sensor_node_id : null;

        // Validasi UUID tank
        if (!tankId) {
          console.warn(`[BatchWriter] Mengabaikan payload: tank_id bukan UUID valid (${payload.tank_id})`);
          continue;
        }

        recordsToInsert.push({
          tankId,
          sensorNodeId: nodeId,
          levelPercent: payload.level_percent.toString(),
          volumeLiters: payload.volume_liters.toString(),
          rawValue: payload.raw_value ? payload.raw_value.toString() : null,
          rssi: payload.rssi ?? null,
          recordedAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        });
      }

      // Simpan data yang valid ke database
      if (recordsToInsert.length > 0) {
        await db.insert(waterLevelReadings).values(recordsToInsert);
        console.log(`[BatchWriter] Berhasil menyimpan ${recordsToInsert.length} data ke database`);
      }

      // Hapus seluruh ID yang sudah diproses dari buffer Redis agar antrian tidak macet
      await RedisStreamService.deleteProcessed(allBatchIds);
    } catch (error) {
      console.error("[BatchWriter] Gagal batch insert:", error);
    } finally {
      this.isProcessing = false;
    }
  }
}

