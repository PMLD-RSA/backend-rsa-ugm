import { db } from "../db/index.js";
import { waterLevelReadings, NewWaterLevelReading } from "../db/schema/index.js";
import { RedisStreamService, redis } from "./redis-stream.js";
import { env } from "../config/env.js";

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

      const recordsToInsert: NewWaterLevelReading[] = batch.map(({ payload }) => ({
        tankId: payload.tank_id,
        sensorNodeId: payload.sensor_node_id,
        levelPercent: payload.level_percent.toString(),
        volumeLiters: payload.volume_liters.toString(),
        rawValue: payload.raw_value ? payload.raw_value.toString() : null,
        rssi: payload.rssi ?? null,
        recordedAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
      }));

      // Simpan ke database
      await db.insert(waterLevelReadings).values(recordsToInsert);

      // Hapus dari buffer Redis
      const ids = batch.map((item) => item.id);
      await RedisStreamService.deleteProcessed(ids);

      console.log(`[BatchWriter] Berhasil menyimpan ${recordsToInsert.length} data ke database`);
    } catch (error) {
      console.error("[BatchWriter] Gagal batch insert:", error);
    } finally {
      this.isProcessing = false;
    }
  }
}

