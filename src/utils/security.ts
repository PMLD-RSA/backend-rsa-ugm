import { env } from "../config/env.js";

/**
 * Memvalidasi apakah origin request diizinkan berdasarkan:
 * 1. Request tanpa origin (curl, mobile native, server-to-server) -> Diizinkan
 * 2. Origin localhost / 127.0.0.1 (pengembangan lokal) -> Diizinkan
 * 3. Domain dinamis Tailscale (*.ts.net) -> Diizinkan (mendukung perubahan URL Tailscale)
 * 4. IP privat lokal / Tailscale CGNAT IP (100.x, 192.168.x, 10.x, 172.16-31.x) -> Diizinkan
 * 5. Pada mode development, seluruh origin berbasis HTTP diizinkan untuk kemudahan pengujian tanpa proteksi SSL
 * 6. Origin yang terdaftar secara eksplisit di environment variable CORS_ALLOWED_ORIGINS
 */
export function isAllowedOrigin(origin?: string, nodeEnv: string = env.NODE_ENV): boolean {
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

  // 3. Pengujian IP Privat Lokal / Tailscale CGNAT IP (100.x, 192.168.x, 10.x, 172.16-31.x)
  if (
    /^https?:\/\/(100\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
      cleanOrigin
    )
  ) {
    return true;
  }

  // 4. Jika mode development, izinkan seluruh origin HTTP untuk kemudahan development tanpa proteksi SSL
  if (nodeEnv === "development" && /^http:\/\//i.test(cleanOrigin)) {
    return true;
  }

  // 5. Pengujian daftar asal tambahan dari variabel lingkungan
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


