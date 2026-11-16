# Panduan Audit & Integrasi Frontend: Backend Water Tank Monitoring System

Dokumen ini adalah instruksi operasional dan protokol verifikasi (Agent Skill) bagi AI Agent pengembang frontend. Gunakan panduan ini untuk mengaudit repositori frontend, membedah implementasi integrasi yang ada, mendeteksi bug atau data yang hilang/salah, serta menyusun rencana perbaikan (remediation plan) terstruktur bagi pengembang.

---

## 1. Peran & Alur Kerja Agent (Agent Operating Protocol)

Saat ditugaskan memeriksa atau memperbaiki integrasi frontend terhadap backend, Agent wajib menjalankan prosedur berikut secara berurutan:

1. **Audit Konfigurasi Jaringan & Environment**:
   * Periksa apakah URL backend mengarah ke endpoint yang valid (Tailscale Funnel HTTPS vs IP privat HTTP).
   * Pastikan pemisahan protokol: HTTP/HTTPS untuk REST API dan WS/WSS untuk WebSocket.
2. **Audit Otentikasi & Penyimpanan Token**:
   * Periksa apakah token JWT diperoleh dari alur login resmi dan disimpan secara konsisten.
   * Pastikan seluruh panggilan REST API menyertakan header otentikasi.
   * Pastikan koneksi WebSocket menyertakan token pada parameter query URL (bukan header).
3. **Audit Keselarasan Skema Data (Data Contract Verification)**:
   * Bandingkan tipe data di state frontend dengan tipe data riil dari database/REST API (waspadai string desimal).
   * Verifikasi konsistensi konvensi penamaan: REST API menggunakan `camelCase`, sedangkan payload WebSocket/MQTT menggunakan `snake_case`.
4. **Audit Siklus Hidup Realtime WebSocket**:
   * Verifikasi penanganan event `LEVEL_UPDATE`, `ALERT_TRIGGERED`, dan `ALERT_RESOLVED`.
   * Pastikan ada mekanisme auto-reconnect dengan jeda (backoff) dan pembersihan koneksi (cleanup).
5. **Pemeriksaan Komponen Fungsional**:
   * Cek komponen kartu tangki, grafik time-series, tabel alert, pin peta koordinat, dan unduhan file CSV.
6. **Penyusunan Laporan & Rencana Perbaikan (Remediation Plan)**:
   * Sajikan temuan masalah, berkas yang terdampak, akar penyebab, serta langkah perbaikan yang tepat tanpa mengubah logika bisnis inti.

---

## 2. Verifikasi Konfigurasi Lingkungan (Environment Variables)

Agent harus memeriksa berkas konfigurasi lingkungan frontend (`.env`, `.env.local`, atau variabel build):

### Aturan Protokol Jaringan:
* **Mode Produksi / Tunnel (HTTPS & WSS)**:
  * Jika frontend diakses melalui domain HTTPS (misal Tailscale Funnel), URL API **wajib** menggunakan `https://` dan WebSocket **wajib** menggunakan `wss://`.
  * Pencampuran protokol (Mixed Content: halaman HTTPS memanggil API `http://` atau `ws://`) akan diblokir otomatis oleh browser.
* **Mode Pengembangan Lokal (HTTP & WS)**:
  * Menggunakan `http://` untuk REST API (port default `8000`) dan `ws://` untuk WebSocket (`/ws`).
* **Variabel Standar**:
  * `NEXT_PUBLIC_API_URL` atau `VITE_API_URL`: Base URL tanpa trailing slash (contoh: `https://ubuntu-luis.tail7e12bf.ts.net` atau `http://100.94.192.102:8000`).
  * `NEXT_PUBLIC_WS_URL` atau `VITE_WS_URL`: URL endpoint socket lengkap (contoh: `wss://ubuntu-luis.tail7e12bf.ts.net/ws` atau `ws://100.94.192.102:8000/ws`).

---

## 3. Protokol Verifikasi Otentikasi & Interceptor

