# Panduan Transisi Frontend: Migrasi Data Mock ke REST API dan Realtime WebSocket

Dokumen ini disusun khusus sebagai instruksi langkah demi langkah bagi agen pengembang (*AI coding agent*) yang bertugas menyambungkan antarmuka dan komponen UI frontend yang sudah ada ke backend Fastify dan Realtime WebSocket RSA UGM, menggantikan seluruh data tiruan (*dummy/mock*).

---

## 1. Konfigurasi Lingkungan (Environment Variables)

Komponen frontend harus menggunakan variabel lingkungan untuk mengarahkan koneksi ke host backend (Tailscale tunnel).

Buat atau perbarui berkas `.env.local` (atau `.env`) di proyek frontend:

```env
# Jika menggunakan Tailscale Funnel / domain HTTPS:
NEXT_PUBLIC_API_URL=https://<domain-tunnel-anda>
NEXT_PUBLIC_WS_URL=wss://<domain-tunnel-anda>/ws

# Atau jika menggunakan IP privat Tailscale / HTTP biasa:
# NEXT_PUBLIC_API_URL=http://100.94.192.102:8000
# NEXT_PUBLIC_WS_URL=ws://100.94.192.102:8000/ws
```

Helper inisialisasi URL di sisi frontend:
```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.VITE_API_URL || "http://100.94.192.102:8000";
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || process.env.VITE_WS_URL || "ws://100.94.192.102:8000/ws";
```

---

## 2. Otentikasi dan Token Interceptor

Hampir seluruh endpoint data backend dilindungi oleh autentikasi JWT Bearer. Jika frontend memanggil API tanpa token, server akan mengembalikan status `401 Unauthorized`.

### A. Alur Login Otomatis / Manual
Panggil endpoint otentikasi untuk mendapatkan token JWT:
* **Metode**: `POST`
* **Path**: `/api/auth/login`
* **Body Request**:
  ```json
  {
    "username": "admin",
    "password": "admin123"
  }
  ```
* **Respon Sukses**: Ambil string token dari `response.data.token`.
* **Penyimpanan**: Simpan di `localStorage.setItem("token", token)` atau `sessionStorage`.

### B. Helper Fetch Terpusat dengan Interceptor
Agen harus membungkus seluruh pemanggilan API menggunakan helper berikut agar token otomatis terpasang:

```typescript
export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const url = `${API_BASE_URL.replace(/\/$/, "")}${endpoint}`;
  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Tangani token kedaluwarsa: arahkan ke halaman login atau lakukan refresh token
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("app:unauthorized"));
    }
    throw new Error("Sesi berakhir. Silakan login kembali.");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    return (await response.text()) as unknown as T;
  }

  return response.json();
}
```

---

## 3. Matriks Transformasi Data (Mock Field vs Backend Field)

Saat mengganti data mock di komponen UI, perhatikan perbedaan nama properti antara data tiruan dengan skema riil dari basis data backend:

| Data Komponen | Field Umum di Mock Data | Field Riil dari Backend API | Tipe Data Riil | Keterangan Transformasi |
|---|---|---|---|---|
| ID Tangki | `id` / `tankId` | `tank.id` | UUID string | Format UUID v4 standar |
| Nama Tangki | `name` / `title` | `tank.name` | string | Contoh: "Tangki Atap Gedung Utama" |
| Lokasi Tangki | `location` | `tank.location` | string / null | Contoh: "Atap Gedung A, Lantai 5" |
| Kapasitas Tangki | `capacity` | `tank.capacityLiters` | string desimal | Gunakan `parseFloat(tank.capacityLiters)` |
| Ambang Batas Min | `minThreshold` | `tank.minThresholdPercent` | string desimal | Default "30.00", ubah ke `Number()` |
| Ambang Batas Max | `maxThreshold` | `tank.maxThresholdPercent` | string desimal | Default "90.00", ubah ke `Number()` |
| Koordinat Lintang | `lat` / `latitude` | `tank.latitude` | string / null | Contoh: "-7.7428450" (Gedung Utama) |
| Koordinat Bujur | `lng` / `longitude` | `tank.longitude` | string / null | Contoh: "110.3511200" |
| Level Air Saat Ini | `currentLevel` / `level` | `tank.latestReading.levelPercent` | string / number | Nilai persentase 0.00 sampai 100.00 |
| Volume Air Saat Ini | `currentVolume` / `volume`| `tank.latestReading.volumeLiters` | string / number | Nilai volume dalam liter |
| Waktu Pembacaan | `updatedAt` / `time` | `tank.latestReading.recordedAt` | string ISO UTC | Format waktu standar ISO 8601 |
| Status Peringatan | `status` / `alert` | `tank.activeAlert.level` | "CRITICAL" / "WARNING" / null | Null jika kondisi air normal |

