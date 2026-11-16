import mqtt from "mqtt";
import { env } from "../config/env.js";

const client = mqtt.connect(env.MQTT_BROKER_URL);

interface SimTank {
  tank_id: string;
  sensor_node_id: string;
  name: string;
  level_percent: number;
  capacity_liters: number;
  trend: number; // -1 dropping, +1 filling
}

const mockTanks: SimTank[] = [
  {
    tank_id: "TANK-ATAP-UTAMA",
    sensor_node_id: "STM32-A01",
    name: "Tangki Atap Gedung Utama",
    level_percent: 78.5,
    capacity_liters: 10000,
    trend: -1,
  },
  {
    tank_id: "TANK-RAWAT-INAP",
    sensor_node_id: "STM32-B01",
    name: "Tangki Gedung Rawat Inap",
    level_percent: 42.0, // In WARNING zone
    capacity_liters: 8000,
    trend: -1,
  },
  {
    tank_id: "TANK-BEDAH",
    sensor_node_id: "STM32-C01",
    name: "Tangki Instalasi Bedah Sentral",
    level_percent: 88.0,
    capacity_liters: 5000,
    trend: 1,
  },
];

client.on("connect", () => {
  console.log("[Simulator] Terhubung ke broker MQTT. Mengirim data sensor simulasi...");

  let seq = 1;

  setInterval(() => {
    mockTanks.forEach((tank) => {
      // Simulasi fluktuasi level air
      tank.level_percent += (Math.random() * 2 - 0.9) * tank.trend;
      if (tank.level_percent > 95) {
        tank.level_percent = 95;
        tank.trend = -1;
      } else if (tank.level_percent < 20) {
        tank.level_percent = 20;
        tank.trend = 1;
      }

      // Konversi level persen simulasi ke distance_cm (asumsi rentang 30cm - 350cm)
      const distance_cm = parseFloat((350 - (tank.level_percent / 100) * (350 - 30)).toFixed(1));

      const payload = {
        tank_id: tank.tank_id,
        sensor_node_id: tank.sensor_node_id,
        distance_cm,
        rssi: Math.round(-65 - Math.random() * 15),
        sequence: seq++,
        timestamp: new Date().toISOString(),
      };

      const topic = `hospital/${tank.tank_id}/level`;
      client.publish(topic, JSON.stringify(payload), { qos: 0 });

      console.log(
        `[Simulator] Publish ${topic}: distance=${payload.distance_cm}cm, rssi=${payload.rssi}dBm`
      );
    });
  }, 3000);
});

client.on("error", (err) => {
  console.error("[Simulator] Error:", err.message);
});