### A. Alur Login & Penyimpanan Kredensial
* **Endpoint Login**: `POST /api/auth/login`
* **Payload Request**: JSON `{ "username": "<string>", "password": "<string>" }`
* **Response Sukses**: JSON `{ "success": true, "data": { "token": "<jwt_string>", "user": { "id": "<uuid>", "username": "<string>", "role": "admin" | "operator" } } }`
* **Lokasi Token**: String token berada di path `data.token`.
* **Poin Audit Agent**:
  * Pastikan token disimpan di media persisten yang aman (`localStorage` atau `sessionStorage`).
  * Jangan menyimpan objek user sebagai pengganti string token.

### B. Header Otentikasi HTTP (REST API)
* Seluruh endpoint selain `/api/auth/login`, `/health`, dan `/api/gateways/:deviceCode/sync` mewajibkan header:
  `Authorization: Bearer <token>`
* Header request wajib menyertakan `Content-Type: application/json` kecuali untuk endpoint ekspor file.
* **Poin Audit Agent**:
  * Periksa apakah interceptor (Axios, Fetch Wrapper, atau Query Client) menangani error HTTP `401 Unauthorized`.
  * Saat error 401 terjadi, frontend harus membersihkan token kadaluwarsa dan mengarahkan navigasi ke rute login.

### C. Otentikasi WebSocket
* Browser API standar (`new WebSocket()`) tidak mendukung penambahan custom HTTP Header.
* Backend Fastify mengotentikasi koneksi WebSocket melalui **Query Parameter URL**:
  Format: `<WS_BASE_URL>?token=<token_jwt>`
* Jika token tidak disertakan atau sudah kadaluwarsa, server langsung menolak koneksi dengan status penutupan **WebSocket Close Code 1008 (Policy Violation)**.
* **Poin Audit Agent**:
  * Pastikan URL koneksi WebSocket selalu ditempeli query parameter `?token=...`.
  * Pastikan token di-encode secara aman (`encodeURIComponent(token)`).

---

## 4. Matriks Transformasi Data & Type Safety (Backend vs Frontend)

Penyebab bug paling umum pada frontend adalah perbedaan tipe data antara basis data PostgreSQL/Drizzle dengan tipe data di JavaScript/TypeScript.

### Aturan Kritis Tipe Data PostgreSQL:
Kolom bertipe `NUMERIC` atau `DECIMAL` pada PostgreSQL dikembalikan oleh backend sebagai **string desimal** (bukan number float/integer) untuk menjaga presisi angka. Frontend **wajib** melakukan konversi eksplisit menggunakan `parseFloat()` atau `Number()`.

### Tabel Audit Pemetaan Properti:

| Entitas Data | Properti Backend REST API | Tipe Data Asli Backend | Tipe Data yang Diharapkan Frontend | Keterangan & Aturan Transformasi |
|---|---|---|---|---|
| **Tangki** | `id` | String (UUID v4) | String | Identifier unik tangki |
| Tangki | `name` | String | String | Nama tangki (contoh: "Tangki Gedung Utama") |
| Tangki | `location` | String / Null | String | Lokasi fisik tangki |
| Tangki | `capacityLiters` | String Desimal | Number | Konversi via `parseFloat(tank.capacityLiters)` |
| Tangki | `minThresholdPercent` | String Desimal | Number | Default "30.00", batas bawah bahaya (CRITICAL) |
| Tangki | `maxThresholdPercent` | String Desimal | Number | Default "90.00", batas atas peringatan |
| Tangki | `minDistanceCm` | String Desimal | Number | Jarak sensor saat tangki 100% penuh (default "30.00") |
| Tangki | `maxDistanceCm` | String Desimal | Number | Jarak sensor saat tangki 0% kosong (default "350.00") |
| Tangki | `latitude` | String / Null | Number / Null | Parse ke float sebelum dioper ke peta: `parseFloat(tank.latitude)` |
| Tangki | `longitude` | String / Null | Number / Null | Parse ke float sebelum dioper ke peta: `parseFloat(tank.longitude)` |
| Tangki | `latestReading` | Objek / Null | Objek / Null | Null jika tangki belum pernah menerima telemetri sensor |
| Tangki | `activeAlert` | Objek / Null | Objek / Null | Null jika level air normal; terisi jika status WARNING/CRITICAL |
| **Pembacaan Air** | `levelPercent` | String Desimal / Number | Number | Persentase air (0.00 - 100.00) hasil kalkulasi backend |
| Pembacaan Air | `volumeLiters` | String Desimal / Number | Number | Volume air dalam liter hasil kalkulasi backend |
| Pembacaan Air | `rawValue` | String Desimal / Number | Number | Jarak fisik sensor ke air dalam centimeter (`distance_cm`) |
| Pembacaan Air | `rssi` | Number / Null | Number / Null | Kekuatan sinyal LoRa dalam dBm (contoh: -68) |
| Pembacaan Air | `recordedAt` | String (ISO 8601 UTC) | String / Date | Format waktu UTC (contoh: `2026-11-16T08:50:02.120Z`) |
| **Peringatan** | `id` | Integer | Number | ID numerik alert |
| Peringatan | `tankId` | String (UUID v4) | String | Relasi ke tangki terkait |
| Peringatan | `level` | Enum String | "WARNING" \| "CRITICAL" | Tingkat keparahan bahaya |
| Peringatan | `message` | String | String | Deskripsi peringatan dari Warning Engine |
| Peringatan | `status` | Enum String | "active" \| "resolved" | Status penanganan alert |
| Peringatan | `createdAt` | String (ISO 8601 UTC) | String / Date | Waktu alert tercatat pertama kali |
| Peringatan | `resolvedAt` | String / Null | String / Null | Waktu alert diselesaikan (otomatis/manual) |