---

## 4. Implementasi Penggantian Data per Komponen

### A. Komponen Daftar Tangki & Kartu Gauge Ketinggian Air
Gantikan array mock tangki statis dengan pemanggilan API:

* **Endpoint Awal**: `GET /api/tanks`
* **Implementasi di Komponen**:
  ```typescript
  // SEBELUM:
  // const [tanks, setTanks] = useState(MOCK_TANKS);

  // SESUDAH:
  const [tanks, setTanks] = useState<Tank[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadTanks() {
      try {
        setLoading(true);
        const res = await apiFetch<{ success: boolean; data: Tank[] }>("/api/tanks");
        if (res.success) {
          setTanks(res.data);
        }
      } catch (err) {
        console.error("Gagal memuat tangki:", err);
      } finally {
        setLoading(false);
      }
    }
    loadTanks();
  }, []);
  ```

---

### B. Implementasi Realtime WebSocket untuk Level Air Dinamis
Komponen gauge atau kartu tangki tidak boleh bergantung pada polling REST API berulang. Sambungkan socket ke `/ws` dan dengarkan event `LEVEL_UPDATE`:

* **Alamat WebSocket**: `ws://<host>:8000/ws?token=<token_jwt>` atau `wss://<host>/ws?token=<token_jwt>`
* **Keamanan & Otentikasi**: Endpoint WebSocket mewajibkan parameter `?token=<jwt>` yang diperoleh saat login via `/api/auth/login`. Jika token tidak ada atau tidak valid, koneksi akan ditutup otomatis dengan status code 1008.
* **Struktur Pesan Masuk**:
  ```json
  {
    "type": "LEVEL_UPDATE",
    "data": {
      "tank_id": "0d8e0439-184e-4f91-b307-eb3c847d16a1",
      "sensor_node_id": "b3e0c091-...",
      "level_percent": 76.5,
      "volume_liters": 7650.0,
      "raw_value": 118.2,
      "rssi": -65,
      "timestamp": "2026-10-29T07:35:02.120Z"
    },
    "timestamp": "2026-10-29T07:35:02.125Z"
  }
  ```
