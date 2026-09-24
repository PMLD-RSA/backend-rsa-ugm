import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Menghasilkan hash password menggunakan scrypt dengan salt 16-byte
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

// Memverifikasi password terhadap hash yang tersimpan
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;

    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = scryptSync(password, salt, 64);

    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}
