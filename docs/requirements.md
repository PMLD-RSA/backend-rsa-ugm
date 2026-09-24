# Backend, Database & Monitoring/Warning Engine
### Integrated Hospital Water Tank Monitoring Research Project (RSA UGM)

> Dokumen ini adalah spesifikasi kebutuhan sistem backend. Arsitektur perangkat keras yang menjadi acuan: setiap tangki menggunakan **STM32**, data dikirim via **LoRa** ke satu unit **Raspberry Pi** yang berperan sebagai gateway/hub pusat, baru diteruskan ke backend via MQTT.
> 
> **Status Scope:** Sistem ini berfokus murni sebagai **Monitoring & Early Warning System** (membaca level air, menyimpan histori time-series, dan mengeluarkan peringatan WARNING/CRITICAL jika terjadi anomali level air). Jalur otomasi aktuator/kontrol pompa telah ditiadakan.

---

## 1. Ringkasan Proyek

Sistem ini memantau level air pada beberapa tangki di rumah sakit (atap gedung utama, rawat inap, instalasi bedah, laboratorium, laundry, dst) secara terpusat, mendeteksi kondisi kritis, dan memberi peringatan (warning/critical) ke operator melalui dashboard web dan mobile.

Backend bertanggung jawab pada **inti pemrosesan data**: menerima data dari gateway (via MQTT), melakukan buffering pesan (mencegah lonjakan data), menyimpannya secara terstruktur di database PostgreSQL/TimescaleDB, mencatat histori & audit, mendeteksi kondisi peringatan melalui Warning Engine, serta menyediakan REST API dan WebSocket untuk dikonsumsi oleh dashboard frontend (web Next.js & mobile React Native).

**Alur perangkat fisik:**

```
[STM32 @ Tangki A] ─┐
[STM32 @ Tangki B] ─┤  LoRa   ┌────────────────┐   MQTT   ┌────────────┐
[STM32 @ Tangki C] ─┼────────▶│ Raspberry Pi   │─────────▶│            │
[STM32 @ Tangki D] ─┤         │ (1 unit, hub)  │          │  Backend   │
[STM32 @ Tangki N] ─┘         └────────────────┘          └────────────┘
                                                                 │
                                                        PostgreSQL/Timescale
                                                                 │
                                                        API + WebSocket
                                                                 │
                                                     Next.js (web) / React Native (mobile)
```

---

## 2. Kebutuhan Sistem (Requirements)

### Functional
- Menerima data level air per tangki secara berkala dari gateway via MQTT.
- Menyimpan data mentah (raw) dan data hasil olahan (level %, volume liter) beserta timestamp.
- **Warning Engine**: Mendeteksi kondisi WARNING (30–60%) dan CRITICAL (<30%), lalu secara otomatis membuat atau menutup (resolve) entri alert.
- Mencatat **audit log** untuk aksi pengguna di sistem (login, perubahan konfigurasi threshold tangki, dsb).
- Menyediakan **REST API** untuk query data tangki, riwayat histori pembacaan (grafik 24 jam dengan agregasi), daftar alert aktif/histori, dan data gateway.
- Menyediakan **realtime channel** (WebSocket) untuk mendorong pembaruan level air dan notifikasi alert baru secara instan ke dashboard.
- Mendeteksi status koneksi node/gateway (online/offline) berdasarkan interval heartbeat dan pesan last seen.

### Non-Functional
- **Latency rendah**: Dari data masuk MQTT sampai terkirim ke API/WebSocket (target sub-detik s/d beberapa detik).
- **High throughput & buffering**: Tahan terhadap lonjakan pesan ketika banyak tangki mengirim data bersamaan dengan menggunakan Redis Streams sebagai buffer sebelum batch insert ke DB.
- **Penyimpanan time-series efisien**: Menggunakan PostgreSQL dengan ekstensi TimescaleDB (hypertable) agar query rentang waktu dan agregasi grafik 24 jam tetap cepat.
- **Reliable & resilient**: Penanganan diskoneksi MQTT dengan auto-reconnect.
- **Auditable**: Seluruh aktivitas administratif dan perubahan konfigurasi tercatat rapi dalam audit log.

---

## 3. Tech Stack

