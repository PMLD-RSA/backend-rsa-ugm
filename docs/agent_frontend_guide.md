# Petunjuk Integrasi Frontend dan Agen: REST API dan Realtime WebSocket

Dokumen ini disusun sebagai spesifikasi teknis dan panduan implementasi komprehensif bagi agen pengembang (AI coding agent) dan teknisi frontend untuk membangun antarmuka web sistem monitoring tangki air rumah sakit (RSA UGM).

---

## 1. Arsitektur Jaringan, URL, dan Protokol

Backend Fastify berjalan di port 8000 dan dapat diakses melalui jaringan lokal, IP privat Tailscale, maupun Tailscale Funnel / Reverse Proxy publik.

### A. Format URL
* **Akses HTTP Biasa**:
  * Base REST API: `http://<tailscale-ip-atau-host>:8000`
  * WebSocket: `ws://<tailscale-ip-atau-host>:8000/ws`
* **Akses HTTPS (Funnel / Domain SSL)**:
  * Base REST API: `https://<domain-tunnel-anda>`
  * WebSocket: `wss://<domain-tunnel-anda>/ws`

### B. Otomatisasi Deteksi Protokol
Agen frontend wajib mendeteksi protokol peramban saat inisialisasi agar koneksi WebSocket tidak ditolak oleh kebijakan keamanan peramban (*mixed content*):

```typescript
export function getNetworkConfig(customHost?: string) {
  const isBrowser = typeof window !== "undefined";
  const host = customHost || (isBrowser ? window.location.host : "localhost:8000");
  const isHttps = isBrowser && window.location.protocol === "https:";

  return {
    httpBaseUrl: `${isHttps ? "https:" : "http:"}//${host}`,
    wsBaseUrl: `${isHttps ? "wss:" : "ws:"}//${host}/ws`,
  };
}
```

---

## 2. Definisi Kontrak Data TypeScript (Data Contracts)

Agen wajib menyematkan antarmuka tipe data berikut pada proyek frontend:

```typescript
// ==========================================
// 1. DATA ENTITY INTERFACES
// ==========================================

export interface User {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  isActive: boolean;
  createdAt?: string;
}

export interface Tank {
  id: string; // UUID v4
  name: string;
  location: string | null;
  capacityLiters: string; // Representasi string numerik desimal
  minThresholdPercent: string; // Default "30.00"
  maxThresholdPercent: string; // Default "90.00"
  latitude: string | null; // Koordinat lintang GPS (contoh: "-7.7428450")
  longitude: string | null; // Koordinat bujur GPS (contoh: "110.3511200")
  createdAt: string;
  updatedAt: string;
  latestReading?: WaterLevelReading | null;
  activeAlert?: Alert | null;
  nodes?: SensorNode[];
}

export interface WaterLevelReading {
  id: number;
  tankId: string;
  sensorNodeId: string | null;
  levelPercent: string | number; // 0.00 sampai 100.00
  volumeLiters: string | number;
  rawValue?: string | number | null;
  rssi?: number | null;
  recordedAt: string; // Format ISO 8601 UTC
}

export interface Alert {
  id: number;
  tankId: string;
  tankName?: string;
  tankLocation?: string | null;
  level: "WARNING" | "CRITICAL";
  message: string;
  status: "active" | "resolved";
  createdAt: string;
  resolvedAt?: string | null;
}

export interface Gateway {
  id: string;
  deviceCode: string; // Contoh: "GW-HUB-01"
  status: "online" | "offline";
  lastHeartbeat: string | null;
  createdAt: string;
  nodesCount?: number;
  nodes?: SensorNode[];
}

