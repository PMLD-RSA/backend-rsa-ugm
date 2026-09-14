# WP-3 — Backend, Database & Monitoring/Warning Engine
### Integrated Hospital Water Tank Monitoring Research Project (RSA UGM)

Boilerplate backend untuk pemrosesan data, manajemen time-series database, engine deteksi peringatan (*Warning Engine*), dan penyedia API / WebSocket realtime untuk sistem pemantauan ketinggian air tangki rumah sakit.

---

## Tech Stack

- **Runtime & Bahasa**: Node.js (v22+) & TypeScript
- **Web API Framework**: Fastify v5
- **Database Relasional & Time-Series**: PostgreSQL + TimescaleDB (Hypertable)
- **ORM & Query Builder**: Drizzle ORM
- **Message Ingestion**: MQTT.js (Subscriber dari Raspberry Pi Gateway)
- **Buffer / Queue**: Redis Streams (Menampung lonjakan transmisi sensor)
- **Realtime Push**: WebSocket (`@fastify/websocket`)
- **Validasi Data**: Zod

---

## Struktur Direktori

```
backend-rsa-ugm/
├── docker-compose.yml          # Setup TimescaleDB, Redis, dan Mosquitto MQTT lokal
├── mosquitto.conf              # Konfigurasi MQTT broker lokal
├── drizzle.config.ts           # Konfigurasi Drizzle ORM
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── api/
│   │   ├── plugins/            # Fastify plugins (JWT, WebSocket)
│   │   ├── routes/             # Endpoint REST API (tanks, readings, alerts, gateways, health)
│   │   └── server.ts           # Fastify HTTP & WebSocket server entrypoint
│   ├── config/
│   │   └── env.ts              # Validasi konfigurasi environment dengan Zod
│   ├── db/
│   │   ├── schema/             # Definisi skema tabel Drizzle ORM (7 Core Tables)
│   │   └── index.ts            # Pool koneksi database
│   ├── schemas/                # Zod validation schemas (MQTT payload & API request)
│   ├── services/
│   │   ├── warning-engine.ts   # Pengecekan threshold & auto-generate alerts
│   │   ├── redis-stream.ts     # Ingestion buffer dengan Redis Streams
│   │   ├── batch-writer.ts     # Worker batch insert dari Redis ke TimescaleDB
│   │   └── ws-broadcaster.ts   # Realtime broadcaster ke WebSocket clients
│   ├── worker/
│   │   ├── mqtt-subscriber.ts  # Subscriber data sensor via MQTT
│   │   └── worker.ts           # Standalone background worker entrypoint
│   ├── scripts/
│   │   ├── simulate-sensor.ts  # Simulator pengirim data sensor STM32 via MQTT
│   │   └── init-db.ts          # Inisialisasi hypertable TimescaleDB & seed data
│   └── index.ts                # Main entrypoint (menjalankan API + Worker bersamaan)
└── requirements.md             # Dokumen spesifikasi teknis terbaru
```

---

## Panduan Memulai (Quickstart)

### 1. Menjalankan Layanan Database & Broker (Docker)

Jalankan TimescaleDB, Redis, dan MQTT Mosquitto secara lokal menggunakan Docker Compose:

```bash
docker compose up -d
```

Pastikan ketiga kontainer berjalan:
- PostgreSQL / TimescaleDB di `localhost:5432`
- Redis di `localhost:6379`
- Mosquitto MQTT di `localhost:1883`

### 2. Instalasi Dependensi

```bash
npm install
```

### 3. Konfigurasi Environment

Salin file `.env.example` ke `.env` (nilai default sudah disesuaikan dengan Docker Compose):

```bash
cp .env.example .env
```

### 4. Setup Database & Migrasi

Sinkronkan skema tabel Drizzle ORM ke database:

```bash
npm run db:push
```

Inisialisasi hypertable TimescaleDB dan isi data awal tangki:

```bash
npm run init-db
```

### 5. Menjalankan Aplikasi

#### Mode Pengembangan (Terintegrasi API + Worker):
```bash
npm run dev
```
Server API akan berjalan di `http://localhost:8000` dan WebSocket di `ws://localhost:8000/ws`.

#### Mode Produksi / Terpisah (Opsional):
- Jalankan hanya server API:
  ```bash
  npm run dev:api
  ```
- Jalankan hanya background worker (MQTT & Batch Writer):
  ```bash
  npm run dev:worker
  ```

---

## 🧪 Menguji Aliran Data (Simulator Sensor)

Untuk mensimulasikan modul STM32 di lapangan yang mengirimkan pembacaan ketinggian air secara periodik via MQTT:

```bash
npm run simulate
```

Anda dapat melihat:
1. Simulator mem-publish payload sensor ke topic `hospital/{tank_id}/level`.
2. MQTT Subscriber menerima pesan dan memasukkannya ke **Redis Streams**.
3. **Warning Engine** langsung mengevaluasi threshold (jika level < 30% memicu alert CRITICAL, jika 30%-60% memicu WARNING).
4. **WebSocket Broadcaster** langsung menyiarkan pembaruan level dan alert ke seluruh client frontend yang terhubung.
5. **Batch Writer** mengelompokkan pesan dari Redis Streams dan melakukan batch-insert efisien ke **TimescaleDB**.

---

## 📡 Dokumentasi Endpoint REST API

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/health` | Pemeriksaan kesehatan layanan (DB, Redis, WebSocket) |
| `GET` | `/api/tanks` | Daftar seluruh tangki beserta pembacaan level terbaru dan status alert |
| `GET` | `/api/tanks/:id` | Detail spesifik tangki, data sensor terkini, dan riwayat alert |
| `POST` | `/api/tanks` | Mendaftarkan tangki baru |
| `PATCH` | `/api/tanks/:id` | Memperbarui parameter threshold/kapasitas tangki |
| `GET` | `/api/tanks/:id/readings` | Histori pembacaan sensor untuk grafik (query `?hours=24`) |
| `GET` | `/api/alerts` | Riwayat alert (bisa filter `?status=active` atau `?status=resolved`) |
| `PATCH` | `/api/alerts/:id/resolve` | Menyelesaikan/menutup alert secara manual oleh operator |
| `GET` | `/api/gateways` | Daftar gateway Raspberry Pi dan node sensor yang terhubung |
| `GET` | `/api/nodes` | Daftar seluruh perangkat sensor STM32 dan status koneksi |
| `WS` | `/ws` | WebSocket channel untuk update realtime (`LEVEL_UPDATE`, `ALERT_TRIGGERED`, `ALERT_RESOLVED`) |

---

## 🛠️ Drizzle Studio

Untuk membuka GUI penjelajah database secara visual:

```bash
npm run db:studio
```

