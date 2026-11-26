import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "../api/server.js";
import {
  mqttMessagesTotal,
  sensorOutOfRangeTotal,
  batchWriterRecordsTotal,
  batchWriterDurationSeconds,
  redisStreamPendingLength,
  watchdogOfflineEventsTotal,
  alertsTriggeredTotal,
} from "../services/metrics.js";
import { wsBroadcaster } from "../services/ws-broadcaster.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("🧪 MENJALANKAN TEST SUITE: PROMETHEUS METRICS & GRAFANA");
  console.log("=======================================================\n");

  const app = await createServer({ nodeEnv: "test" });

  try {
    // --- SUITE 1: Endpoint /metrics dan Metrik HTTP Fastify ---
    console.log("--- 1. Pengujian Endpoint /metrics & Hook HTTP ---");

    // Picu beberapa request HTTP untuk mengisi metrik
    const notFoundRes = await app.inject({ method: "GET", url: "/api/route-tidak-ada" });
    assert(notFoundRes.statusCode === 404, "Request ke rute tidak ada mengembalikan 404");

    const metricsRes = await app.inject({ method: "GET", url: "/metrics" });
    assert(metricsRes.statusCode === 200, "GET /metrics harus mengembalikan HTTP 200");
    assert(
      (metricsRes.headers["content-type"] || "").includes("text/plain"),
      "Content-Type /metrics harus sesuai standar text/plain Prometheus"
    );

    const body1 = metricsRes.body;
    assert(
      body1.includes("rsa_backend_nodejs_heap_size_used_bytes"),
      "Metrik bawaan Node.js (heap memory) harus terekspor"
    );
    assert(
      body1.includes('rsa_http_requests_total{method="GET",route="/api/route-tidak-ada",status_code="404"} 1'),
      "Metrik rsa_http_requests_total mencatat request 404 dengan label yang benar"
    );
    assert(
      body1.includes("rsa_http_request_duration_seconds_bucket"),
      "Histogram latensi HTTP (rsa_http_request_duration_seconds) harus terekspor"
    );

    // --- SUITE 2: Pengecualian Rate Limit untuk Scraper Prometheus ---
    console.log("\n--- 2. Pengujian Pengecualian Rate Limit pada /metrics ---");
    let rateLimited = false;
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "GET", url: "/metrics" });
      if (r.statusCode === 429) rateLimited = true;
    }
    assert(!rateLimited, "Endpoint /metrics tidak boleh terkena rate limit 429 saat di-scrape berkala");

    // --- SUITE 3: Metrik WebSocket & Pipa Data IoT ---
    console.log("\n--- 3. Pengujian Metrik WebSocket & Pipa Data IoT ---");

    // Simulasi koneksi WebSocket dan broadcast
    const mockWs: any = { readyState: 1, send: () => {}, on: () => {} };
    wsBroadcaster.addClient(mockWs);
    wsBroadcaster.broadcast("LEVEL_UPDATE", { level_percent: 75 });

    // Simulasi metrik pipa IoT (MQTT, Redis, BatchWriter, Alert, Watchdog)
    mqttMessagesTotal.inc({ topic_type: "level", status: "processed" }, 5);
    mqttMessagesTotal.inc({ topic_type: "level", status: "duplicate_dropped" }, 2);
    sensorOutOfRangeTotal.inc({ tank_name: "Tangki Bedah" }, 1);
    batchWriterRecordsTotal.inc({ status: "inserted" }, 5);
    batchWriterDurationSeconds.observe(0.042);
    redisStreamPendingLength.set(12);
    alertsTriggeredTotal.inc({ level: "CRITICAL" }, 1);
    watchdogOfflineEventsTotal.inc({ device_type: "gateway" }, 1);

    const metricsRes2 = await app.inject({ method: "GET", url: "/metrics" });
    const body2 = metricsRes2.body;

    assert(body2.includes("rsa_ws_connected_clients 1"), "Gauge klien WebSocket aktif tercatat bernilai 1");
    assert(
      body2.includes('rsa_ws_broadcast_messages_total{event_type="LEVEL_UPDATE"} 1'),
      "Counter broadcast WebSocket LEVEL_UPDATE tercatat"
    );
    assert(
      body2.includes('rsa_mqtt_messages_total{topic_type="level",status="processed"} 5'),
      "Counter pesan MQTT level processed tercatat bernilai 5"
    );
    assert(
      body2.includes('rsa_mqtt_messages_total{topic_type="level",status="duplicate_dropped"} 2'),
      "Counter filter duplikasi paket LoRa mesh tercatat bernilai 2"
    );
    assert(
      body2.includes('rsa_sensor_out_of_range_total{tank_name="Tangki Bedah"} 1'),
      "Counter pembacaan sensor di luar kalibrasi tercatat"
    );
    assert(
      body2.includes('rsa_batch_writer_records_total{status="inserted"} 5'),
      "Counter data berhasil disimpan BatchWriter tercatat bernilai 5"
    );
    assert(body2.includes("rsa_redis_stream_pending_length 12"), "Gauge antrean backlog Redis tercatat bernilai 12");
    assert(
      body2.includes('rsa_alerts_triggered_total{level="CRITICAL"} 1'),
      "Counter alert CRITICAL dari WarningEngine tercatat"
    );
    assert(
      body2.includes('rsa_watchdog_offline_events_total{device_type="gateway"} 1'),
      "Counter event Watchdog offline tercatat"
    );

    wsBroadcaster.removeClient(mockWs);

    // --- SUITE 4: Validasi Konfigurasi Dashboard Grafana ---
    console.log("\n--- 4. Validasi File JSON Dashboard Grafana ---");
    const dashboardPath = resolve(process.cwd(), "monitoring/grafana/dashboards/rsa-ugm-observability.json");
    const dashboardRaw = readFileSync(dashboardPath, "utf-8");
    const dashboardJson = JSON.parse(dashboardRaw);

    assert(
      dashboardJson.uid === "rsa-ugm-backend-observability",
      "Dashboard JSON Grafana valid dan memiliki UID yang sesuai"
    );
    assert(
      Array.isArray(dashboardJson.panels) && dashboardJson.panels.length >= 10,
      `Dashboard memiliki ${dashboardJson.panels.length} panel monitoring siap pakai`
    );

    // --- SUITE 5: Validasi Prometheus Alert Rules ---
    console.log("\n--- 5. Validasi Prometheus Alert Rules (alerts.yml) ---");
    const promConfigRaw = readFileSync(
      resolve(process.cwd(), "monitoring/prometheus/prometheus.yml"),
      "utf-8"
    );
    const alertsRulesRaw = readFileSync(
      resolve(process.cwd(), "monitoring/prometheus/alerts.yml"),
      "utf-8"
    );

    assert(
      promConfigRaw.includes("/etc/prometheus/alerts.yml"),
      "prometheus.yml harus memuat rule_files /etc/prometheus/alerts.yml"
    );
    assert(
      alertsRulesRaw.includes("BackendServiceDown") &&
        alertsRulesRaw.includes("RedisQueueBacklogHigh") &&
        alertsRulesRaw.includes("HighBackendMemory"),
      "alerts.yml memuat seluruh aturan alert utama (BackendServiceDown, RedisQueueBacklogHigh, HighBackendMemory)"
    );

    console.log("\n=======================================================");
    console.log("🎉 SEMUA TEST PROMETHEUS & GRAFANA BERHASIL LULUS 100%!");
    console.log("=======================================================\n");
  } finally {
    await app.close();
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
