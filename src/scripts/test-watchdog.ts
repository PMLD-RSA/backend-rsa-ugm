import { DeviceWatchdogService } from "../services/device-watchdog.js";
import { wsBroadcaster } from "../services/ws-broadcaster.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  } else {
    console.log(`[PASS] ${message}`);
  }
}

async function runTests() {

  const now = new Date("2026-11-20T12:00:00.000Z");
  const timeoutMs = 2 * 60 * 1000; // 2 menit

  // --- SUITE 1: Verifikasi Logika Evaluasi Timeout (Pure Function) ---
  console.log("--- 1. Pengujian Logika Timeout (isDeviceStale) ---");

  // Kasus 1: Perangkat baru melapor 30 detik lalu (harus SEHAT / aktif)
  const recentReport = new Date("2026-11-20T11:59:30.000Z");
  const isStale1 = DeviceWatchdogService.isDeviceStale(recentReport, recentReport, timeoutMs, now);
  assert(!isStale1, "Perangkat dengan aktivitas 30 detik lalu TIDAK boleh dianggap stale");

  // Kasus 2: Perangkat melapor tepat 2 menit lalu (boundary check)
  const boundaryReport = new Date("2026-11-20T11:58:00.000Z");
  const isStale2 = DeviceWatchdogService.isDeviceStale(boundaryReport, boundaryReport, timeoutMs, now);
  assert(!isStale2, "Perangkat tepat pada batas waktu (120s) masih belum melebihi batas stale");

  // Kasus 3: Perangkat melapor 2 menit 1 detik lalu (harus TIMEOUT / stale)
  const expiredReport = new Date("2026-11-20T11:57:59.000Z");
  const isStale3 = DeviceWatchdogService.isDeviceStale(expiredReport, expiredReport, timeoutMs, now);
  assert(isStale3, "Perangkat dengan aktivitas > 2 menit WAJIB terdeteksi stale (offline)");

  // Kasus 4: Perangkat baru dibuat tapi belum pernah kirim heartbeat sama sekali
  // a) Baru dibuat 30 detik lalu (masih dalam grace period)
  const newCreated = new Date("2026-11-20T11:59:30.000Z");
  const isStaleNew = DeviceWatchdogService.isDeviceStale(null, newCreated, timeoutMs, now);
  assert(!isStaleNew, "Perangkat baru tanpa heartbeat tapi umur < 2 menit TIDAK boleh langsung offline");

  // b) Dibuat 10 menit lalu dan tidak pernah ada heartbeat
  const oldCreated = new Date("2026-11-20T11:50:00.000Z");
  const isStaleOld = DeviceWatchdogService.isDeviceStale(null, oldCreated, timeoutMs, now);
  assert(isStaleOld, "Perangkat tanpa heartbeat dan umur > 2 menit WAJIB terdeteksi stale");

  // --- SUITE 2: Verifikasi Integrasi WebSocket Broadcaster ---
  console.log("\n--- 2. Pengujian Integrasi WebSocket Broadcaster ---");

  const broadcastEvents: Array<{ type: string; data: any }> = [];
  // Simulasikan client WebSocket dummy
  const mockWs: any = {
    readyState: 1, // WebSocket.OPEN
    send: (msg: string) => {
      const parsed = JSON.parse(msg);
      broadcastEvents.push(parsed);
    },
    on: () => {},
  };

  wsBroadcaster.addClient(mockWs);

  // Broadcast event GATEWAY_STATUS
  wsBroadcaster.broadcast("GATEWAY_STATUS", {
    device_code: "GW-HUB-01",
    status: "offline",
    last_heartbeat: expiredReport.toISOString(),
    timestamp: now.toISOString(),
  });

  // Broadcast event NODE_STATUS
  wsBroadcaster.broadcast("NODE_STATUS", {
    sensor_node_id: "SN-TNK-01",
    device_code: "STM32-A01",
    status: "offline",
    last_seen: expiredReport.toISOString(),
    timestamp: now.toISOString(),
  });

  assert(broadcastEvents.length === 2, "Dua event broadcast harus berhasil diterima client");
  assert(broadcastEvents[0].type === "GATEWAY_STATUS", "Event 1 harus bertipe GATEWAY_STATUS");
  assert(broadcastEvents[0].data.status === "offline", "Payload Gateway harus berstatus 'offline'");
  assert(broadcastEvents[1].type === "NODE_STATUS", "Event 2 harus bertipe NODE_STATUS");
  assert(broadcastEvents[1].data.status === "offline", "Payload Node harus berstatus 'offline'");

  wsBroadcaster.removeClient(mockWs);

  // --- SUITE 3: Verifikasi Konfigurasi Default Watchdog ---
  console.log("\n--- 3. Pengujian Konfigurasi Default Watchdog ---");
  const customWatchdog = new DeviceWatchdogService({
    checkIntervalMs: 15000,
    gatewayTimeoutMs: 60000,
    sensorTimeoutMs: 90000,
  });

  assert(customWatchdog.checkIntervalMs === 15000, "Konfigurasi interval kustom harus dihormati");
  assert(customWatchdog.gatewayTimeoutMs === 60000, "Konfigurasi gateway timeout kustom harus dihormati");
  assert(customWatchdog.sensorTimeoutMs === 90000, "Konfigurasi sensor timeout kustom harus dihormati");

  console.log("ALL TESTS PASSED");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