export interface SensorNode {
  id: string;
  tankId: string | null;
  tankName?: string | null;
  gatewayId: string | null;
  gatewayCode?: string | null;
  deviceCode: string; // Contoh: "STM32-ATA", "STM32-GED"
  sensorType: string; // "ultrasonic"
  status: "active" | "inactive" | "offline";
  lastRssi: number | null;
  lastSeen: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  userId: string | null;
  user?: { username: string };
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface HealthStatus {
  status: "healthy" | "unhealthy";
  services: {
    database: "up" | "down";
    redis: "up" | "down";
  };
  websocketClients: number;
  timestamp: string;
}

// ==========================================
// 2. WEBSOCKET EVENT INTERFACES
// ==========================================

export type WebSocketEventType =
  | "CONNECTED"
  | "LEVEL_UPDATE"
  | "ALERT_TRIGGERED"
  | "ALERT_RESOLVED"
  | "NODE_STATUS";

export interface WebSocketEvent<T = any> {
  type: WebSocketEventType;
  data?: T;
  message?: string;
  timestamp: string;
}

export interface LevelUpdatePayload {
  tank_id: string;
  sensor_node_id: string;
  level_percent: number;
  volume_liters: number;
  raw_value?: number;
  rssi?: number;
  timestamp: string;
}

export interface AlertTriggeredPayload {
  tankId: string;
  level: "WARNING" | "CRITICAL";
  message: string;
}
```

---

## 3. Implementasi Klien REST API Lengkap

Modul berikut mengimplementasikan 100% rute API backend secara modular, tipe-aman, dan menangani otentikasi Bearer JWT secara otomatis.

Simpan file ini di: `src/services/api.service.ts`

```typescript
import {
  User,
  Tank,
  WaterLevelReading,
  Alert,
  Gateway,
  SensorNode,
  AuditLog,
  HealthStatus,
} from "./types";

export class ApiService {
  private baseUrl: string;
  private token: string = "";

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  public setToken(token: string) {
    this.token = token;
  }

  public getToken(): string {
    return this.token;
  }

  // Wrapper umum fetch dengan otentikasi & penanganan error
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (this.token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:unauthorized"));
      }
      throw new Error("Sesi login berakhir atau token tidak sah.");
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const msg = errorBody?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(msg);
    }

