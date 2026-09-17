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

      // Simpan data ke database
      if (recordsToInsert.length > 0) {
        try {
          // Coba insert seluruh batch sekaligus
          await db.insert(waterLevelReadings).values(recordsToInsert);
          console.log(`[BatchWriter] Berhasil menyimpan ${recordsToInsert.length} data ke database`);
        } catch (batchErr: unknown) {
          // Jika batch gagal (misal salah satu tank_id tidak ada di DB / foreign key constraint violation),
          // fallback insert per-item agar data yang valid tetap tersimpan dan tidak terblokir
          const errDetail = batchErr instanceof Error ? batchErr.message : String(batchErr);
          console.warn(`[BatchWriter] Batch insert gagal (${errDetail}), memproses per-item...`);

          let savedCount = 0;
          for (const rec of recordsToInsert) {
            try {
              await db.insert(waterLevelReadings).values(rec);
              savedCount++;
            } catch (singleErr: unknown) {
              const singleDetail =
                (singleErr as { detail?: string })?.detail ||
                (singleErr instanceof Error ? singleErr.message : String(singleErr));
              console.warn(
                `[BatchWriter] Mengabaikan data tidak valid (tank_id: ${rec.tankId}): ${singleDetail}`
              );
              // Catat data rusak ke antrean Dead Letter di Redis
              await RedisStreamService.pushToDeadLetter(rec, singleDetail);
            }
          }

          if (savedCount > 0) {
            console.log(
              `[BatchWriter] Berhasil menyimpan ${savedCount}/${recordsToInsert.length} data valid ke database`
            );
          }
        }
      }

      // Hapus seluruh ID yang sudah diproses dari buffer Redis agar antrean tidak tersumbat
      await RedisStreamService.deleteProcessed(allBatchIds);
    } catch (error) {
      console.error("[BatchWriter] Gagal memproses batch:", error);
    } finally {
      this.isProcessing = false;
    }
  }
}