| Layer | Pilihan | Alasan Singkat |
|---|---|---|
| Runtime | **Node.js (LTS, v22+) & TypeScript** | Ekosistem MQTT & PostgreSQL matang, type-safety tinggi |
| Web Framework (API) | **Fastify** | Cepat, schema validation terintegrasi, plugin WebSocket resmi |
| MQTT Client | `mqtt` (npm) | Standar industri, stabil, mendukung QoS & auto-reconnect |
| Realtime ke FE | **WebSocket** (`@fastify/websocket`) | Push update level & alert langsung ke Next.js & React Native |
| Database | **PostgreSQL** | Database relasional handal untuk master data |
| Ekstensi Time-Series | **TimescaleDB** (extension PostgreSQL) | Efisien untuk pembacaan sensor volume tinggi + agregasi grafik 24 jam |
| Buffer / Ingestion Queue | **Redis Streams** | Menampung burst pesan MQTT sebelum batch-insert ke database |
| ORM / Query Builder | **Drizzle ORM** | Type-safe, performa tinggi, ringan, migrasi skema mudah |
| Validasi | **Zod** | Validasi payload MQTT dan input request API |
| Autentikasi API | **JWT** (`@fastify/jwt`) | Autentikasi token untuk endpoint REST API |
| Manajemen Proses | **Worker terpisah** | Pemisahan proses HTTP API dan MQTT Ingestion Worker |

---

## 4. Arsitektur

```mermaid
flowchart LR
    subgraph Field["Perangkat Lapangan"]
        S1["STM32 - Tangki A"]
        S2["STM32 - Tangki B"]
        S3["STM32 - Tangki N"]
    end

    S1 -- LoRa --> GW["Raspberry Pi\n(Gateway Pusat)"]
    S2 -- LoRa --> GW
    S3 -- LoRa --> GW

    GW -- "MQTT publish\n(sensor data)" --> BR["MQTT Broker"]
    BR -- "MQTT subscribe" --> SUB["MQTT Subscriber Service"]

    SUB --> BUF["Redis Streams\n(buffer)"]
    BUF --> WR["Batch Writer"]
    WR --> DB[("PostgreSQL + TimescaleDB")]

    SUB --> WARN["Warning Engine\n(threshold check)"]
    WARN --> DB

    DB --> API["Fastify REST API"]
    SUB --> WS["WebSocket Broadcaster"]
    WARN --> WS

    API --> FE1["Next.js (Web Dashboard)"]
    WS --> FE1
    API --> FE2["React Native (Mobile)"]
    WS --> FE2
```

**Catatan Arsitektur:**
- **Sistem Satu Arah (One-Way Data Flow):** Data mengalir dari sensor perangkat lapangan ke gateway, dipublish ke MQTT broker, diolah oleh backend, dan disajikan ke frontend.
- **Pemisahan Worker & API:** Ingest data sensor (MQTT + Redis Streams) dijalankan secara independen sehingga lonjakan pengiriman pesan dari banyak tangki tidak memperlambat respon Fastify REST API.
- **Warning Engine Realtime:** Pengecekan threshold langsung dievaluasi saat pesan sensor masuk untuk memastikan alert peringatan segera disiarkan via WebSocket tanpa menunggu proses batch-insert database selesai.

---

## 5. Komunikasi Data (MQTT)

Komunikasi dengan Gateway & Broker menggunakan protokol **MQTT**:

| Topic | Arah | QoS | Keterangan |
|---|---|---|---|
| `hospital/{tank_id}/level` | Gateway → Backend | 0 | Data level air periodik, frekuensi tinggi |
| `hospital/{tank_id}/status` | Gateway → Backend | 1 | Status konektivitas dan kesehatan node sensor |
| `hospital/{tank_id}/heartbeat` | Gateway → Backend | 0 | Keep-alive berkala per node / gateway |

### Contoh Payload (`level`)
```json
{
  "tank_id": "TANK-A",
  "sensor_node_id": "STM32-A01",
  "level_percent": 72.4,
  "volume_liters": 1450,
  "raw_value": 812,
  "rssi": -78,
  "timestamp": "2026-09-14T10:25:00Z"
}
```

### Contoh Payload (`status`)
```json
{
  "tank_id": "TANK-A",
  "sensor_node_id": "STM32-A01",
  "status": "online",
  "battery_level": 94,
  "timestamp": "2026-09-14T10:25:00Z"
}
```

---

## 6. Alur Data (End-to-End)

