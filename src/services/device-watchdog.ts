import { eq, and, lt, ne, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { gateways, sensorNodes } from "../db/schema/index.js";
import { wsBroadcaster } from "./ws-broadcaster.js";

export interface WatchdogConfig {
  checkIntervalMs?: number;
  gatewayTimeoutMs?: number;
  sensorTimeoutMs?: number;
}

export class DeviceWatchdogService {
  public static readonly DEFAULT_CHECK_INTERVAL_MS = 30 * 1000; // 30 detik
  public static readonly DEFAULT_GATEWAY_TIMEOUT_MS = 2 * 60 * 1000; // 2 menit
  public static readonly DEFAULT_SENSOR_TIMEOUT_MS = 3 * 60 * 1000; // 3 menit

  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;

  public readonly gatewayTimeoutMs: number;
  public readonly sensorTimeoutMs: number;
  public readonly checkIntervalMs: number;

  constructor(config?: WatchdogConfig) {
    this.checkIntervalMs = config?.checkIntervalMs ?? DeviceWatchdogService.DEFAULT_CHECK_INTERVAL_MS;
    this.gatewayTimeoutMs = config?.gatewayTimeoutMs ?? DeviceWatchdogService.DEFAULT_GATEWAY_TIMEOUT_MS;
    this.sensorTimeoutMs = config?.sensorTimeoutMs ?? DeviceWatchdogService.DEFAULT_SENSOR_TIMEOUT_MS;
  }

  /**
   * Helper murni untuk mengevaluasi apakah suatu perangkat sudah kadaluarsa (timeout)
   */
  public static isDeviceStale(
    lastActivity: Date | null,
    createdAt: Date,
    timeoutMs: number,
    now: Date = new Date()
  ): boolean {
    const referenceTime = lastActivity ? lastActivity.getTime() : createdAt.getTime();
    return now.getTime() - referenceTime > timeoutMs;
  }

  /**
   * Mulai timer berkala pengawas kesehatan perangkat
   */
  public start(): void {
    if (this.timer) {
      console.warn("[Watchdog] Service sudah berjalan.");
      return;
    }

    console.log(
      `[Watchdog] Memulai Device Watchdog Service (interval: ${this.checkIntervalMs / 1000}s, gw timeout: ${
        this.gatewayTimeoutMs / 1000
      }s, node timeout: ${this.sensorTimeoutMs / 1000}s)`
    );

    this.timer = setInterval(async () => {
      await this.checkDevices();
    }, this.checkIntervalMs);
  }

  /**
   * Hentikan timer pengawas kesehatan perangkat
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[Watchdog] Device Watchdog Service dihentikan.");
    }
  }

  /**
   * Eksekusi satu kali pemeriksaan timeout untuk seluruh gateway dan sensor node
   */
  public async checkDevices(now: Date = new Date()): Promise<{
    offlineGateways: string[];
    offlineNodes: string[];
  }> {
    if (this.isChecking) {
      return { offlineGateways: [], offlineNodes: [] };
    }

    this.isChecking = true;
    const result: { offlineGateways: string[]; offlineNodes: string[] } = {
      offlineGateways: [],
      offlineNodes: [],
    };

    try {
      const cutoffGateway = new Date(now.getTime() - this.gatewayTimeoutMs);
      const cutoffSensor = new Date(now.getTime() - this.sensorTimeoutMs);

      // 1. Cek Gateway yang tidak lagi mengirim heartbeat
      const staleGateways = await db
        .update(gateways)
        .set({ status: "offline" })
        .where(
          and(
            ne(gateways.status, "offline"),
            or(
              lt(gateways.lastHeartbeat, cutoffGateway),
              and(isNull(gateways.lastHeartbeat), lt(gateways.createdAt, cutoffGateway))
            )
          )
        )
        .returning();

      for (const gw of staleGateways) {
        console.warn(
          `[Watchdog] Gateway '${gw.deviceCode}' offline (terakhir heartbeat: ${
            gw.lastHeartbeat ? gw.lastHeartbeat.toISOString() : "belum pernah"
          })`
        );
        result.offlineGateways.push(gw.deviceCode);

        // Siarkan pembaruan status ke frontend
        wsBroadcaster.broadcast("GATEWAY_STATUS", {
          gateway_id: gw.id,
          device_code: gw.deviceCode,
          status: "offline",
          last_heartbeat: gw.lastHeartbeat ? gw.lastHeartbeat.toISOString() : null,
          timestamp: now.toISOString(),
        });
      }

      // 2. Cek Sensor Node yang tidak lagi mengirim telemetri/status/heartbeat
      const staleNodes = await db
        .update(sensorNodes)
        .set({ status: "offline" })
        .where(
          and(
            ne(sensorNodes.status, "offline"),
            or(
              lt(sensorNodes.lastSeen, cutoffSensor),
              and(isNull(sensorNodes.lastSeen), lt(sensorNodes.createdAt, cutoffSensor))
            )
          )
        )
        .returning();

      for (const node of staleNodes) {
        console.warn(
          `[Watchdog] Sensor Node '${node.deviceCode}' offline (terakhir terlihat: ${
            node.lastSeen ? node.lastSeen.toISOString() : "belum pernah"
          })`
        );
        result.offlineNodes.push(node.deviceCode);

        // Siarkan pembaruan status ke frontend
        wsBroadcaster.broadcast("NODE_STATUS", {
          sensor_node_id: node.id,
          device_code: node.deviceCode,
          status: "offline",
          last_seen: node.lastSeen ? node.lastSeen.toISOString() : null,
          timestamp: now.toISOString(),
        });
      }
    } catch (error) {
      console.error("[Watchdog] Gagal menjalankan pemeriksaan status perangkat:", error);
    } finally {
      this.isChecking = false;
    }

    return result;
  }
}

export const deviceWatchdog = new DeviceWatchdogService();