---

## 5. Protokol Verifikasi Realtime WebSocket

### A. Format Pesan Masuk (Event Specs)

Pesan dari server dikirim dalam format JSON dengan format envelope terstandarisasi:

#### 1. Event `LEVEL_UPDATE` (Pembaruan Level Air Berkala):
* **Trigger**: Dipancarkan setiap kali backend menerima data telemetri valid dari sensor node melalui MQTT.
* **Format Envelope**:
  ```json
  {
    "type": "LEVEL_UPDATE",
    "timestamp": "2026-11-16T08:50:02.125Z",
    "data": {
      "tank_id": "0d8e0439-184e-4f91-b307-eb3c847d16a1",
      "sensor_node_id": "b3e0c091-7412-4211-9a72-b2a1e054231b",
      "level_percent": 74.25,
      "volume_liters": 7425.00,
      "distance_cm": 112.4,
      "raw_value": 112.4,
      "rssi": -68,
      "sequence": 172,
      "is_buffered": false,
      "timestamp": "2026-11-16T08:50:02.120Z"
    }
  }
  ```
* **Poin Audit Agent**:
  * Perhatikan bahwa payload data di dalam socket menggunakan **`snake_case`** (`tank_id`, `sensor_node_id`, `level_percent`, `volume_liters`, `distance_cm`, `raw_value`, `is_buffered`).
  * Jika frontend memetakan properti ini ke state `latestReading`, properti harus diselaraskan ke format state yang digunakan komponen (`tankId`, `levelPercent`, `volumeLiters`, `rawValue`, dll).
  * Data `level_percent` dan `volume_liters` sudah merupakan hasil kalkulasi presisi backend. Frontend **tidak boleh** melakukan kalkulasi ulang sendiri menggunakan rumus manual.
  * Hindari me-refresh halaman atau memicu ulang `GET /api/tanks`. Perbarui state lokal secara imutabel berdasarkan kecocokan `tank.id === update.tank_id`.

#### 2. Event `ALERT_TRIGGERED` (Notifikasi Bahaya Baru):
* **Trigger**: Muncul seketika saat level air turun melampaui batas minimum.
* **Format Envelope**:
  ```json
  {
    "type": "ALERT_TRIGGERED",
    "timestamp": "2026-11-16T08:50:10.000Z",
    "data": {
      "id": 95,
      "tankId": "0d8e0439-184e-4f91-b307-eb3c847d16a1",
      "level": "CRITICAL",
      "message": "Level air tangki Tangki Gedung Utama CRITICAL: 18.5% (di bawah 30%)",
      "status": "active"
    }
  }
  ```
* **Poin Audit Agent**:
  * Tambahkan alert baru ke daftar alert aktif di frontend.
  * Update properti `activeAlert` pada tangki yang bersangkutan agar indikator visual kartu tangki berubah warna menjadi merah/kuning.