    // Jika response bertipe file/text (seperti CSV)
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/csv") || contentType.includes("application/octet-stream")) {
      return (await response.text()) as unknown as T;
    }

    return await response.json();
  }

  // ==========================================
  // 1. SISTEM & KESEHATAN
  // ==========================================
  public async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>("/health");
  }

  // ==========================================
  // 2. OTENTIKASI & PENGGUNA
  // ==========================================
  public async login(credentials: { username: string; password: string }) {
    const res = await this.request<{
      success: boolean;
      data: { token: string; user: User };
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    if (res.data?.token) {
      this.setToken(res.data.token);
    }
    return res.data;
  }

  public async getMe(): Promise<{ success: boolean; data: User }> {
    return this.request("/api/auth/me");
  }

  public async getUsers(): Promise<{ success: boolean; count: number; data: User[] }> {
    return this.request("/api/users");
  }

  public async createUser(data: { username: string; password: string; role: "admin" | "operator" | "viewer" }) {
    return this.request<{ success: boolean; data: User }>("/api/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async updateUser(id: string, data: Partial<{ password: string; role: string; isActive: boolean }>) {
    return this.request<{ success: boolean; data: User }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  public async deleteUser(id: string) {
    return this.request<{ success: boolean; message: string }>(`/api/users/${id}`, {
      method: "DELETE",
    });
  }

  // ==========================================
  // 3. TANGKI AIR (TANKS)
  // ==========================================
  public async getTanks(): Promise<{ success: boolean; count: number; data: Tank[] }> {
    return this.request("/api/tanks");
  }

  public async getTankById(id: string): Promise<{ success: boolean; data: Tank & { recentReadings: WaterLevelReading[]; recentAlerts: Alert[] } }> {
    return this.request(`/api/tanks/${id}`);
  }

  public async getTankReadings(id: string, params?: { hours?: number; limit?: number }): Promise<{ success: boolean; count: number; data: WaterLevelReading[] }> {
    const query = new URLSearchParams();
    if (params?.hours) query.set("hours", String(params.hours));
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/api/tanks/${id}/readings${qs}`);
  }

  public async createTank(data: {
    name: string;
    location?: string;
    capacityLiters: number;
    minThresholdPercent?: number;
    maxThresholdPercent?: number;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    return this.request<{ success: boolean; data: Tank }>("/api/tanks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  public async updateTank(id: string, data: Partial<{
    name: string;
    location: string;
    capacityLiters: number;
    minThresholdPercent: number;
    maxThresholdPercent: number;
    latitude: number | null;
    longitude: number | null;
  }>) {
    return this.request<{ success: boolean; data: Tank }>(`/api/tanks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  public async deleteTank(id: string) {
    return this.request<{ success: boolean; message: string }>(`/api/tanks/${id}`, {
      method: "DELETE",
    });
  }

  // ==========================================
  // 4. PEMBACAAN LEVEL AIR (READINGS)
  // ==========================================
  public async getLatestReadings(): Promise<{ success: boolean; data: Array<{ tankId: string; tankName: string; reading: WaterLevelReading | null }> }> {
    return this.request("/api/readings/latest");
  }

  public async getReadingsHistory(params?: { hours?: number }): Promise<{ success: boolean; data: WaterLevelReading[] }> {
    const query = new URLSearchParams();
    if (params?.hours) query.set("hours", String(params.hours));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/api/readings/history${qs}`);
  }

  // ==========================================
  // 5. PERINGATAN (ALERTS)
  // ==========================================
  public async getAlerts(params?: { status?: "active" | "resolved" }): Promise<{ success: boolean; count: number; data: Alert[] }> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/api/alerts${qs}`);
  }

  public async resolveAlert(id: number): Promise<{ success: boolean; data: Alert }> {
    return this.request(`/api/alerts/${id}/resolve`, {
      method: "PATCH",
    });
  }

  // ==========================================
  // 6. PERANGKAT (GATEWAYS & NODES)
  // ==========================================
  public async getGateways(): Promise<{ success: boolean; data: Gateway[] }> {
    return this.request("/api/gateways");
  }

  public async syncGateway(deviceCode: string, gatewayKey: string): Promise<{ success: boolean; gatewayCode: string; mappings: any[] }> {
    return this.request(`/api/gateways/${encodeURIComponent(deviceCode)}/sync`, {
      headers: { "X-Gateway-Key": gatewayKey },
    });
  }

  public async getNodes(): Promise<{ success: boolean; count: number; data: SensorNode[] }> {
    return this.request("/api/nodes");
  }

  // ==========================================
  // 7. AUDIT LOGS
  // ==========================================
  public async getAuditLogs(params?: { page?: number; limit?: number; entity?: string }): Promise<{
    success: boolean;
    page: number;
    limit: number;
    total: number;
    data: AuditLog[];
  }> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.entity) query.set("entity", params.entity);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request(`/api/audit-logs${qs}`);
  }

  // ==========================================
  // 8. EKSPOR LAPORAN CSV
  // ==========================================
  public async downloadReadingsCsv(tankId: string, startDate?: string, endDate?: string): Promise<string> {
    const query = new URLSearchParams({ tankId });
    if (startDate) query.set("startDate", startDate);
    if (endDate) query.set("endDate", endDate);
    return this.request<string>(`/api/reports/readings/export?${query.toString()}`);
  }

  public async downloadAlertsCsv(level?: string, startDate?: string, endDate?: string): Promise<string> {
    const query = new URLSearchParams();
    if (level) query.set("level", level);
    if (startDate) query.set("startDate", startDate);
    if (endDate) query.set("endDate", endDate);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request<string>(`/api/reports/alerts/export${qs}`);
  }
}
```

---

## 4. Implementasi Realtime WebSocket Tingkat Produksi

Koneksi melalui Tailscale tunnel dapat mengalami jeda atau terputus secara periodik. Modul ini menjamin koneksi selalu pulih (*auto-reconnect*) dengan strategi backoff, mendeteksi hilangnya koneksi, dan mendistribusikan data secara terstruktur.

Simpan file ini di: `src/services/websocket.service.ts`

```typescript
import { WebSocketEvent, LevelUpdatePayload, AlertTriggeredPayload } from "./types";

