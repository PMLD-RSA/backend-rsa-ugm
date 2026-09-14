import { mqttSubscriber } from "./mqtt-subscriber.js";
import { BatchWriterService } from "../services/batch-writer.js";
import { redis } from "../services/redis-stream.js";

export async function startWorker() {
  console.log("Menjalankan worker (MQTT + Batch Writer)...");

  // Koneksi Redis
  try {
    await redis.connect();
    console.log("[Worker] Terhubung ke Redis");
  } catch (err) {
    console.warn("[Worker] Peringatan koneksi Redis:", err);
  }

  BatchWriterService.start();
  mqttSubscriber.start();

  // Penanganan shutdown
  const shutdown = () => {
    console.log("Menghentikan worker...");
    mqttSubscriber.stop();
    BatchWriterService.stop();
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js")) {
  startWorker();
}

