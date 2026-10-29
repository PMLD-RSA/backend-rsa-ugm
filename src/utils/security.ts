import { env } from "../config/env.js";

/**
 * Memvalidasi apakah origin request diizinkan berdasarkan:
 * 1. Request tanpa origin (curl, mobile native, server-to-server) -> Diizinkan
 * 2. Origin localhost / 127.0.0.1 (pengembangan lokal) -> Diizinkan
 * 3. Domain dinamis Tailscale (*.ts.net) -> Diizinkan (mendukung perubahan URL Tailscale)
 * 4. Origin yang terdaftar secara eksplisit di environment variable CORS_ALLOWED_ORIGINS
 */
export function isAllowedOrigin(origin?: string): boolean {
  if (!origin) {
    return true;
  }

  const cleanOrigin = origin.trim();

  // 1. Pengujian Localhost
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 2. Pengujian Domain Tailscale Funnel / MagicDNS (*.ts.net)
  // Mendukung domain dinamis seperti https://ubuntu-luis.tail7e12bf.ts.net
  if (/^https?:\/\/([a-z0-9-]+\.)*ts\.net(:\d+)?$/i.test(cleanOrigin)) {
    return true;
  }

  // 3. Pengujian daftar asal tambahan dari variabel lingkungan
  if (env.CORS_ALLOWED_ORIGINS) {
    const allowedList = env.CORS_ALLOWED_ORIGINS.split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (allowedList.includes(cleanOrigin.toLowerCase())) {
      return true;
    }
  }

  return false;
}