#### 3. Event `ALERT_RESOLVED` (Pemulihan Air Normal):
* **Trigger**: Dipancarkan saat level air naik kembali di atas batas ambang aman.
* **Format Envelope**:
  ```json
  {
    "type": "ALERT_RESOLVED",
    "timestamp": "2026-11-16T08:55:00.000Z",
    "data": {
      "id": 95,
      "tankId": "0d8e0439-184e-4f91-b307-eb3c847d16a1",
      "resolvedAt": "2026-11-16T08:55:00.000Z"
    }
  }
  ```
* **Poin Audit Agent**:
  * Frontend wajib menghapus alert dari daftar alert aktif atau menandainya sebagai `resolved`.
  * Hapus `activeAlert` (set ke `null`) pada kartu tangki terkait agar status visual kembali normal.

### B. Manajemen Siklus Hidup Socket (Connection Management)
* **Pencegahan Multiple Connection**: Pastikan koneksi WebSocket dikelola sebagai singleton atau dibersihkan dengan benar saat komponen di-unmount. Pembukaan instance socket ganda akan membebani server dan menyebabkan memory leak di browser.
* **Strategi Auto-Reconnect**:
  * Handler `onclose` harus menerapkan mekanisme reconnect dengan jeda waktu minimal 3 sampai 5 detik.
  * Hindari reconnect loop instan (0 detik) yang dapat memicu rate-limit atau memblokir browser thread.

---

## 6. Protokol Audit Endpoint REST API

Agent harus memverifikasi bahwa frontend memanggil endpoint yang tepat dengan query parameter yang valid:

### 1. Daftar Seluruh Tangki
* **Metode & Path**: `GET /api/tanks`
* **Response**: `{ "success": true, "data": Tank[] }`
* **Kebutuhan UI**: Digunakan untuk initial state dashboard dan monitoring overview.
* **Poin Audit**: Periksa penanganan nilai `null` pada `latestReading` dan `activeAlert` untuk mencegah error runtime `Cannot read property of null`.

### 2. Detail Spesifik Tangki
* **Metode & Path**: `GET /api/tanks/:id`
* **Response**: `{ "success": true, "data": TankDetail }`
* **Kebutuhan UI**: Halaman konfigurasi tangki, modal detail, atau data sensor node yang terpasang (`sensorNodes`).

### 3. Riwayat Pembacaan Sensor (Grafik Time-Series)
* **Metode & Path**: `GET /api/tanks/:id/readings`
* **Query Parameters yang Didukung**:
  * `hours`: Rentang waktu ke belakang dalam satuan jam (contoh: `hours=24` untuk 24 jam terakhir). Default 24, maksimal 168 (7 hari).
  * `limit`: Jumlah maksimal data point yang diambil (default 100, maksimal 500).
* **Response**: `{ "success": true, "data": WaterLevelReading[] }`
* **Poin Audit Kritis**:
  * Data dari backend diurutkan secara **Descending (`DESC`)** berdasarkan waktu (titik terbaru berada di indeks 0).
  * Komponen grafik (Chart.js, Recharts, ApexCharts) umumnya mewajibkan data terurut secara **Ascending (`ASC`)** dari kiri ke kanan. Frontend wajib membalik urutan data (misal via `.reverse()` atau `.sort()`) sebelum diserahkan ke komponen grafik.

### 4. Manajemen & Riwayat Peringatan (Alerts)
* **Daftar Peringatan**: `GET /api/alerts?status=active` (atau tanpa filter untuk seluruh riwayat).
* **Selesaikan Peringatan Manual**: `PATCH /api/alerts/:id/resolve` (atau `PUT /api/alerts/:id/resolve`).
* **Poin Audit**:
  * Saat tombol "Resolve" ditekan oleh operator, kirim request ke endpoint resolve dan perbarui status di state frontend tanpa harus me-reload halaman.

### 5. Ekspor Data Laporan (CSV Export)
* **Metode & Path**: `GET /api/reports/readings/export?tankId=<uuid>`
* **Format Response**: `text/csv; charset=utf-8` (Bukan JSON!).
* **Poin Audit**:
  * Frontend tidak boleh mem-parse response ini menggunakan `.json()`.
  * Response harus dibaca sebagai text atau Blob, lalu dialirkan ke anchor tag HTML untuk memicu dialog download berkas di browser klien.

---

## 7. Panduan Diagnostik & Solusi Masalah Umum (Troubleshooting Matrix)

Gunakan tabel gejala berikut untuk mengidentifikasi bug pada kode frontend:

