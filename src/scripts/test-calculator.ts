import { TankCalculatorService, TankCalibrationConfig } from "../services/tank-calculator.js";
import { mqttLevelPayloadSchema } from "../schemas/mqtt.schema.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("=== MEMULAI TEST KALKULASI LEVEL & VOLUME AIR BACKEND ===");

  const sampleTank: TankCalibrationConfig = {
    tankId: "f5d31c46-1ae8-4838-ba0e-4eb5c8705831",
    sensorNodeId: "a513b2b5-0c97-4dab-baf6-2b6d57aa4944",
    tankName: "Tangki Atap Gedung Utama",
    capacityLiters: 10000,
    minDistanceCm: 30, // 100% full
    maxDistanceCm: 350, // 0% empty
    minThresholdPercent: 30,
    maxThresholdPercent: 90,
  };

  // 1. Test Kasus Kosong (Jarak = maxDistanceCm = 350cm)
  console.log("\n[TEST 1] Kondisi Tangki Kosong (distance = 350cm):");
  const emptyRes = TankCalculatorService.calculate(350, sampleTank);
  console.log(`  Level: ${emptyRes.levelPercent}%, Volume: ${emptyRes.volumeLiters}L, OutOfRange: ${emptyRes.isOutOfRange}`);
  assert(emptyRes.levelPercent === 0, "Level persen harus 0%");
  assert(emptyRes.volumeLiters === 0, "Volume harus 0 Liter");
  assert(!emptyRes.isOutOfRange, "Jarak 350cm berada di dalam rentang wajar");

  // 2. Test Kasus Penuh (Jarak = minDistanceCm = 30cm)
  console.log("\n[TEST 2] Kondisi Tangki Penuh (distance = 30cm):");
  const fullRes = TankCalculatorService.calculate(30, sampleTank);
  console.log(`  Level: ${fullRes.levelPercent}%, Volume: ${fullRes.volumeLiters}L, OutOfRange: ${fullRes.isOutOfRange}`);
  assert(fullRes.levelPercent === 100, "Level persen harus 100%");
  assert(fullRes.volumeLiters === 10000, "Volume harus 10000 Liter");
  assert(!fullRes.isOutOfRange, "Jarak 30cm berada di dalam rentang wajar");

  // 3. Test Kasus Setengah Penuh (Jarak = 190cm, tengah-tengah antara 30 dan 350)
  console.log("\n[TEST 3] Kondisi Tangki 50% (distance = 190cm):");
  const halfRes = TankCalculatorService.calculate(190, sampleTank);
  console.log(`  Level: ${halfRes.levelPercent}%, Volume: ${halfRes.volumeLiters}L, OutOfRange: ${halfRes.isOutOfRange}`);
  assert(halfRes.levelPercent === 50, "Level persen harus 50%");
  assert(halfRes.volumeLiters === 5000, "Volume harus 5000 Liter");

  // 4. Test Kasus Pembacaan Riil Raspberry Pi (distance = 341.0cm)
  console.log("\n[TEST 4] Pembacaan Riil RPi (distance = 341.0cm):");
  const rpiRes = TankCalculatorService.calculate(341, sampleTank);
  // (350 - 341) / (350 - 30) = 9 / 320 = 2.8125% -> 2.81%
  // Volume = 2.81% * 10000 = 281 L
  console.log(`  Level: ${rpiRes.levelPercent}%, Volume: ${rpiRes.volumeLiters}L`);
  assert(rpiRes.levelPercent === 2.81, "Level persen harus 2.81%");
  assert(rpiRes.volumeLiters === 281, "Volume harus 281 Liter");

  // 5. Test Kasus Out-of-Range (Air meluap / di atas sensor, distance = 10cm < 30cm)
  console.log("\n[TEST 5] Jarak di bawah batas minimum / Overflow (distance = 10cm):");
  const overflowRes = TankCalculatorService.calculate(10, sampleTank);
  console.log(`  Level: ${overflowRes.levelPercent}%, Volume: ${overflowRes.volumeLiters}L, OutOfRange: ${overflowRes.isOutOfRange}`);
  assert(overflowRes.levelPercent === 100, "Level harus di-clamp ke 100%");
  assert(overflowRes.volumeLiters === 10000, "Volume harus di-clamp ke kapasitas");
  assert(overflowRes.isOutOfRange === true, "Harus ditandai isOutOfRange = true");

  // 6. Test Kasus Out-of-Range (Jarak melebihi dasar tangki, distance = 400cm > 350cm)
  console.log("\n[TEST 6] Jarak melampaui dasar tangki / Lost Echo (distance = 400cm):");
  const echoRes = TankCalculatorService.calculate(400, sampleTank);
  console.log(`  Level: ${echoRes.levelPercent}%, Volume: ${echoRes.volumeLiters}L, OutOfRange: ${echoRes.isOutOfRange}`);
  assert(echoRes.levelPercent === 0, "Level harus di-clamp ke 0%");
  assert(echoRes.volumeLiters === 0, "Volume harus 0 Liter");
  assert(echoRes.isOutOfRange === true, "Harus ditandai isOutOfRange = true");

  // 7. Test Validasi Skema MQTT Baru
  console.log("\n[TEST 7] Validasi Skema MQTT Zod:");

  // Kasus A: Payload minimalis baru dari RPi (hanya distance_cm, rssi, seq, tanpa level_percent & volume_liters)
  const newPayload = {
    tank_id: "f5d31c46-1ae8-4838-ba0e-4eb5c8705831",
    sensor_node_id: "a513b2b5-0c97-4dab-baf6-2b6d57aa4944",
    distance_cm: 341.0,
    rssi: -68,
    sequence: 171,
    is_buffered: false,
    timestamp: "2026-11-12T08:42:49.380690+00:00",
  };
  const parseA = mqttLevelPayloadSchema.safeParse(newPayload);
  assert(parseA.success === true, "Payload minimalis baru harus lolos validasi");
  console.log("  Payload minimalis baru (tanpa level_percent/volume_liters): PASS");

  // Kasus B: Payload legacy RPi (masih mengirim level_percent: 0.0 & volume_liters: 0.0)
  const legacyPayload = {
    tank_id: "f5d31c46-1ae8-4838-ba0e-4eb5c8705831",
    sensor_node_id: "a513b2b5-0c97-4dab-baf6-2b6d57aa4944",
    level_percent: 0.0,
    volume_liters: 0.0,
    distance_cm: 341.0,
    sequence: 171,
    is_buffered: false,
    timestamp: "2026-11-12T08:42:49.380690+00:00",
  };
  const parseB = mqttLevelPayloadSchema.safeParse(legacyPayload);
  assert(parseB.success === true, "Payload legacy RPi harus tetap lolos validasi");
  console.log("  Payload legacy RPi: PASS");

  // Kasus C: Payload invalid (distance_cm negatif)
  const invalidPayload = {
    sensor_node_id: "a513b2b5-0c97-4dab-baf6-2b6d57aa4944",
    distance_cm: -5,
  };
  const parseC = mqttLevelPayloadSchema.safeParse(invalidPayload);
  assert(parseC.success === false, "Payload dengan distance_cm negatif harus ditolak");
  console.log("  Payload invalid (distance negatif ditolak): PASS");

  console.log("\n=== SELURUH PENGUJIAN KALKULASI BERHASIL (100% PASS) ===");
}

runTests();
