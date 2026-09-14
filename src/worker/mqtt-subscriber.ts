import mqtt, { MqttClient } from "mqtt";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import {
  mqttLevelPayloadSchema,
  mqttStatusPayloadSchema,
  mqttHeartbeatPayloadSchema,
} from "../schemas/mqtt.schema.js";
import { RedisStreamService } from "../services/redis-stream.js";
import { WarningEngine } from "../services/warning-engine.js";
import { wsBroadcaster } from "../services/ws-broadcaster.js";
import { db } from "../db/index.js";
import { sensorNodes, gateways } from "../db/schema/index.js";

export class MqttSubscriberService {
  private client: MqttClient | null = null;

  public start(): void {
    console.log(`[MQTT] Menghubungkan ke broker di ${env.MQTT_BROKER_URL}...`);

    this.client = mqtt.connect(env.MQTT_BROKER_URL, {
      clientId: `${env.MQTT_CLIENT_ID}_${Math.random().toString(16).substring(2, 8)}`,
      username: env.MQTT_USERNAME || undefined,
      password: env.MQTT_PASSWORD || undefined,
      reconnectPeriod: 3000,
      clean: true,
    });

    this.client.on("connect", () => {
      console.log("[MQTT] Terhubung ke broker");

      this.client?.subscribe(
        [env.MQTT_TOPIC_LEVEL, env.MQTT_TOPIC_STATUS, env.MQTT_TOPIC_HEARTBEAT],
        (err) => {
          if (err) {
            console.error("[MQTT] Gagal subscribe ke topic:", err);
          } else {
            console.log(
              `[MQTT] Subscribed ke topic: ${env.MQTT_TOPIC_LEVEL}, ${env.MQTT_TOPIC_STATUS}, ${env.MQTT_TOPIC_HEARTBEAT}`
            );
          }
        }
      );
    });

    this.client.on("message", (topic, message) => {
      this.handleMessage(topic, message.toString());
    });

    this.client.on("error", (err) => {
      if (err && err.message) {
        console.error("[MQTT] Error koneksi:", err.message);
      }
    });

    this.client.on("offline", () => {
      console.warn("[MQTT] Client offline, mencoba reconnect...");
    });
  }

  public stop(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      console.log("[MQTT] Subscriber dihentikan");
    }
  }

  private async handleMessage(topic: string, messageStr: string): Promise<void> {
    try {
      const parsedJson = JSON.parse(messageStr);

      if (topic.endsWith("/level")) {
        await this.handleLevelMessage(parsedJson);
      } else if (topic.endsWith("/status")) {
        await this.handleStatusMessage(parsedJson);
      } else if (topic.endsWith("/heartbeat")) {
        await this.handleHeartbeatMessage(parsedJson);
      }
    } catch (err) {
      console.error(`[MQTT] Gagal parse pesan pada topic ${topic}:`, err);
    }
  }

  private async handleLevelMessage(data: unknown): Promise<void> {
    const parseResult = mqttLevelPayloadSchema.safeParse(data);
    if (!parseResult.success) {
      console.warn("[MQTT] Payload level tidak valid:", parseResult.error.format());
      return;
    }

    const payload = parseResult.data;

    // Buffer ke Redis, evaluasi alert, dan kirim ke websocket
    await RedisStreamService.pushReading(payload);
    await WarningEngine.evaluateLevel(payload);
    wsBroadcaster.broadcast("LEVEL_UPDATE", payload);
  }

  private async handleStatusMessage(data: unknown): Promise<void> {
    const parseResult = mqttStatusPayloadSchema.safeParse(data);
    if (!parseResult.success) {
      console.warn("[MQTT] Payload status tidak valid:", parseResult.error.format());
      return;
    }

    const payload = parseResult.data;

    // Update status node sensor di database
    await db
      .update(sensorNodes)
      .set({
        status: payload.status,
        lastSeen: new Date(payload.timestamp),
      })
      .where(eq(sensorNodes.deviceCode, payload.sensor_node_id));

    wsBroadcaster.broadcast("NODE_STATUS", payload);
  }

  private async handleHeartbeatMessage(data: unknown): Promise<void> {
    const parseResult = mqttHeartbeatPayloadSchema.safeParse(data);
    if (!parseResult.success) {
      return;
    }

    const payload = parseResult.data;

    if (payload.type === "gateway") {
      await db
        .update(gateways)
        .set({
          status: "online",
          lastHeartbeat: new Date(payload.timestamp),
        })
        .where(eq(gateways.deviceCode, payload.device_code));
    } else {
      await db
        .update(sensorNodes)
        .set({
          status: "active",
          lastSeen: new Date(payload.timestamp),
        })
        .where(eq(sensorNodes.deviceCode, payload.device_code));
    }
  }
}

export const mqttSubscriber = new MqttSubscriberService();