| Gejala Bug di Antarmuka Frontend | Akar Masalah (Root Cause) | Solusi Audit & Perbaikan bagi Agent |
|---|---|---|
| Level air atau volume menampilkan `NaN%` atau `NaN L`. | Nilai `levelPercent` atau `capacityLiters` adalah string desimal dari database, lalu dioperasikan langsung dengan operator matematika. | Bungkus nilai properti menggunakan `parseFloat(val)` atau `Number(val)` sebelum perhitungan visual. |
| Koneksi WebSocket langsung tertutup dengan Close Code `1008`. | Frontend tidak menyertakan query parameter `?token=<jwt>` pada URL inisialisasi WebSocket. | Tambahkan token aktif ke URL: `${WS_URL}?token=${encodeURIComponent(token)}`. |
| Kartu tangki tidak bereaksi saat air bertambah/berkurang, padahal koneksi socket open. | Mismatch properti: Komponen mencari `data.tankId` (camelCase), sedangkan event socket mengirim `data.tank_id` (snake_case). | Petakan `data.tank_id` ke properti state yang sesuai, atau update state tangki dengan `tank.id === data.tank_id`. |
| Grafik time-series berjalan mundur (waktu terbaru di sebelah kiri). | Data dari API terurut secara `DESC` (terbaru dulu), sedangkan library chart membaca array dari kiri ke kanan secara kronologis. | Balik urutan array data (`[...res.data].reverse()`) sebelum memetakan sumbu X dan Y grafik. |
| Banner peringatan bahaya tidak hilang meskipun level air sudah kembali normal. | Frontend hanya mendengarkan event `ALERT_TRIGGERED`, namun mengabaikan event `ALERT_RESOLVED`. | Tambahkan handler untuk event `ALERT_RESOLVED` pada listener socket yang mengatur `activeAlert` menjadi `null`. |
| Pin tangki tidak muncul di komponen peta interaktif. | Nilai `latitude` atau `longitude` bernilai string atau `null`. | Lakukan validasi `if (tank.latitude && tank.longitude)` dan parse ke float: `[parseFloat(tank.latitude), parseFloat(tank.longitude)]`. |
| Browser melempar error `Mixed Content: This request has been blocked`. | Aplikasi di-host di domain HTTPS (misal Tailscale Funnel), tetapi variabel lingkungan mengarah ke `http://` atau `ws://`. | Ubah variabel lingkungan menjadi `https://` untuk REST dan `wss://` untuk WebSocket. |
| Error HTTP 429 Too Many Requests muncul secara berkala. | Frontend melakukan polling REST API berulang dalam interval sangat cepat, melebihi kuota rate limit backend. | Hentikan polling agresif; gunakan WebSocket untuk pembaruan realtime dan batasi polling hanya untuk data non-realtime. |

---

## 8. Template Rencana Perbaikan (Remediation Plan Output)

Ketika Agent selesai mengaudit kode frontend dan menemukan masalah, susun laporan dan rencana perbaikan untuk pengembang dengan format berikut:

```markdown
### 1. Ringkasan Hasil Audit
* Status Integrasi: [Tersambung / Parsial / Bermasalah]
* Jumlah Masalah Ditemukan: [Jumlah]

### 2. Rincian Temuan & Akar Masalah
* **Temuan 1**: [Deskripsi masalah]
  * **Lokasi Berkas**: `[Path berkas frontend]`
  * **Akar Masalah**: [Penjelasan ketidaksesuaian kontrak/tipe data]
  * **Dampak**: [Misal: gauge air menampilkan NaN, socket terputus]

### 3. Langkah Rencana Perbaikan (Step-by-Step Remediation Plan)
* [ ] **Langkah 1**: Perbaiki [komponen/interceptor/hook] pada berkas X.
* [ ] **Langkah 2**: Selaraskan tipe data dan pemetaan properti sesuai tabel kontrak.
* [ ] **Langkah 3**: Tambahkan penanganan event socket yang hilang.

### 4. Kriteria Verifikasi Sukses
* Ketinggian air terisi nilai numerik valid tanpa NaN.
* Status koneksi WebSocket stabil tanpa penolakan kode 1008.
* Pembaruan level dan peringatan bahaya tersinkronisasi realtime tanpa refresh halaman.
```
