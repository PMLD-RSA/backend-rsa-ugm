import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createServer } from "../api/server.js";
import { db, queryClient } from "../db/index.js";
import { auditLogs, gateways, sensorNodes, tanks, users } from "../db/schema/index.js";
import { hashPassword } from "../utils/password.js";

async function runTests() {
  const dbUrl = process.env.DATABASE_URL || "";
  if (!dbUrl.includes("test")) {
    throw new Error(
      `Pengujian wajib menggunakan database uji (DATABASE_URL harus mengandung 'test', saat ini: '${dbUrl}')`
    );
  }

  console.log("Menyiapkan data uji pada test database...");

  // Bersihkan tabel terkait sebelum pengujian
  await db.delete(auditLogs);
  await db.delete(sensorNodes);
  await db.delete(tanks);
  await db.delete(gateways);
  await db.delete(users);

  const [adminUser] = await db
    .insert(users)
    .values({
      username: "test_admin",
      passwordHash: hashPassword("admin123"),
      role: "admin",
      isActive: true,
    })
    .returning();

  const [operatorUser] = await db
    .insert(users)
    .values({
      username: "test_operator",
      passwordHash: hashPassword("operator123"),
      role: "operator",
      isActive: true,
    })
    .returning();

  const [gateway] = await db
    .insert(gateways)
    .values({
      deviceCode: "GW-TEST-01",
      status: "online",
      lastHeartbeat: new Date(),
    })
    .returning();

  const app = await createServer({ nodeEnv: "test" });
  await app.ready();

  try {
    const login = async (username: string, password: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username, password },
      });
      assert.equal(res.statusCode, 200, `Login ${username} harus berhasil`);
      return res.json().data.token as string;
    };

    const adminToken = await login(adminUser.username, "admin123");
    const operatorToken = await login(operatorUser.username, "operator123");

    const validPayload = {
      name: "DTK",
      location: "Gedung DTK, Sekolah Vokasi UGM",
      latitude: -7.7747806,
      longitude: 110.3743778,
      capacityLiters: 8000,
      minThresholdPercent: 30,
      maxThresholdPercent: 90,
      minDistanceCm: 30,
      maxDistanceCm: 350,
      sensorNode: {
        deviceCode: "STM32-DTK",
        gatewayId: gateway.id,
        sensorType: "ultrasonic",
      },
    };

    // 1. Unauthorized tanpa token -> 401
    const unauthRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      payload: validPayload,
    });
    assert.equal(unauthRes.statusCode, 401, "Tanpa token harus mengembalikan 401");
    console.log("[PASS] 1. Request tanpa Bearer JWT ditolak (401)");

    // 2. Forbidden untuk non-admin -> 403
    const forbiddenRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: validPayload,
    });
    assert.equal(forbiddenRes.statusCode, 403, "Role operator harus ditolak (403)");
    console.log("[PASS] 2. Role non-admin ditolak (403)");

    // 3. Input tidak valid -> 400
    const invalidPayloads = [
      { ...validPayload, name: "   " },
      { ...validPayload, latitude: -95 },
      { ...validPayload, minThresholdPercent: 90, maxThresholdPercent: 30 },
      { ...validPayload, minDistanceCm: 350, maxDistanceCm: 30 },
      {
        ...validPayload,
        sensorNode: { ...validPayload.sensorNode, gatewayId: "not-a-uuid" },
      },
      {
        ...validPayload,
        sensorNode: { ...validPayload.sensorNode, deviceCode: "" },
      },
    ];

    for (const badPayload of invalidPayloads) {
      const badRes = await app.inject({
        method: "POST",
        url: "/api/tanks/with-sensor",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: badPayload,
      });
      assert.equal(badRes.statusCode, 400, "Input tidak valid harus mengembalikan 400");
      assert.equal(badRes.json().success, false);
    }
    console.log("[PASS] 3. Seluruh kasus input tidak valid mengembalikan 400");

    // 4. Gateway tidak terdaftar -> 404
    const missingGwRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validPayload,
        sensorNode: {
          ...validPayload.sensorNode,
          gatewayId: "00000000-0000-4000-8000-000000000999",
        },
      },
    });
    assert.equal(missingGwRes.statusCode, 404, "Gateway tidak terdaftar harus mengembalikan 404");
    console.log("[PASS] 4. Gateway tidak terdaftar ditolak (404)");

    // 5. Kasus berhasil -> 201
    const createRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: validPayload,
    });
    assert.equal(createRes.statusCode, 201, `Kasus berhasil harus 201, dapat: ${createRes.body}`);
    const createdBody = createRes.json();
    assert.equal(createdBody.success, true);
    const createdTank = createdBody.data;

    assert.equal(createdTank.name, "DTK");
    assert.equal(createdTank.location, "Gedung DTK, Sekolah Vokasi UGM");
    assert.equal(createdTank.latitude, "-7.7747806");
    assert.equal(createdTank.longitude, "110.3743778");
    assert.equal(createdTank.latestReading, null);
    assert.equal(createdTank.activeAlert, null);
    assert.equal(createdTank.nodes.length, 1);

    const createdSensor = createdTank.nodes[0];
    assert.equal(createdSensor.deviceCode, "STM32-DTK");
    assert.equal(createdSensor.tankId, createdTank.id);
    assert.equal(createdSensor.gatewayId, gateway.id);
    assert.equal(createdSensor.sensorType, "ultrasonic");
    assert.equal(createdSensor.status, "offline");
    assert.equal(createdSensor.lastSeen, null);

    const [auditRecord] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, createdTank.id))
      .limit(1);
    assert.ok(auditRecord, "Audit log harus tercatat dalam transaksi");
    assert.equal(auditRecord.action, "CREATE_TANK_WITH_SENSOR");
    console.log("[PASS] 5. Pembuatan tangki + sensor + audit log berhasil (201)");

    // 6. Kode sensor duplikat -> 409 dan tidak meninggalkan tangki tanpa sensor
    const dupRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validPayload,
        name: "DTK-DUPLICATE",
      },
    });
    assert.equal(dupRes.statusCode, 409, "deviceCode duplikat harus mengembalikan 409");
    assert.equal(dupRes.json().success, false);
    console.log("[PASS] 6. Kode sensor duplikat mengembalikan 409");

    // 7. Rollback transaksi jika penyimpanan sensor atau audit log gagal
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fail_test_audit_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.detail LIKE '%ROLLBACK-AUDIT-TEST%' THEN
          RAISE EXCEPTION 'Simulated audit log failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`
      DROP TRIGGER IF EXISTS trg_fail_test_audit ON audit_logs;
      CREATE TRIGGER trg_fail_test_audit
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION fail_test_audit_insert();
    `);

    const rollbackAuditRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validPayload,
        name: "ROLLBACK-AUDIT-TEST",
        sensorNode: {
          ...validPayload.sensorNode,
          deviceCode: "STM32-ROLLBACK-AUDIT",
        },
      },
    });
    assert.equal(rollbackAuditRes.statusCode, 500, "Kegagalan audit log harus menggagalkan request");

    await db.execute(sql`DROP TRIGGER IF EXISTS trg_fail_test_audit ON audit_logs;`);
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_test_audit_insert();`);

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fail_test_sensor_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.device_code = 'STM32-ROLLBACK-SENSOR' THEN
          RAISE EXCEPTION 'Simulated sensor insert failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`
      DROP TRIGGER IF EXISTS trg_fail_test_sensor ON sensor_nodes;
      CREATE TRIGGER trg_fail_test_sensor
      BEFORE INSERT ON sensor_nodes
      FOR EACH ROW EXECUTE FUNCTION fail_test_sensor_insert();
    `);

    const rollbackSensorRes = await app.inject({
      method: "POST",
      url: "/api/tanks/with-sensor",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        ...validPayload,
        name: "ROLLBACK-SENSOR-TEST",
        sensorNode: {
          ...validPayload.sensorNode,
          deviceCode: "STM32-ROLLBACK-SENSOR",
        },
      },
    });
    assert.equal(rollbackSensorRes.statusCode, 500, "Kegagalan sensor insert harus menggagalkan request");

    await db.execute(sql`DROP TRIGGER IF EXISTS trg_fail_test_sensor ON sensor_nodes;`);
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_test_sensor_insert();`);
    console.log("[PASS] 7. Kegagalan sensor / audit log membatalkan transaksi pembuatan tangki");

    // 8. Verifikasi melalui GET /api/tanks dan GET /api/nodes
    const tanksRes = await app.inject({
      method: "GET",
      url: "/api/tanks",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(tanksRes.statusCode, 200);
    const tanksData = tanksRes.json().data as Array<any>;
    assert.equal(tanksData.length, 1, "Hanya boleh ada 1 tangki (duplikat & rollback tidak tersimpan)");
    assert.equal(tanksData[0].id, createdTank.id);
    assert.equal(tanksData[0].name, "DTK");
    assert.equal(tanksData[0].latitude, "-7.7747806");
    assert.equal(tanksData[0].longitude, "110.3743778");
    assert.equal(tanksData[0].nodes.length, 1);
    assert.equal(tanksData[0].nodes[0].deviceCode, "STM32-DTK");
    assert.equal(tanksData[0].nodes[0].status, "offline");
    assert.equal(tanksData[0].nodes[0].lastSeen, null);

    const nodesRes = await app.inject({
      method: "GET",
      url: "/api/nodes",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(nodesRes.statusCode, 200);
    const nodesData = nodesRes.json().data as Array<any>;
    assert.equal(nodesData.length, 1, "Hanya boleh ada 1 sensor node");
    assert.equal(nodesData[0].deviceCode, "STM32-DTK");
    assert.equal(nodesData[0].tankId, createdTank.id);
    assert.equal(nodesData[0].tankName, "DTK");
    assert.equal(nodesData[0].gatewayId, gateway.id);
    assert.equal(nodesData[0].gatewayCode, "GW-TEST-01");
    assert.equal(nodesData[0].status, "offline");
    assert.equal(nodesData[0].lastSeen, null);

    console.log("[PASS] 8. Verifikasi GET /api/tanks dan GET /api/nodes sesuai & bebas tangki yatim");
    console.log("\nSEMUA PENGUJIAN POST /api/tanks/with-sensor LULUS 100%!");
  } finally {
    await app.close();
    await queryClient.end();
  }
}

runTests().catch((err) => {
  console.error("Test gagal:", err);
  process.exit(1);
});