1. STM32 di masing-masing tangki membaca sensor ketinggian air secara periodik.
2. Data dikirimkan via modul radio **LoRa** ke satu unit Raspberry Pi (gateway pusat).
3. Raspberry Pi mem-publish pesan data ke **MQTT broker** sesuai topic `hospital/{tank_id}/...`.
4. **MQTT Subscriber Service** menerima pesan, memvalidasi integritas data dengan **Zod**, lalu:
   - Memasukkan data ke buffer **Redis Streams**.
   - Meneruskan data ke **Warning Engine** untuk evaluasi threshold secara realtime.
5. **Batch Writer** membaca data dari Redis Streams secara berkala/berkelompok (batch), lalu menginsert ke tabel time-series **PostgreSQL/TimescaleDB**.
6. Jika level air masuk ke rentang WARNING (30–60%) atau CRITICAL (<30%), Warning Engine otomatis mencatat record di tabel `alerts` dan memicu **WebSocket Broadcaster**.
7. Jika level air kembali normal, alert yang aktif otomatis ditandai sebagai `resolved`.
8. **WebSocket Broadcaster** mendorong pembaruan level air dan notifikasi alert terbaru ke web Next.js & aplikasi mobile React Native.
9. Dashboard memanggil **REST API** Fastify untuk menampilkan grafik historis 24 jam, master data tangki, status node sensor, dan riwayat alert.

---

## 7. Skema Database (PostgreSQL & TimescaleDB)

### Entitas Utama (7 Core Tables)
- **tanks** — Master data tangki (nama, kapasitas, lokasi, batas threshold peringatan).
- **gateways** — Data unit Raspberry Pi perantara LoRa ke MQTT.
- **sensor_nodes** — Data modul node STM32 per tangki.
- **water_level_readings** — Data time-series hasil pembacaan sensor (hypertable TimescaleDB).
- **alerts** — Riwayat peringatan WARNING/CRITICAL beserta status penanganannya.
- **users** — Akun operator dan administrator sistem.
- **audit_logs** — Riwayat jejak audit aktivitas pengguna dan sistem.

### ERD (Mermaid)

```mermaid
erDiagram
    TANKS ||--o{ SENSOR_NODES : has
    TANKS ||--o{ WATER_LEVEL_READINGS : has
    TANKS ||--o{ ALERTS : has
    GATEWAYS ||--o{ SENSOR_NODES : relays
    SENSOR_NODES ||--o{ WATER_LEVEL_READINGS : sends
    USERS ||--o{ AUDIT_LOGS : performs

    TANKS {
        uuid id PK
        varchar name
        varchar location
        numeric capacity_liters
        numeric min_threshold_percent
        numeric max_threshold_percent
        timestamptz created_at
        timestamptz updated_at
    }

    GATEWAYS {
        uuid id PK
        varchar device_code
        varchar status
        timestamptz last_heartbeat
        timestamptz created_at
    }

    SENSOR_NODES {
        uuid id PK
        uuid tank_id FK
        uuid gateway_id FK
        varchar device_code
        varchar sensor_type
        varchar status
        int last_rssi
        timestamptz last_seen
        timestamptz created_at
    }

    WATER_LEVEL_READINGS {
        bigserial id PK
        uuid tank_id FK
        uuid sensor_node_id FK
        numeric level_percent
        numeric volume_liters
        numeric raw_value
        int rssi
        timestamptz recorded_at
    }

    ALERTS {
        bigserial id PK
        uuid tank_id FK
        varchar level
        varchar message
        varchar status
        timestamptz created_at
        timestamptz resolved_at
    }

    USERS {
        uuid id PK
        varchar username
        varchar password_hash
        varchar role
        boolean is_active
        timestamptz created_at
    }

    AUDIT_LOGS {
        bigserial id PK
        uuid user_id FK
        varchar action
        varchar entity
        varchar entity_id
        text detail
        varchar ip_address
        timestamptz created_at
    }
```

### Catatan Implementasi Database
- `water_level_readings` diatur sebagai **hypertable TimescaleDB** dengan partisi berbasis kolom `recorded_at`, dilengkapi continuous aggregate untuk query grafik 24 jam yang cepat.
- Indeks komposit dibuat pada `(tank_id, recorded_at DESC)` di tabel `water_level_readings`.
- Kolom `alerts.status` menggunakan enum/tipe data: `'active'` dan `'resolved'`.
- Status `sensor_nodes.status` dan `gateways.status` diperbarui berdasarkan pesan heartbeat/last seen untuk mendeteksi perangkat offline secara otomatis.

---

