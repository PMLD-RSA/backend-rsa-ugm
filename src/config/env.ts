import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/water_tank_db"),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_STREAM_KEY: z.string().default("stream:water_readings"),
  REDIS_CONSUMER_GROUP: z.string().default("group:water_batch_writer"),

  MQTT_BROKER_URL: z.string().default("mqtt://localhost:1883"),
  MQTT_CLIENT_ID: z.string().default("tank_backend_subscriber"),
  MQTT_USERNAME: z.string().optional().default(""),
  MQTT_PASSWORD: z.string().optional().default(""),
  MQTT_TOPIC_LEVEL: z.string().default("hospital/+/level"),
  MQTT_TOPIC_STATUS: z.string().default("hospital/+/status"),
  MQTT_TOPIC_HEARTBEAT: z.string().default("hospital/+/heartbeat"),

  BATCH_SIZE: z.coerce.number().default(50),
  BATCH_INTERVAL_MS: z.coerce.number().default(3000),

  JWT_SECRET: z.string().default("secret_jwt_key_hospital_water_monitoring"),
  JWT_EXPIRES_IN: z.string().default("1d"),
  GATEWAY_SYNC_KEY: z.string().default("dev_insecure_gateway_key_rsa_ugm"),

  // Keamanan & Pembatasan
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(120),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().default(5),
  ENABLE_SWAGGER: z
    .preprocess((val) => {
      if (typeof val === "string") {
        return val.toLowerCase() === "true" || val === "1";
      }
      if (typeof val === "boolean") return val;
      return true;
    }, z.boolean())
    .default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Konfigurasi environment tidak valid:", parsed.error.format());
  process.exit(1);
}

// Peringatan keamanan untuk konfigurasi produksi
if (parsed.data.NODE_ENV === "production") {
  if (
    parsed.data.GATEWAY_SYNC_KEY === "dev_insecure_gateway_key_rsa_ugm" ||
    parsed.data.GATEWAY_SYNC_KEY === "secret_gateway_rsa_ugm_2026"
  ) {
    console.warn(
      "[PERINGATAN KEAMANAN] GATEWAY_SYNC_KEY terdeteksi menggunakan kunci default/lemah pada mode produksi. Harap setel kunci acak yang aman di variabel lingkungan."
    );
  }
}

export const env = parsed.data;
