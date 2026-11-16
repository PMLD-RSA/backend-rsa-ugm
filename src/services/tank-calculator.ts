import { eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { sensorNodes, tanks } from "../db/schema/index.js";

export interface TankCalibrationConfig {
  tankId: string;
  sensorNodeId: string;
  tankName: string;
  capacityLiters: number;
  minDistanceCm: number;
  maxDistanceCm: number;
  minThresholdPercent: number;
  maxThresholdPercent: number;
}

export interface CalculationResult {
  levelPercent: number;
  volumeLiters: number;
  distanceCm: number;
  isOutOfRange: boolean;
}

export class TankCalculatorService {
  private static configCache = new Map<string, { data: TankCalibrationConfig; expiresAt: number }>();
  private static CACHE_TTL_MS = 30000;

  public static calculate(distanceCm: number, config: TankCalibrationConfig): CalculationResult {
    const minDist = Math.max(0, config.minDistanceCm);
    const maxDist = Math.max(minDist + 1, config.maxDistanceCm);
    const effectiveHeight = maxDist - minDist;

    const isOutOfRange = distanceCm < minDist || distanceCm > maxDist;
    const rawPercent = ((maxDist - distanceCm) / effectiveHeight) * 100;
    const clampedPercent = Math.max(0, Math.min(100, rawPercent));

    const levelPercent = Number(clampedPercent.toFixed(2));
    const volumeLiters = Number(((levelPercent / 100) * config.capacityLiters).toFixed(2));

    return {
      levelPercent,
      volumeLiters,
      distanceCm,
      isOutOfRange,
    };
  }

  public static async getTankConfigForNode(nodeIdentifier: string): Promise<TankCalibrationConfig | null> {
    const cached = this.configCache.get(nodeIdentifier);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const [record] = await db
      .select({
        sensorNodeId: sensorNodes.id,
        tankId: tanks.id,
        tankName: tanks.name,
        capacityLiters: tanks.capacityLiters,
        minDistanceCm: tanks.minDistanceCm,
        maxDistanceCm: tanks.maxDistanceCm,
        minThresholdPercent: tanks.minThresholdPercent,
        maxThresholdPercent: tanks.maxThresholdPercent,
      })
      .from(sensorNodes)
      .innerJoin(tanks, eq(sensorNodes.tankId, tanks.id))
      .where(or(eq(sensorNodes.id, nodeIdentifier), eq(sensorNodes.deviceCode, nodeIdentifier)))
      .limit(1);

    if (!record) {
      return null;
    }

    const config: TankCalibrationConfig = {
      tankId: record.tankId,
      sensorNodeId: record.sensorNodeId,
      tankName: record.tankName,
      capacityLiters: parseFloat(record.capacityLiters),
      minDistanceCm: parseFloat(record.minDistanceCm),
      maxDistanceCm: parseFloat(record.maxDistanceCm),
      minThresholdPercent: parseFloat(record.minThresholdPercent),
      maxThresholdPercent: parseFloat(record.maxThresholdPercent),
    };

    this.configCache.set(nodeIdentifier, {
      data: config,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    if (config.sensorNodeId !== nodeIdentifier) {
      this.configCache.set(config.sensorNodeId, {
        data: config,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
    }

    return config;
  }

  public static clearCache(): void {
    this.configCache.clear();
  }
}