## 8. Catatan Pengembangan & Integrasi
- Kebijakan retensi data dan downsampling di TimescaleDB (data mentah disimpan 30 hari, data agregasi per jam disimpan 1 tahun).
- Koordinasi spesifikasi skema response REST API dan event payload WebSocket dengan tim Frontend (Web & Mobile).
- Mekanisme autentikasi JWT token antara Fastify backend dan client dashboard.
- Strategi buffering lokal di Raspberry Pi jika koneksi internet/MQTT sempat terputus.

---

## 9. Sistem Autentikasi & Hak Akses (Role-Based Access Control)

Backend menerapkan autentikasi berbasis JSON Web Token (JWT) dengan Role-Based Access Control (RBAC) pada tabel `users`. Setiap permintaan ke REST API (kecuali endpoint publik seperti `/health` dan `/api/auth/login`) wajib menyertakan header `Authorization: Bearer <token>`.

### Daftar Role Pengguna

| Role | Deskripsi | Hak Akses |
|---|---|---|
| **admin** | Administrator teknis / sistem | Akses penuh: CRUD master data tangki, konfigurasi threshold, manajemen pengguna, manajemen gateway, dan audit log. |
| **operator** | Petugas / teknisi lapangan rumah sakit | Read master data & monitoring, melakukan resolve/penanganan alert peringatan, memperbarui status operasional tangki. |
| **viewer** | Pihak manajemen / dashboard display | Read-only: Melihat status level air, grafik histori 24 jam, dan riwayat alert aktif tanpa hak manipulasi data. |

### Matriks Akses Endpoint REST API

| Endpoint | Method | Role yang Diizinkan | Keterangan |
|---|---|---|---|
| `/health` | GET | Publik (Tanpa Auth) | Probe health check server & database |
| `/api/auth/login` | POST | Publik (Tanpa Auth) | Otentikasi username & password, mengembalikan token JWT |
| `/api/auth/me` | GET | `admin`, `operator`, `viewer` | Profil pengguna saat ini dari token |
| `/api/users` | GET | `admin` | Daftar seluruh akun pengguna sistem |
| `/api/users` | POST | `admin` | Menambahkan akun pengguna baru |
| `/api/users/:id` | PATCH, PUT | `admin` | Memperbarui role atau status keaktifan pengguna |
| `/api/users/:id` | DELETE | `admin` | Menghapus atau menonaktifkan pengguna |
| `/api/tanks` | GET | `admin`, `operator`, `viewer` | Daftar seluruh tangki beserta status terbaru & sensor node |
| `/api/tanks/:id` | GET | `admin`, `operator`, `viewer` | Detail data tangki beserta 50 pembacaan & alert terakhir |
| `/api/tanks/:id/readings` | GET | `admin`, `operator`, `viewer` | Histori time-series level air tangki tertentu (query: `hours`, `limit`) |
| `/api/tanks` | POST | `admin` | Menambahkan master tangki baru beserta konfigurasi threshold |
| `/api/tanks/:id` | PATCH, PUT | `admin` | Memperbarui data tangki atau batas threshold peringatan |
| `/api/tanks/:id` | DELETE | `admin` | Menghapus master tangki |
| `/api/readings/latest` | GET | `admin`, `operator`, `viewer` | Pembacaan level air terkini seluruh tangki |
| `/api/readings/history` | GET | `admin`, `operator`, `viewer` | Agregasi data time-series histori seluruh tangki |
| `/api/alerts` | GET | `admin`, `operator`, `viewer` | Daftar riwayat alert (opsional filter `?status=active` atau `resolved`) |
| `/api/alerts/:id/resolve`| PATCH, PUT | `admin`, `operator` | Menandai alert bahaya sebagai selesai / ditangani |
| `/api/gateways` | GET | `admin`, `operator` | Informasi kesehatan perangkat gateway Raspberry Pi |
| `/api/gateways/:deviceCode/sync`| GET | Internal / Gateway Key / `admin` | Endpoint sinkronisasi mapping tangki & sensor untuk Raspberry Pi |
| `/api/nodes` | GET | `admin`, `operator`, `viewer` | Daftar seluruh modul sensor node STM32 beserta relasinya |
| `/api/audit-logs` | GET | `admin` | Audit trail aktivitas pengguna di sistem (paginated) |
| `/api/reports/readings/export` | GET | `admin`, `operator`, `viewer` | Download data pembacaan sensor dalam format CSV |
| `/api/reports/alerts/export` | GET | `admin`, `operator`, `viewer` | Download rekapitulasi riwayat peringatan dalam format CSV |

---

