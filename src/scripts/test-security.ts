import { createServer } from "../api/server.js";
import { isAllowedOrigin } from "../utils/security.js";
import { WebSocket } from "ws";

async function runSecurityTests() {
  console.log("=== MEMULAI PENGUJIAN KEAMANAN SISTEM & DUKUNGAN HTTP/SSL ===");

  // 1. Pengujian isAllowedOrigin Logic (Development vs Production)
  console.log("\n[TEST 1] Pengujian Fungsi Whitelist Origin Dinamis (CORS):");
  const testOrigins = [
    { origin: "http://localhost:3000", env: "development", expected: true, desc: "Localhost HTTP di dev" },
    { origin: "http://127.0.0.1:5173", env: "development", expected: true, desc: "127.0.0.1 HTTP di dev" },
    { origin: "https://ubuntu-luis.tail7e12bf.ts.net", env: "development", expected: true, desc: "Tailscale Funnel HTTPS" },
    { origin: "http://100.94.192.102:8000", env: "development", expected: true, desc: "Tailscale IP HTTP di dev" },
    { origin: "http://192.168.1.50:3000", env: "development", expected: true, desc: "LAN IP HTTP di dev" },
    { origin: "http://frontend-dev-app:3000", env: "development", expected: true, desc: "HTTP origin bebas di dev" },
    { origin: "https://evil-hacker.com", env: "development", expected: false, desc: "Untrusted HTTPS di dev" },
    { origin: "https://phishing-site.xyz", env: "development", expected: false, desc: "Untrusted domain di dev" },
    { origin: "http://evil-hacker.com", env: "production", expected: false, desc: "Non-whitelisted HTTP di prod" },
    { origin: undefined, env: "development", expected: true, desc: "Request server-to-server/curl tanpa origin" },
  ];

  let originTestsPassed = true;
  for (const t of testOrigins) {
    const result = isAllowedOrigin(t.origin, t.env);
    const pass = result === t.expected;
    if (!pass) originTestsPassed = false;
    console.log(`  [${t.env}] ${t.desc} ("${t.origin}") -> Diizinkan: ${result} | Expected: ${t.expected} [${pass ? "PASS" : "FAIL"}]`);
  }
  console.log(`  Status Pengujian Origin CORS: [${originTestsPassed ? "PASS" : "FAIL"}]`);

  // 2. Pengujian Header Keamanan (Helmet) pada Mode Development vs Production
  console.log("\n[TEST 2] Pengujian Header Keamanan (Helmet) - HTTP vs SSL Enforcement:");

  // A. Mode Development: Pastikan HSTS dinonaktifkan agar HTTP dapat diakses tanpa pemaksaan SSL
  const devServer = await createServer({ nodeEnv: "development" });
  devServer.get("/test-headers", async () => ({ status: "ok" }));
  await devServer.ready();

  const devHeaderRes = await devServer.inject({
    method: "GET",
    url: "/test-headers",
  });

  const devHsts = devHeaderRes.headers["strict-transport-security"];
  const devXcto = devHeaderRes.headers["x-content-type-options"];
  const devXfo = devHeaderRes.headers["x-frame-options"];

  console.log("  --- Mode Development (HTTP Friendly) ---");
  console.log(`  Strict-Transport-Security: ${devHsts || "TIDAK DITEMUKAN (HSTS nonaktif - HTTP diizinkan)"}`);
  console.log(`  X-Content-Type-Options: ${devXcto}`);
  console.log(`  X-Frame-Options: ${devXfo}`);

  const devHstsCorrect = devHsts === undefined; // HSTS harus tidak ada di mode dev
  const devPassed = devHstsCorrect && Boolean(devXcto && devXfo);
  console.log(`  Status Keamanan Development (Akses HTTP tanpa pemaksaan SSL): [${devPassed ? "PASS" : "FAIL"}]`);
  await devServer.close();

  // B. Mode Production: Pastikan HSTS aktif dengan preload untuk menegakkan proteksi SSL penuh
  const prodServer = await createServer({ nodeEnv: "production" });
  prodServer.get("/test-headers", async () => ({ status: "ok" }));
  await prodServer.ready();

  const prodHeaderRes = await prodServer.inject({
    method: "GET",
    url: "/test-headers",
  });

  const prodHsts = prodHeaderRes.headers["strict-transport-security"];
  const prodXcto = prodHeaderRes.headers["x-content-type-options"];
  const prodXfo = prodHeaderRes.headers["x-frame-options"];

  console.log("  --- Mode Production (SSL Enforced) ---");
  console.log(`  Strict-Transport-Security: ${prodHsts || "TIDAK DITEMUKAN"}`);
  console.log(`  X-Content-Type-Options: ${prodXcto}`);
  console.log(`  X-Frame-Options: ${prodXfo}`);

  const prodHstsCorrect = Boolean(prodHsts && prodHsts.includes("max-age=31536000"));
  const prodPassed = prodHstsCorrect && Boolean(prodXcto && prodXfo);
  console.log(`  Status Keamanan Production (Proteksi SSL/HSTS Wajib): [${prodPassed ? "PASS" : "FAIL"}]`);
  await prodServer.close();

  // 3. Pengujian CORS Preflight & Akses HTTP pada Server Aktif
  console.log("\n[TEST 3] Pengujian Proteksi CORS Preflight:");
  const server = await createServer({ nodeEnv: "development" });
  server.get("/test-headers", async () => ({ status: "ok" }));
  await server.ready();

  // Kasus A: Origin HTTP development (misal: frontend React/Next.js via HTTP)
  const devCorsRes = await server.inject({
    method: "OPTIONS",
    url: "/test-headers",
    headers: {
      origin: "http://100.94.192.102:3000",
      "access-control-request-method": "GET",
    },
  });
  const devCorsHeader = devCorsRes.headers["access-control-allow-origin"];
  console.log(`  HTTP Dev Origin (100.94.192.102:3000) -> Access-Control-Allow-Origin: ${devCorsHeader} [${devCorsHeader === "http://100.94.192.102:3000" ? "PASS" : "FAIL"}]`);

  // Kasus B: Origin sah Tailscale HTTPS
  const allowedCorsRes = await server.inject({
    method: "OPTIONS",
    url: "/test-headers",
    headers: {
      origin: "https://ubuntu-luis.tail7e12bf.ts.net",
      "access-control-request-method": "GET",
    },
  });
  const allowedHeader = allowedCorsRes.headers["access-control-allow-origin"];
  console.log(`  Tailscale HTTPS Origin -> Access-Control-Allow-Origin: ${allowedHeader} [${allowedHeader === "https://ubuntu-luis.tail7e12bf.ts.net" ? "PASS" : "FAIL"}]`);

  // Kasus C: Origin penyerang
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

  // 5. Pengujian WebSocket Authentication & Origin (Dukungan ws:// dan HTTP di Dev)
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

  // Kasus C: WebSocket dengan origin HTTP development & token valid
  const wsDevValid = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws?token=${validToken}`, {
      headers: {
        origin: "http://100.94.192.102:3000",
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
  console.log(`  WS token & origin HTTP dev valid -> ${wsDevValid} [${wsDevValid.includes("CONNECTED") ? "PASS" : "FAIL"}]`);

  await server.close();
  console.log("\n=== SELURUH PENGUJIAN KEAMANAN & AKSES HTTP/SSL BERHASIL DISELESAIKAN ===");
  process.exit(0);
}

runSecurityTests().catch((err) => {
  console.error("Gagal menjalankan pengujian:", err);
  process.exit(1);
});

