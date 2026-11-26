import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

/**
 * Registry khusus Prometheus untuk Backend Monitoring Tangki Air RSA UGM.
 * Memisahkan registry memudahkan isolasi pengujian (unit testing) dan menghindari bentrok global.
 */
export const metricsRegistry = new Registry();

// Kumpulkan metrik bawaan runtime Node.js (CPU, RAM Heap, Event Loop Lag, GC, Handles)
collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "rsa_backend_",
});

// =========================================================================
// USE CASE 1: Backend API & Runtime Observability (Fastify + WebSocket)
// =========================================================================

export const httpRequestsTotal = new Counter({
  name: "rsa_http_requests_total",
  help: "Total HTTP request yang masuk ke REST API Fastify",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "rsa_http_request_duration_seconds",
  help: "Distribusi latensi respons HTTP API dalam detik",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const wsConnectedClients = new Gauge({
  name: "rsa_ws_connected_clients",
  help: "Jumlah klien browser (WebSocket) yang sedang terhubung secara aktif",
  registers: [metricsRegistry],
});

export const wsBroadcastMessagesTotal = new Counter({
  name: "rsa_ws_broadcast_messages_total",
  help: "Total pesan realtime yang disiarkan melalui WebSocket berdasarkan tipe event",
  labelNames: ["event_type"] as const,
  registers: [metricsRegistry],
});

// =========================================================================
// USE CASE 2: IoT Data Pipeline & Watchdog Observability
// (MQTT -> Deduplikasi LoRa -> Redis Streams -> Batch Writer -> TimescaleDB)
// =========================================================================

export const mqttMessagesTotal = new Counter({
  name: "rsa_mqtt_messages_total",
  help: "Total pesan MQTT yang diterima worker berdasarkan tipe topik dan status pemrosesan",
  labelNames: ["topic_type", "status"] as const,
  registers: [metricsRegistry],
});

export const sensorOutOfRangeTotal = new Counter({
  name: "rsa_sensor_out_of_range_total",
  help: "Total pembacaan sensor ultrasonik yang berada di luar rentang kalibrasi tangki",
  labelNames: ["tank_name"] as const,
  registers: [metricsRegistry],
});

export const batchWriterRecordsTotal = new Counter({
  name: "rsa_batch_writer_records_total",
  help: "Total data pembacaan yang diproses oleh BatchWriterService ke TimescaleDB",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

export const batchWriterDurationSeconds = new Histogram({
  name: "rsa_batch_writer_duration_seconds",
  help: "Durasi pemrosesan satu batch dari Redis Stream ke TimescaleDB (detik)",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const redisStreamPendingLength = new Gauge({
  name: "rsa_redis_stream_pending_length",
  help: "Panjang antrean (backlog) data di Redis Stream yang menunggu ditulis ke TimescaleDB",
  registers: [metricsRegistry],
});

export const watchdogOfflineEventsTotal = new Counter({
  name: "rsa_watchdog_offline_events_total",
  help: "Total kejadian perangkat IoT (gateway/sensor_node) terdeteksi offline oleh Watchdog",
  labelNames: ["device_type"] as const,
  registers: [metricsRegistry],
});

export const alertsTriggeredTotal = new Counter({
  name: "rsa_alerts_triggered_total",
  help: "Total peringatan (WARNING/CRITICAL) yang dipicu oleh WarningEngine",
  labelNames: ["level"] as const,
  registers: [metricsRegistry],
});

export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}

export async function getMetricsText(): Promise<string> {
  return metricsRegistry.metrics();
}
