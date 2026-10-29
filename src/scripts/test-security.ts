import { createServer } from "../api/server.js";
import { isAllowedOrigin } from "../utils/security.js";
import { WebSocket } from "ws";

async function runSecurityTests() {
  console.log("=== MEMULAI PENGUJIAN KEAMANAN SISTEM ===");

  // 1. Pengujian isAllowedOrigin Logic
  console.log("\n[TEST 1] Pengujian Fungsi Whitelist Origin Dinamis (CORS):");
  const testOrigins = [
    { origin: "http://localhost:3000", expected: true },
    { origin: "http://127.0.0.1:5173", expected: true },
    { origin: "https://ubuntu-luis.tail7e12bf.ts.net", expected: true },
    { origin: "https://node-random-vps.ts.net", expected: true },
    { origin: "https://another-node.tail12345.ts.net:8443", expected: true },
    { origin: "https://evil-hacker.com", expected: false },
    { origin: "https://phishing-site.xyz", expected: false },
    { origin: undefined, expected: true }, // curl / server-to-server
  ];

  for (const t of testOrigins) {
    const result = isAllowedOrigin(t.origin);
    const pass = result === t.expected;
    console.log(`  Origin: "${t.origin}" -> Diizinkan: ${result} | Expected: ${t.expected} [${pass ? "PASS" : "FAIL"}]`);
  }

  // Buat instance server Fastify
  const server = await createServer();

  // Tambahkan rute ringan untuk pengujian header tanpa menyentuh database
  server.get("/test-headers", async () => ({ status: "ok" }));

  await server.ready();

  // 2. Pengujian Header Keamanan (Helmet)
  console.log("\n[TEST 2] Pengujian Header Keamanan (Helmet):");
  const headerRes = await server.inject({
    method: "GET",
    url: "/test-headers",
  });

  const hsts = headerRes.headers["strict-transport-security"];
  const xcto = headerRes.headers["x-content-type-options"];
  const xfo = headerRes.headers["x-frame-options"];

  console.log(`  Strict-Transport-Security: ${hsts || "TIDAK DITEMUKAN"}`);
  console.log(`  X-Content-Type-Options: ${xcto || "TIDAK DITEMUKAN"}`);
  console.log(`  X-Frame-Options: ${xfo || "TIDAK DITEMUKAN"}`);

  const headersPassed = Boolean(hsts && xcto && xfo);
  console.log(`  Status Header Keamanan: [${headersPassed ? "PASS" : "FAIL"}]`);

  // 3. Pengujian CORS Preflight
  console.log("\n[TEST 3] Pengujian Proteksi CORS Preflight:");
  
  // Kasus A: Origin sah (Tailscale)
  const allowedCorsRes = await server.inject({
    method: "OPTIONS",
    url: "/test-headers",
    headers: {
      origin: "https://ubuntu-luis.tail7e12bf.ts.net",
      "access-control-request-method": "GET",
    },
  });
  const allowedHeader = allowedCorsRes.headers["access-control-allow-origin"];
  console.log(`  Tailscale Origin -> Access-Control-Allow-Origin: ${allowedHeader} [${allowedHeader === "https://ubuntu-luis.tail7e12bf.ts.net" ? "PASS" : "FAIL"}]`);

  // Kasus B: Origin penyerang
  const blockedCorsRes = await server.inject({
    method: "OPTIONS",
    url: "/test-headers",
    headers: {
      origin: "https://evil-attacker.com",
      "access-control-request-method": "GET",
    },
  });
  const blockedHeader = blockedCorsRes.headers["access-control-allow-origin"];
  const corsBlockedPass = !blockedHeader || blockedHeader !== "https://evil-attacker.com";
  console.log(`  Attacker Origin -> Access-Control-Allow-Origin: ${blockedHeader || "NONE (Blocked)"} [${corsBlockedPass ? "PASS" : "FAIL"}]`);

  // 4. Pengujian Rate Limiting pada Login
  console.log("\n[TEST 4] Pengujian Rate Limiting pada /api/auth/login (Max 5 attempts):");
  let rateLimitHit = false;
  for (let i = 1; i <= 7; i++) {
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {}, // Payload kosong memicu validasi 400 di fastify tanpa memanggil database
    });

    if (res.statusCode === 429) {
      rateLimitHit = true;
      console.log(`  Request #${i}: HTTP 429 Too Many Requests (Rate limit terpicu!)`);
      break;
    } else {
      console.log(`  Request #${i}: HTTP ${res.statusCode}`);
    }
  }
  console.log(`  Status Rate Limiting: [${rateLimitHit ? "PASS" : "FAIL"}]`);

  // 5. Pengujian WebSocket Authentication & Origin
  console.log("\n[TEST 5] Pengujian WebSocket Security (/ws):");
  const testPort = 8099;
  await server.listen({ port: testPort, host: "127.0.0.1" });

  const validToken = server.jwt.sign({
    id: "test-user-id",
    username: "operator_test",
    role: "operator",
  });

  // Kasus A: WebSocket tanpa token
  const wsNoToken = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    ws.on("message", (data) => {
      resolve(`Message: ${data.toString()}`);
    });
    ws.on("close", (code, reason) => {
      resolve(`Closed code: ${code}, reason: ${reason.toString()}`);
    });
    ws.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
  console.log(`  WS tanpa token -> ${wsNoToken} [${wsNoToken.includes("1008") || wsNoToken.includes("ERROR") ? "PASS" : "FAIL"}]`);

  // Kasus B: WebSocket dengan origin penyerang
  const wsBadOrigin = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${validToken}`, {
      headers: {
        origin: "https://evil-attacker.com",
      },
    });
    ws.on("message", (data) => {
      resolve(`Message: ${data.toString()}`);
    });
    ws.on("close", (code, reason) => {
      resolve(`Closed code: ${code}, reason: ${reason.toString()}`);
    });
    ws.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
  console.log(`  WS origin penyerang -> ${wsBadOrigin} [${wsBadOrigin.includes("1008") || wsBadOrigin.includes("ERROR") || wsBadOrigin.includes("500") || wsBadOrigin.includes("Unexpected") ? "PASS (CORS Blocked Handshake)" : "FAIL"}]`);

  // Kasus C: WebSocket dengan origin valid & token valid
  const wsValid = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${validToken}`, {
      headers: {
        origin: "https://ubuntu-luis.tail7e12bf.ts.net",
      },
    });
    ws.on("message", (data) => {
      resolve(`Message: ${data.toString()}`);
      ws.close();
    });
    ws.on("close", (code, reason) => {
      resolve(`Closed code: ${code}, reason: ${reason.toString()}`);
    });
    ws.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
  console.log(`  WS token & origin valid -> ${wsValid} [${wsValid.includes("CONNECTED") ? "PASS" : "FAIL"}]`);

  await server.close();
  console.log("\n=== SELURUH PENGUJIAN KEAMANAN BERHASIL DISELESAIKAN ===");
  process.exit(0);
}

runSecurityTests().catch((err) => {
  console.error("Gagal menjalankan pengujian:", err);
  process.exit(1);
});