export type WebSocketConnectionStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED";

export interface WebSocketCallbacks {
  onLevelUpdate?: (data: LevelUpdatePayload) => void;
  onAlertTriggered?: (data: AlertTriggeredPayload) => void;
  onAlertResolved?: (data: any) => void;
  onStatusChange?: (status: WebSocketConnectionStatus) => void;
  onRawMessage?: (event: WebSocketEvent) => void;
}

export class MonitoringWebSocketService {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private callbacks: WebSocketCallbacks = {};
  private isExplicitlyClosed: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: any = null;
  private readonly maxReconnectIntervalMs = 10000;
  private readonly baseReconnectIntervalMs = 2000;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  public connect(callbacks: WebSocketCallbacks): void {
    this.callbacks = callbacks;
    this.isExplicitlyClosed = false;
    this.initSocket();
  }

  private initSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.callbacks.onStatusChange?.("CONNECTING");

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange?.("CONNECTED");
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const payload: WebSocketEvent = JSON.parse(event.data);
          this.callbacks.onRawMessage?.(payload);

          switch (payload.type) {
            case "LEVEL_UPDATE":
              if (payload.data) this.callbacks.onLevelUpdate?.(payload.data);
              break;
            case "ALERT_TRIGGERED":
              if (payload.data) this.callbacks.onAlertTriggered?.(payload.data);
              break;
            case "ALERT_RESOLVED":
              if (payload.data) this.callbacks.onAlertResolved?.(payload.data);
              break;
            default:
              break;
          }
        } catch (err) {
          console.warn("[WS] Pesan bukan JSON valid:", event.data);
        }
      };

      this.ws.onclose = () => {
        this.callbacks.onStatusChange?.("DISCONNECTED");
        if (!this.isExplicitlyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WS] Terjadi kesalahan socket:", error);
      };
    } catch (err) {
      this.callbacks.onStatusChange?.("DISCONNECTED");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isExplicitlyClosed) return;

    // Exponential backoff dengan batas maksimal
    const delay = Math.min(
      this.baseReconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts),
      this.maxReconnectIntervalMs
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.initSocket();
    }, delay);
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onStatusChange?.("DISCONNECTED");
  }
}
```

---

## 5. Pola Integrasi State Frontend (Zustand / Context)

Agen frontend disarankan mengelola state terpusat menggunakan pola Store berikut:

```typescript
// src/store/useMonitoringStore.ts
import { Tank, Alert, WebSocketConnectionStatus, LevelUpdatePayload } from "../services/types";
import { ApiService } from "../services/api.service";
import { MonitoringWebSocketService } from "../services/websocket.service";

export interface MonitoringState {
  tanks: Record<string, Tank>;
  alerts: Alert[];
  wsStatus: WebSocketConnectionStatus;
  isLoading: boolean;
  error: string | null;

  // Actions
  init: (api: ApiService, ws: MonitoringWebSocketService) => Promise<void>;
  updateTankLevel: (data: LevelUpdatePayload) => void;
  resolveAlert: (api: ApiService, alertId: number) => Promise<void>;
  cleanup: (ws: MonitoringWebSocketService) => void;
}

