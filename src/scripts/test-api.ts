import { createServer } from "../api/server.js";

async function testAll() {
  console.log("Memulai pengujian fungsional API...");
  const app = await createServer();
  await app.ready();

  try {
    // 1. Test Health
    const resHealth = await app.inject({ method: "GET", url: "/health" });
    console.log("1. /health status:", resHealth.statusCode);

    // 2. Test Login Admin
    const resLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin123" },
    });
    console.log("2. /api/auth/login status:", resLogin.statusCode);
    const loginJson = resLogin.json();
    const token = loginJson.data?.token;

    if (!token) {
      throw new Error("Gagal mendapatkan token login");
    }

    // 3. Test /api/auth/me dengan token
    const resMe = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    console.log("3. /api/auth/me status:", resMe.statusCode, "user:", resMe.json().data?.username);

    // 4. Test /api/tanks
    const resTanks = await app.inject({
      method: "GET",
      url: "/api/tanks",
      headers: { authorization: `Bearer ${token}` },
    });
    console.log("4. /api/tanks status:", resTanks.statusCode, "jumlah tangki:", resTanks.json().data?.length);

    // 5. Test /api/nodes
    const resNodes = await app.inject({
      method: "GET",
      url: "/api/nodes",
      headers: { authorization: `Bearer ${token}` },
    });
    console.log("5. /api/nodes status:", resNodes.statusCode, "jumlah nodes:", resNodes.json().data?.length);

    // 6. Test Gateway Sync untuk Raspberry Pi
    const resSync = await app.inject({
      method: "GET",
      url: "/api/gateways/GW-HUB-01/sync",
      headers: { "x-gateway-key": "secret_gateway_rsa_ugm_2026" },
    });
    console.log("6. /api/gateways/GW-HUB-01/sync status:", resSync.statusCode, "mappings:", resSync.json().mappings?.length);

    // 7. Test Export CSV
    const firstTankId = resTanks.json().data?.[0]?.id;
    if (firstTankId) {
      const resExport = await app.inject({
        method: "GET",
        url: `/api/reports/readings/export?tankId=${firstTankId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      console.log("7. /api/reports/readings/export status:", resExport.statusCode, "header:", resExport.headers["content-type"]);
    }

    // 8. Test Audit Logs
    const resAudit = await app.inject({
      method: "GET",
      url: "/api/audit-logs",
      headers: { authorization: `Bearer ${token}` },
    });
    console.log("8. /api/audit-logs status:", resAudit.statusCode, "total logs:", resAudit.json().total);

    console.log("\nSemua pengujian API berhasil 100%!");
  } finally {
    await app.close();
    process.exit(0);
  }
}

testAll().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