## 10. Protokol Komunikasi Gateway Raspberry Pi ke Backend di VPS

Raspberry Pi bertindak sebagai gateway sentral yang menerima sinyal telemetri LoRa dari modul STM32 di tiap tangki, lalu meneruskannya ke broker MQTT di VPS.

```mermaid
sequenceDiagram
    autonumber
    participant STM as STM32 (Node Sensor)
    participant RPI as Raspberry Pi (Gateway)
    participant BRK as Mosquitto MQTT (VPS)
    participant API as Fastify Backend (VPS)
    participant DB as TimescaleDB / Redis (VPS)

    Note over RPI,API: Fase 1: Booting & Sinkronisasi Mapping (HTTP GET)
    RPI->>API: GET /api/gateways/GW-HUB-01/sync (X-Gateway-Secret)
    API->>DB: Query relasi Tank & Sensor Nodes
    DB-->>API: Data mapping (device_code, tank_id, sensor_node_id)
    API-->>RPI: JSON Dictionary Mapping (disimpan di RAM/file lokal)

    Note over STM,DB: Fase 2: Pengiriman Telemetri Berulang (LoRa -> MQTT)
    STM->>RPI: LoRa Packet: { node_code: "STM32-ATA", raw_val: 820, level: 78.5 }
    RPI->>RPI: Cocokkan node_code dengan Mapping -> dapatkan tank_id UUID
    RPI->>BRK: MQTT Publish: hospital/{tank_id}/level { tank_id, sensor_node_id, level_percent, ... }
    BRK->>API: MQTT Subscriber menerima pesan
    API->>DB: Buffer ke Redis Streams & Evaluasi Warning Engine
    API-->>DB: Batch Writer menyimpan ke TimescaleDB
```

### Cara Raspberry Pi Mendapatkan `tank_id` dan `sensor_node_id`

Terdapat 2 mekanisme integrasi yang didukung secara *hybrid*:

#### 1. Mekanisme Utama: Auto-Sync Konfigurasi saat Booting
1. Saat program gateway Python/C di Raspberry Pi dinyalakan, gateway memanggil endpoint:
   ```http
   GET /api/gateways/GW-HUB-01/sync
   Header: X-Gateway-Key: <GATEWAY_SECRET_KEY>
   ```
2. Backend merespon dengan peta relasi lengkap tangki dan sensor:
   ```json
   {
     "success": true,
     "gateway_code": "GW-HUB-01",
     "synced_at": "2026-09-24T15:30:00Z",
     "mappings": [
       {
         "device_code": "STM32-ATA",
         "sensor_node_id": "6b464034-79f0-46fe-a7e4-7bd3b7fa9c8a",
         "tank_id": "a6f5ade5-777c-4871-a584-de40d11df30d",
         "tank_name": "Tangki Atap Gedung Utama",
         "capacity_liters": 10000
       },
       {
         "device_code": "STM32-GED",
         "sensor_node_id": "ec120989-a026-4935-bded-fae8885b2106",
         "tank_id": "fffce8f9-04e2-4f9e-9302-fd2e1c6d1825",
         "tank_name": "Tangki Gedung Rawat Inap",
         "capacity_liters": 8000
       }
     ]
   }
   ```
3. Raspberry Pi menyimpan dictionary ini di memori lokal. Ketika paket LoRa masuk dari `STM32-ATA`, Raspberry Pi langsung memasukkan `tank_id` dan `sensor_node_id` yang sesuai ke dalam payload MQTT.

#### 2. Mekanisme Cadangan: Auto-Resolution di Sisi Backend
Jika Raspberry Pi belum sempat melakukan sync atau firmware lama hanya mengirimkan kode string fisik (`sensor_node_id: "STM32-ATA"`), backend secara otomatis melakukan pencarian ke tabel `sensor_nodes` untuk menemukan relasi `tank_id`-nya secara transparan tanpa menyebabkan error validasi database.

### Keamanan Jalur Komunikasi Raspberry Pi ke VPS
* **Opsi Jaringan Terisolasi (Tailscale Mesh):** Raspberry Pi terhubung ke jaringan Tailscale yang sama dengan VPS. Komunikasi MQTT mengarah ke IP `100.94.192.102:1883` yang terenkripsi penuh melalui WireGuard tanpa mengekspos broker ke internet publik.
* **Opsi Autentikasi Broker:** Mosquitto dapat diatur dengan autentikasi `username` dan `password` khusus perangkat IoT gateway.