* **Logika Pembaruan State Komponen (Tanpa Me-reload Halaman)**:
  ```typescript
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    function connectSocket() {
      const token = localStorage.getItem("auth_token") || "";
      const wsUrl = `${WS_BASE_URL}${WS_BASE_URL.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WebSocket] Terhubung ke server realtime");
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // Update level tangki secara spesifik berdasarkan ID
          if (payload.type === "LEVEL_UPDATE" && payload.data?.tank_id) {
            const update = payload.data;
            setTanks((prevTanks) =>
              prevTanks.map((tank) => {
                if (tank.id !== update.tank_id) return tank;

                return {
                  ...tank,
                  latestReading: {
                    id: Date.now(),
                    tankId: update.tank_id,
                    sensorNodeId: update.sensor_node_id,
                    levelPercent: update.level_percent,
                    volumeLiters: update.volume_liters,
                    rawValue: update.raw_value,
                    rssi: update.rssi,
                    recordedAt: update.timestamp,
                  },
                };
              })
            );
          }
        } catch (e) {
          console.warn("Gagal parse payload socket:", e);
        }
      };

      ws.onclose = () => {
        console.warn("[WebSocket] Putus. Menghubungkan ulang dalam 3 detik...");
        reconnectTimeout = setTimeout(connectSocket, 3000);
      };
    }

    connectSocket();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, []);
  ```

---

### C. Komponen Grafik Riwayat Telemetri (Time-Series Chart)
Gantikan data array angka acak pada grafik dengan histori riil dari TimescaleDB:

* **Endpoint**: `GET /api/tanks/:id/readings?hours=24&limit=100`
* **Implementasi**:
  ```typescript
  async function loadChartData(tankId: string) {
    const res = await apiFetch<{
      success: boolean;
      data: Array<{
        id: number;
        levelPercent: string | number;
        volumeLiters: string | number;
        recordedAt: string;
      }>;
    }>(`/api/tanks/${tankId}/readings?hours=24&limit=100`);

    if (res.success) {
      // Format data untuk Chart.js, Recharts, atau ApexCharts
      // Urutkan data secara kronologis (dari waktu terlama ke terbaru)
      const sorted = [...res.data].sort(
        (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      );

      const labels = sorted.map((r) => {
        const d = new Date(r.recordedAt);
        return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      });

      const seriesLevel = sorted.map((r) => parseFloat(String(r.levelPercent)));
      const seriesVolume = sorted.map((r) => parseFloat(String(r.volumeLiters)));

      setChartState({ labels, seriesLevel, seriesVolume });
    }
  }
  ```

---

### D. Komponen Daftar Peringatan (Alerts Table & Banner)
Gantikan tabel peringatan mock dengan pemanggilan API dan websocket listener:

1. **Ambil Data Peringatan Awal**:
   * **Endpoint**: `GET /api/alerts?status=active` (atau tanpa filter untuk riwayat lengkap).
   ```typescript
   async function loadAlerts() {
     const res = await apiFetch<{ success: boolean; data: Alert[] }>("/api/alerts");
     if (res.success) setAlerts(res.data);
   }
   ```

2. **Dengarkan Peringatan Baru dari WebSocket**:
   Saat server mendeteksi air turun di bawah batas minimum, server mengirim event `ALERT_TRIGGERED`:
   ```typescript
   if (payload.type === "ALERT_TRIGGERED" && payload.data) {
     const newAlert = payload.data;
     setAlerts((prev) => [newAlert, ...prev]);
   }
   ```

3. **Eksekusi Selesaikan Peringatan (Tombol Resolve)**:
   * **Endpoint**: `PATCH /api/alerts/:id/resolve` (atau `PUT /api/alerts/:id/resolve`).
   ```typescript
   async function handleResolveAlert(alertId: number) {
     try {
       const res = await apiFetch<{ success: boolean; data: Alert }>(`/api/alerts/${alertId}/resolve`, {
         method: "PATCH",
       });
       if (res.success) {
         setAlerts((prev) =>
           prev.map((a) => (a.id === alertId ? { ...a, status: "resolved", resolvedAt: new Date().toISOString() } : a))
         );
       }
     } catch (err: any) {
       alert(`Gagal menyelesaikan peringatan: ${err.message}`);
     }
   }
   ```

---

### E. Komponen Peta Interaktif (Leaflet / Google Maps)
Jika UI memiliki komponen peta:

* Tangki Gedung Utama: `latitude: "-7.7428450"`, `longitude: "110.3511200"`
* Tangki Gedung Rawat Inap: `latitude: "-7.7431200"`, `longitude: "110.3515400"`

Gantikan koordinat statis pada pin peta dengan membaca properti `tank.latitude` dan `tank.longitude`:
```typescript
tanks.forEach((tank) => {
  if (tank.latitude && tank.longitude) {
    const lat = parseFloat(tank.latitude);
    const lng = parseFloat(tank.longitude);
    // Tambahkan marker ke peta
    addMarkerToMap([lat, lng], tank.name, tank.latestReading?.levelPercent);
  }
});
```

---

### F. Komponen Ekspor Laporan CSV
Gantikan tombol ekspor mock dengan pemanggilan unduhan file riil:

```typescript
async function handleExportReadings(tankId: string) {
  try {
    const csvData = await apiFetch<string>(`/api/reports/readings/export?tankId=${tankId}`);
    const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan_tangki_${tankId}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    alert(`Gagal mengunduh CSV: ${err.message}`);
  }
}
```

---

## 5. Checklist Verifikasi Akhir bagi Agen Pengembang

Sebelum menyelesaikan implementasi penggantian data mock, pastikan hal-hal berikut:

1. [ ] **Tidak Ada Data Statis Hardcoded**: Hapus seluruh objek dummy (`MOCK_DATA`, `dummyTanks`, data acak).
2. [ ] **Token Header Otomatis**: Pastikan header `Authorization: Bearer <token>` disertakan pada seluruh panggilan selain `/api/auth/login`.
3. [ ] **Realtime Socket Berjalan**: Pastikan persentase bar ketinggian air di UI bergerak saat payload `LEVEL_UPDATE` diterima dari socket.
4. [ ] **Auto-reconnect WebSocket Aktif**: Uji dengan mematikan koneksi sesaat; pastikan klien secara otomatis mencoba terhubung kembali setiap 3 detik.
5. [ ] **Normalisasi Nilai Visual**: Batasi lebar bar level antara 0% sampai 100% menggunakan `Math.min(100, Math.max(0, level))` agar antarmuka tidak rusak saat data berada di batas ekstrem.
6. [ ] **Bebas Karakter Emdash dan Emoji**: Kode dan tampilan antarmuka tidak boleh menggunakan emoji atau karakter emdash.