// Logika sinkronisasi state
export function createMonitoringStoreLogic() {
  return {
    handleIncomingLevel(tanks: Record<string, Tank>, payload: LevelUpdatePayload): Record<string, Tank> {
      const existing = tanks[payload.tank_id];
      if (!existing) return tanks;

      return {
        ...tanks,
        [payload.tank_id]: {
          ...existing,
          latestReading: {
            id: Date.now(),
            tankId: payload.tank_id,
            sensorNodeId: payload.sensor_node_id,
            levelPercent: payload.level_percent,
            volumeLiters: payload.volume_liters,
            rawValue: payload.raw_value,
            rssi: payload.rssi,
            recordedAt: payload.timestamp,
          },
        },
      };
    },
  };
}
```

---

## 6. Contoh Implementasi Komponen Visual Utama

### A. Komponen Gauge Visual Ketinggian Tangki (TankGaugeCard)

Komponen ini menampilkan progress bar ketinggian air, volume liter, batas min/max, dan koordinat GPS:

```tsx
import React from "react";
import { Tank } from "../services/types";

interface TankGaugeCardProps {
  tank: Tank;
}

export function TankGaugeCard({ tank }: TankGaugeCardProps) {
  const latest = tank.latestReading;
  const levelPercent = latest ? Number(latest.levelPercent) : 0;
  const volumeLiters = latest ? Number(latest.volumeLiters) : 0;
  const minThreshold = Number(tank.minThresholdPercent) || 30;
  const maxThreshold = Number(tank.maxThresholdPercent) || 90;

  // Status ambang batas
  let statusText = "NORMAL";
  let statusColor = "#166534"; // Hijau netral/gelap

  if (levelPercent < minThreshold) {
    statusText = "CRITICAL (RENDAH)";
    statusColor = "#991b1b"; // Merah netral
  } else if (levelPercent <= 60) {
    statusText = "WASPADA";
    statusColor = "#b45309"; // Amber netral
  } else if (levelPercent > maxThreshold) {
    statusText = "CRITICAL (PENUH)";
    statusColor = "#991b1b";
  }

  // Batasi lebar visual antara 0% dan 100%
  const clampedWidth = Math.min(100, Math.max(0, levelPercent));

  return (
    <div style={{
      border: "1px solid #334155",
      borderRadius: "8px",
      backgroundColor: "#1e293b",
      color: "#f8fafc",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", margin: 0 }}>{tank.name}</h3>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0 0" }}>{tank.location || "Lokasi Rumah Sakit"}</p>
        </div>
        <span style={{
          fontSize: "11px",
          fontWeight: "bold",
          padding: "3px 8px",
          borderRadius: "4px",
          backgroundColor: statusColor,
          color: "#ffffff"
        }}>
          {statusText}
        </span>
      </div>

      {/* Progress Bar Track */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
          <span>Ketinggian Air</span>
          <span style={{ fontWeight: "bold" }}>{levelPercent.toFixed(1)}%</span>
        </div>
        <div style={{
          width: "100%",
          height: "22px",
          backgroundColor: "#0f172a",
          borderRadius: "4px",
          position: "relative",
          overflow: "hidden",
          border: "1px solid #475569"
        }}>
          {/* Garis Batas Ambang Min dan Max */}
          <div style={{ position: "absolute", left: `${minThreshold}%`, top: 0, bottom: 0, width: "2px", backgroundColor: "#f59e0b", zIndex: 2 }} title={`Batas Min: ${minThreshold}%`} />
          <div style={{ position: "absolute", left: `${maxThreshold}%`, top: 0, bottom: 0, width: "2px", backgroundColor: "#ef4444", zIndex: 2 }} title={`Batas Max: ${maxThreshold}%`} />

          {/* Bar Isi */}
          <div style={{
            height: "100%",
            width: `${clampedWidth}%`,
            backgroundColor: "#64748b",
            transition: "width 0.4s ease-in-out"
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
          <span>Min: {minThreshold}%</span>
          <span>Volume: {volumeLiters.toLocaleString("id-ID")} L</span>
          <span>Max: {maxThreshold}%</span>
        </div>
      </div>

      {/* Koordinat Peta & Kapasitas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", paddingTop: "8px", borderTop: "1px solid #334155", fontSize: "11px" }}>
        <div>
          <span style={{ color: "#94a3b8" }}>Kapasitas Maksimal:</span>
          <div style={{ fontWeight: "bold" }}>{Number(tank.capacityLiters).toLocaleString("id-ID")} L</div>
        </div>
        <div>
          <span style={{ color: "#94a3b8" }}>Koordinat GPS:</span>
          <div style={{ fontWeight: "bold" }}>
            {tank.latitude && tank.longitude ? `${tank.latitude}, ${tank.longitude}` : "Belum diatur"}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### B. Komponen Ekspor Laporan CSV (CsvExportButtons)

Menangani unduhan CSV secara aman tanpa memicu popup blocker peramban:

```tsx
import React, { useState } from "react";
import { ApiService } from "../services/api.service";

interface CsvExportButtonsProps {
  api: ApiService;
  tankId?: string;
}

export function CsvExportButtons({ api, tankId }: CsvExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleDownload = async (type: "readings" | "alerts") => {
    setIsExporting(true);
    try {
      let csvContent = "";
      let filename = "";

      if (type === "readings" && tankId) {
        csvContent = await api.downloadReadingsCsv(tankId);
        filename = `readings_${tankId}_${new Date().toISOString().slice(0, 10)}.csv`;
      } else {
        csvContent = await api.downloadAlertsCsv();
        filename = `alerts_${new Date().toISOString().slice(0, 10)}.csv`;
      }

      // Buat Blob dan trigger download otomatis
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Gagal mengekspor laporan: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: "10px" }}>
      {tankId && (
        <button
          onClick={() => handleDownload("readings")}
          disabled={isExporting}
          style={{ padding: "8px 14px", backgroundColor: "#334155", color: "#ffffff", border: "none", borderRadius: "4px", cursor: "pointer" }}
        >
          {isExporting ? "Mengunduh..." : "Ekspor Pembacaan CSV"}
        </button>
      )}
      <button
        onClick={() => handleDownload("alerts")}
        disabled={isExporting}
        style={{ padding: "8px 14px", backgroundColor: "#334155", color: "#ffffff", border: "none", borderRadius: "4px", cursor: "pointer" }}
      >
        {isExporting ? "Mengunduh..." : "Ekspor Riwayat Peringatan CSV"}
      </button>
    </div>
  );
}
```

---

## 7. Aturan Perilaku dan Checklist untuk Agen Frontend

Saat mengimplementasikan kode di antarmuka frontend, agen harus memenuhi checklist berikut:

* [ ] **Tanpa Emoji**: Dilarang menggunakan emoji Unicode dalam bentuk apa pun. Gunakan status teks seperti `[ONLINE]`, `[NORMAL]`, `[CRITICAL]`, atau ikon SVG netral.
* [ ] **Tanpa Emdash**: Hindari karakter emdash. Gunakan tanda minus biasa (-) atau titik dua (:).
* [ ] **Skema Warna Netral**: Gunakan palet slate/zinc/gray netral (`#0f172a`, `#1e293b`, `#334155`, `#94a3b8`). Dilarang menggunakan warna neon blue atau cyan menyala.
* [ ] **Auto Reconnect WebSocket**: Harus memiliki loop rekoneksi otomatis dengan batas backoff maksimal saat tunnel terputus.
* [ ] **Fallback Data**: Jika data WebSocket belum masuk, tampilkan data `latestReading` yang didapat dari REST API `GET /api/tanks`.
* [ ] **Penanganan 401 Unauthorized**: Tangkap status 401 pada request HTTP dan arahkan pengguna ke form login secara elegan.
* [ ] **Pemberian Titik Koordinat Peta**: Render lokasi tangki pada peta Leaflet atau Google Maps menggunakan field `latitude` dan `longitude` yang disediakan oleh objek `Tank`.
