import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { MqttLevelPayload } from "../schemas/mqtt.schema.js";

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  },
  lazyConnect: true,
});

// Tangani event error agar tidak menghasilkan unhandled error event di console
redis.on("error", (_err) => {
  // Ditangani secara halus saat mencoba reconnect
});

export class RedisStreamService {
  private static streamKey = env.REDIS_STREAM_KEY;

  public static async pushReading(payload: MqttLevelPayload): Promise<string | null> {
    try {
      const id = await redis.xadd(
        this.streamKey,
        "*",
        "payload",
        JSON.stringify(payload)
      );
      return id;
    } catch (error) {
      console.error("[RedisStreamService] Gagal push data:", error);
      return null;
    }
  }

  public static async readBatch(
    count = 50
  ): Promise<Array<{ id: string; payload: MqttLevelPayload }>> {
    try {
      const result = await redis.xrevrange(this.streamKey, "+", "-", "COUNT", count);

      if (!result || result.length === 0) {
        return [];
      }

      const items: Array<{ id: string; payload: MqttLevelPayload }> = [];

      for (const [id, fields] of result) {
        const payloadIndex = fields.indexOf("payload");
        if (payloadIndex !== -1 && fields[payloadIndex + 1]) {
          try {
            const data = JSON.parse(fields[payloadIndex + 1]) as MqttLevelPayload;
            items.push({ id, payload: data });
          } catch {
            // abaikan JSON tidak valid
          }
        }
      }

      return items;
    } catch (error) {
      console.error("[RedisStreamService] Gagal membaca batch:", error);
      return [];
    }
  }

  public static async deleteProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await redis.xdel(this.streamKey, ...ids);
    } catch (error) {
      console.error("[RedisStreamService] Gagal menghapus data:", error);
    }
  }
}

