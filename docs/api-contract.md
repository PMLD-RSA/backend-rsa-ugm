# DOKUMEN KONTRAK API & SPESIFIKASI REALTIME
## Integrated Hospital Water Tank Monitoring Research Project (RSA UGM - WP-3)

Dokumen ini merupakan kontrak resmi antarmuka data antara **Backend (WP-3)** dan **Frontend Web (Next.js) & Mobile (React Native) (WP-4)**. Dokumen ini juga menjadi acuan mutlak bagi **UI/UX Designer** dalam merancang tata letak antarmuka di Figma.

---

## 1. Ringkasan & Konvensi Global

### 1.1 Base URL & Protokol
* **HTTP REST API Base URL:** `http://localhost:8000` (Development) / `http://<server-ip>:8000`
* **WebSocket URL (Realtime):** `ws://localhost:8000/ws` (Development) / `ws://<server-ip>:8000/ws`
* **Content-Type:** `application/json; charset=utf-8`
* **Format Timestamp:** Standar ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`)

### 1.2 Format Respons Standar (Response Envelope)

#### Respons Berhasil (2xx)
```json
{
  "success": true,
  "data": { ... } // atau array [ ... ]
}
```

#### Respons Gagal / Validasi Error (4xx, 5xx)
```json
{
  "success": false,
  "message": "Pesan deskripsi kesalahan",
  "errors": { ... } // Opsional: rincian validasi field jika status code 400
}
```

---

## 2. Kamus Data & Model Entitas (Data Dictionary)

Model data ini diturunkan langsung dari skema database PostgreSQL dan payload sensor fisik:

### 2.1 Entitas Tangki (`Tank`)
| Field | Tipe | Nullable | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` (string) | Tidak | Identifier unik tangki (misal: `"3fa85f64-5717-4562-b3fc-2c963f66afa6"`) |
| `name` | `string(100)` | Tidak | Nama tangki (contoh: `"Tangki Atap Gedung Utama"`) |
| `location` | `string(150)` | Ya | Lokasi fisik (contoh: `"Atap Gedung A (Utama), Lantai 5"`) |
| `capacityLiters` | `string(numeric)` | Tidak | Kapasitas maksimal tangki dalam liter (contoh: `"10000.00"`) |
| `minThresholdPercent` | `string(numeric)` | Tidak | Batas bawah level air bahaya/CRITICAL (default: `"30.00"`) |
| `maxThresholdPercent` | `string(numeric)` | Tidak | Batas atas level air maksimal (default: `"90.00"`) |
| `createdAt` | `string(ISO8601)` | Tidak | Tanggal pendaftaran tangki |
| `updatedAt` | `string(ISO8601)` | Tidak | Tanggal pembaruan konfigurasi tangki |

### 2.2 Entitas Pembacaan Sensor (`WaterLevelReading`)
| Field | Tipe | Nullable | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `number` (bigserial) | Tidak | ID log pembacaan |
| `tankId` | `UUID` (string) | Tidak | ID tangki yang diukur |
| `sensorNodeId` | `UUID` (string) | Ya | ID node sensor STM32 yang membaca |
| `levelPercent` | `string(numeric)` | Tidak | Persentase ketinggian air saat ini (0.00 - 100.00 %) |
| `volumeLiters` | `string(numeric)` | Tidak | Estimasi volume air tersisa dalam liter |
| `rawValue` | `string(numeric)` | Ya | Nilai mentah sensor ultrasonik/jarak |
| `rssi` | `number` | Ya | Kekuatan sinyal radio LoRa dalam satuan dBm (contoh: `-78`) |
| `recordedAt` | `string(ISO8601)` | Tidak | Timestamp waktu pengukuran sensor |

### 2.3 Entitas Peringatan (`Alert`)
| Field | Tipe | Nullable | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `number` (bigserial) | Tidak | ID unik alert |
| `tankId` | `UUID` (string) | Tidak | ID tangki terkait |
| `level` | `string` | Tidak | Kategori bahaya: `"WARNING"` (30% - 60%) atau `"CRITICAL"` (<30%) |
| `message` | `string(255)` | Tidak | Deskripsi otomatis dari Warning Engine |
| `status` | `string` | Tidak | Status alert: `"active"` atau `"resolved"` |
| `createdAt` | `string(ISO8601)` | Tidak | Waktu pertama kali kondisi bahaya terdeteksi |
| `resolvedAt` | `string(ISO8601)` | Ya | Waktu kondisi bahaya selesai / dinormalkan |

### 2.4 Entitas Perangkat Gateway & Node Sensor
* **Gateway (`Gateway`):** Unit Raspberry Pi perantara LoRa ke MQTT.
  * `id` (`UUID`), `deviceCode` (`string`), `status` (`"online"` | `"offline"`), `lastHeartbeat` (`ISO8601`).
* **Node Sensor (`SensorNode`):** Modul STM32 per tangki.
  * `id` (`UUID`), `tankId` (`UUID`), `gatewayId` (`UUID`), `deviceCode` (`string`), `sensorType` (`"ultrasonic"`), `status` (`"active"` | `"offline"` | `"error"`), `lastRssi` (`number`), `lastSeen` (`ISO8601`).

### 2.5 Entitas Pengguna (`User`)
| Field | Tipe | Nullable | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` (string) | Tidak | Identifier unik pengguna |
| `username` | `string(50)` | Tidak | Nama akun unik (min 3 karakter) |
| `role` | `string(20)` | Tidak | Hak akses: `"admin"`, `"operator"`, atau `"viewer"` |
| `isActive` | `boolean` | Tidak | Status keaktifan akun (`true` / `false`) |
| `createdAt` | `string(ISO8601)` | Tidak | Tanggal akun dibuat |

### 2.6 Entitas Jejak Audit (`AuditLog`)
| Field | Tipe | Nullable | Keterangan |
| :--- | :--- | :--- | :--- |
| `id` | `number` (bigserial) | Tidak | ID unik log audit |
| `userId` | `UUID` (string) | Ya | ID akun pengguna yang melakukan aksi |
| `action` | `string(50)` | Tidak | Jenis aksi (misal: `"LOGIN"`, `"UPDATE_TANK"`, `"RESOLVE_ALERT"`) |
| `entity` | `string(50)` | Ya | Nama entitas yang terpengaruh (misal: `"tanks"`, `"alerts"`) |
| `entityId` | `string(50)` | Ya | ID data entitas terkait |
| `detail` | `string(text)` | Ya | Deskripsi rincian perubahan data |
| `ipAddress` | `string(45)` | Ya | Alamat IP client |
| `createdAt` | `string(ISO8601)` | Tidak | Waktu aktivitas dilakukan |

---

## 3. Spesifikasi REST API Endpoints

---

### 3.1 Health Check & Status Server
Digunakan oleh frontend atau monitoring tool untuk memastikan backend dan database beroperasi normal.

* **Endpoint:** `GET /health`
* **Autentikasi:** Publik
* **Respons Berhasil (200 OK):**
```json
{
  "status": "healthy",
  "services": {
    "database": "up",
    "redis": "up"
  },
  "websocketClients": 3,
  "timestamp": "2026-09-19T05:30:00.000Z"
}
```

---

### 3.2 List Seluruh Tangki (Dashboard Utama)
Mengambil seluruh daftar tangki beserta pembacaan volume air terakhir, alert aktif (jika ada), dan node sensor terpasang.

* **Endpoint:** `GET /api/tanks`
* **Autentikasi:** Publik / Bearer Token
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
      "name": "Tangki Atap Gedung Utama",
      "location": "Atap Gedung A (Utama), Lantai 5",
      "capacityLiters": "10000.00",
      "minThresholdPercent": "30.00",
      "maxThresholdPercent": "90.00",
      "createdAt": "2026-09-14T06:02:15.123Z",
      "updatedAt": "2026-09-14T06:02:15.123Z",
      "latestReading": {
        "id": 14205,
        "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
        "sensorNodeId": "f12e873b-7412-4211-9a72-b2a1e054231b",
        "levelPercent": "72.40",
        "volumeLiters": "7240.00",
        "rawValue": "812.00",
        "rssi": -78,
        "recordedAt": "2026-09-19T05:35:10.000Z"
      },
      "activeAlert": null,
      "nodes": [
        {
          "id": "f12e873b-7412-4211-9a72-b2a1e054231b",
          "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
          "gatewayId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "deviceCode": "STM32-GEDUNG-A",
          "sensorType": "ultrasonic",
          "status": "active",
          "lastRssi": -78,
          "lastSeen": "2026-09-19T05:35:10.000Z",
          "createdAt": "2026-09-14T06:02:15.123Z"
        }
      ]
    },
    {
      "id": "b18ce432-8411-4770-9b41-923ad90176b2",
      "name": "Tangki Instalasi Bedah Sentral",
      "location": "Gedung IBS Lantai 3",
      "capacityLiters": "5000.00",
      "minThresholdPercent": "35.00",
      "maxThresholdPercent": "90.00",
      "createdAt": "2026-09-14T06:02:15.123Z",
      "updatedAt": "2026-09-14T06:02:15.123Z",
      "latestReading": {
        "id": 14206,
        "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
        "sensorNodeId": "c839f992-9182-4aa3-8821-2a1e80931d87",
        "levelPercent": "24.50",
        "volumeLiters": "1225.00",
        "rawValue": "340.00",
        "rssi": -85,
        "recordedAt": "2026-09-19T05:35:12.000Z"
      },
      "activeAlert": {
        "id": 89,
        "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
        "level": "CRITICAL",
        "message": "Level air tangki Tangki Instalasi Bedah Sentral CRITICAL: 24.5% (di bawah 35%)",
        "status": "active",
        "createdAt": "2026-09-19T05:30:00.000Z",
        "resolvedAt": null
      },
      "nodes": []
    }
  ]
}
```

---

### 3.3 Detail Tangki
Mengambil data detail sebuah tangki, beserta **50 pembacaan terakhir** dan **10 alert terakhir**.

* **Endpoint:** `GET /api/tanks/:id`
* **URL Parameter:** `id` (UUID tangki)
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
    "name": "Tangki Atap Gedung Utama",
    "location": "Atap Gedung A (Utama), Lantai 5",
    "capacityLiters": "10000.00",
    "minThresholdPercent": "30.00",
    "maxThresholdPercent": "90.00",
    "createdAt": "2026-09-14T06:02:15.123Z",
    "updatedAt": "2026-09-14T06:02:15.123Z",
    "recentReadings": [
      {
        "id": 14205,
        "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
        "sensorNodeId": "f12e873b-7412-4211-9a72-b2a1e054231b",
        "levelPercent": "72.40",
        "volumeLiters": "7240.00",
        "rawValue": "812.00",
        "rssi": -78,
        "recordedAt": "2026-09-19T05:35:10.000Z"
      }
    ],
    "recentAlerts": [
      {
        "id": 82,
        "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
        "level": "WARNING",
        "message": "Level air tangki Tangki Atap Gedung Utama WARNING: 45.2% (rentang 30%-60%)",
        "status": "resolved",
        "createdAt": "2026-09-18T14:10:00.000Z",
        "resolvedAt": "2026-09-18T15:40:00.000Z"
      }
    ]
  }
}
```
* **Respons Error (404 Not Found):**
```json
{
  "success": false,
  "message": "Tank not found"
}
```

---

### 3.4 Histori Pembacaan Tangki (Untuk Komponen Grafik Time-Series)
Mengambil deret waktu (*time-series*) ketinggian dan volume air untuk dirender menjadi grafik garis/area di frontend.

* **Endpoint:** `GET /api/tanks/:id/readings`
* **URL Parameter:** `id` (UUID tangki)
* **Query Parameters:**
  * `hours` (`number`, opsional, default: `24`): Rentang jam ke belakang (misal: 12, 24, 48, 168).
  * `limit` (`number`, opsional, default: `1000`): Batas jumlah data point yang diambil.
* **Contoh Request:** `GET /api/tanks/e0a7e584-6091-4560-b6aa-cf4a852875a1/readings?hours=24&limit=500`
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
  "hours": 24,
  "count": 288,
  "data": [
    {
      "id": 13900,
      "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
      "sensorNodeId": "f12e873b-7412-4211-9a72-b2a1e054231b",
      "levelPercent": "85.10",
      "volumeLiters": "8510.00",
      "rawValue": "910.00",
      "rssi": -75,
      "recordedAt": "2026-09-18T05:35:00.000Z"
    },
    {
      "id": 14205,
      "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
      "sensorNodeId": "f12e873b-7412-4211-9a72-b2a1e054231b",
      "levelPercent": "72.40",
      "volumeLiters": "7240.00",
      "rawValue": "812.00",
      "rssi": -78,
      "recordedAt": "2026-09-19T05:35:10.000Z"
    }
  ]
}
```

---

### 3.5 Tambah Master Tangki Baru
Digunakan pada form modal tambah tangki di menu pengaturan/manajemen.

* **Endpoint:** `POST /api/tanks`
* **Request Body (JSON):**
```json
{
  "name": "Tangki Gedung Laboratorium",
  "location": "Gedung Lab Terpadu Lantai 4",
  "capacityLiters": 6000,
  "minThresholdPercent": 30,
  "maxThresholdPercent": 90
}
```
* **Validation Rules:**
  * `name`: string, min 1, max 100 karakter *(Wajib)*
  * `location`: string, max 150 karakter *(Opsional)*
  * `capacityLiters`: number positif *(Wajib)*
  * `minThresholdPercent`: number, 0 - 100 *(Opsional, default 30)*
  * `maxThresholdPercent`: number, 0 - 100 *(Opsional, default 90)*
* **Respons Berhasil (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "c92d548b-3011-4f93-85f2-901d32847a11",
    "name": "Tangki Gedung Laboratorium",
    "location": "Gedung Lab Terpadu Lantai 4",
    "capacityLiters": "6000.00",
    "minThresholdPercent": "30.00",
    "maxThresholdPercent": "90.00",
    "createdAt": "2026-09-19T05:40:00.000Z",
    "updatedAt": "2026-09-19T05:40:00.000Z"
  }
}
```
* **Respons Validasi Gagal (400 Bad Request):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "_errors": [],
    "capacityLiters": {
      "_errors": ["Expected number, received nan"]
    }
  }
}
```

---

### 3.6 Perbarui Data / Batas Threshold Tangki
Digunakan untuk mengedit data tangki atau menyetel ulang batas peringatan kritis/maksimal.

* **Endpoint:** `PATCH /api/tanks/:id`
* **URL Parameter:** `id` (UUID tangki)
* **Request Body (JSON - Seluruh field opsional):**
```json
{
  "name": "Tangki Atap Gedung Utama (Revisi)",
  "capacityLiters": 12000,
  "minThresholdPercent": 25,
  "maxThresholdPercent": 95
}
```
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
    "name": "Tangki Atap Gedung Utama (Revisi)",
    "location": "Atap Gedung A (Utama), Lantai 5",
    "capacityLiters": "12000.00",
    "minThresholdPercent": "25.00",
    "maxThresholdPercent": "95.00",
    "createdAt": "2026-09-14T06:02:15.123Z",
    "updatedAt": "2026-09-19T05:42:00.000Z"
  }
}
```

---

### 3.7 List Peringatan / Log Alert
Menampilkan daftar peringatan dengan filter status penanganan.

* **Endpoint:** `GET /api/alerts`
* **Query Parameters:**
  * `status` (`string`, opsional): `"active"` (hanya peringatan yang masih berlangsung) atau `"resolved"` (riwayat peringatan yang sudah selesai). Jika tidak diisi, mengembalikan seluruh status.
* **Contoh Request:** `GET /api/alerts?status=active`
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": 89,
      "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
      "tankName": "Tangki Instalasi Bedah Sentral",
      "tankLocation": "Gedung IBS Lantai 3",
      "level": "CRITICAL",
      "message": "Level air tangki Tangki Instalasi Bedah Sentral CRITICAL: 24.5% (di bawah 35%)",
      "status": "active",
      "createdAt": "2026-09-19T05:30:00.000Z",
      "resolvedAt": null
    }
  ]
}
```

---

### 3.8 Selesaikan Alert Secara Manual (Acknowledge / Resolve)
Digunakan saat petugas menekan tombol *"Tandai Selesai / Resolve"* pada modal detail alert setelah memeriksa kondisi fisik tangki.

* **Endpoint:** `PATCH /api/alerts/:id/resolve`
* **URL Parameter:** `id` (ID alert integer)
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 89,
    "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
    "level": "CRITICAL",
    "message": "Level air tangki Tangki Instalasi Bedah Sentral CRITICAL: 24.5% (di bawah 35%)",
    "status": "resolved",
    "createdAt": "2026-09-19T05:30:00.000Z",
    "resolvedAt": "2026-09-19T05:45:00.000Z"
  }
}
```
*(Catatan: Endpoint ini otomatis memancarkan event WebSocket `ALERT_RESOLVED` ke seluruh client yang terhubung).*

---

### 3.9 List Gateway LoRa & Node Sensor
Digunakan pada halaman status infrastruktur perangkat / hardware health.

#### A. Data Gateway Pusat
* **Endpoint:** `GET /api/gateways`
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "deviceCode": "GW-HUB-01",
      "status": "online",
      "lastHeartbeat": "2026-09-19T05:44:30.000Z",
      "createdAt": "2026-09-14T06:00:00.000Z",
      "nodesCount": 3,
      "nodes": [
        {
          "id": "f12e873b-7412-4211-9a72-b2a1e054231b",
          "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
          "gatewayId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "deviceCode": "STM32-GEDUNG-A",
          "sensorType": "ultrasonic",
          "status": "active",
          "lastRssi": -78,
          "lastSeen": "2026-09-19T05:44:30.000Z",
          "createdAt": "2026-09-14T06:00:00.000Z"
        }
      ]
    }
  ]
}
```

#### B. Data Seluruh Node Sensor
* **Endpoint:** `GET /api/nodes`
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "f12e873b-7412-4211-9a72-b2a1e054231b",
      "deviceCode": "STM32-GEDUNG-A",
      "sensorType": "ultrasonic",
      "status": "active",
      "lastRssi": -78,
      "lastSeen": "2026-09-19T05:44:30.000Z",
      "tankId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
      "tankName": "Tangki Atap Gedung Utama",
      "gatewayId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "gatewayCode": "GW-HUB-01"
    }
  ]
}
```

---

### 3.10 Autentikasi: Login Pengguna
Digunakan pada form halaman login untuk memverifikasi kredensial dan menerbitkan JWT token.

* **Endpoint:** `POST /api/auth/login`
* **Autentikasi:** Publik
* **Request Body (JSON):**
```json
{
  "username": "admin",
  "password": "password123"
}
```
* **Validation Rules:**
  * `username`: string, minimal 3 karakter *(Wajib)*
  * `password`: string, minimal 6 karakter *(Wajib)*
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "username": "admin",
      "role": "admin"
    }
  }
}
```
* **Respons Gagal (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Username atau password salah"
}
```

---

### 3.11 Autentikasi: Profil Pengguna Aktif
Digunakan oleh aplikasi frontend saat startup untuk mengambil data user yang sedang login dari Bearer Token yang tersimpan.

* **Endpoint:** `GET /api/auth/me`
* **Header Wajib:** `Authorization: Bearer <token>`
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "username": "admin",
    "role": "admin",
    "isActive": true,
    "createdAt": "2026-09-14T06:00:00.000Z"
  }
}
```
* **Respons Token Tidak Valid / Expired (401 Unauthorized):**
```json
{
  "success": false,
  "error": "Unauthorized",
  "message": "Invalid or missing token"
}
```

---

### 3.12 Manajemen Pengguna: Daftar Seluruh Pengguna
Menampilkan daftar akun operator, teknisi, dan admin sistem.

* **Endpoint:** `GET /api/users`
* **Header Wajib:** `Authorization: Bearer <token>` (Khusus role `admin`)
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "username": "admin",
      "role": "admin",
      "isActive": true,
      "createdAt": "2026-09-14T06:00:00.000Z"
    },
    {
      "id": "9a12e345-1234-40de-8899-b12fc2a30bd1",
      "username": "operator_teknik",
      "role": "operator",
      "isActive": true,
      "createdAt": "2026-09-15T08:30:00.000Z"
    }
  ]
}
```

---

### 3.13 Manajemen Pengguna: Tambah Pengguna Baru
Membuat akun operator atau admin baru.

* **Endpoint:** `POST /api/users`
* **Header Wajib:** `Authorization: Bearer <token>` (Khusus role `admin`)
* **Request Body (JSON):**
```json
{
  "username": "operator_shift1",
  "password": "passwordAman123",
  "role": "operator"
}
```
* **Validation Rules:**
  * `username`: string unik, min 3 karakter *(Wajib)*
  * `password`: string, min 6 karakter *(Wajib)*
  * `role`: enum `"admin"` | `"operator"` | `"viewer"` (default: `"operator"`)
* **Respons Berhasil (201 Created):**
```json
{
  "success": true,
  "message": "Pengguna baru berhasil dibuat",
  "data": {
    "id": "3d5f8123-9988-41ab-8877-c33ea9810bb3",
    "username": "operator_shift1",
    "role": "operator",
    "isActive": true,
    "createdAt": "2026-09-19T05:50:00.000Z"
  }
}
```

---

### 3.14 Manajemen Pengguna: Update Status / Role Pengguna
Memperbarui hak akses atau menonaktifkan akun pengguna.

* **Endpoint:** `PATCH /api/users/:id`
* **Header Wajib:** `Authorization: Bearer <token>` (Khusus role `admin`)
* **URL Parameter:** `id` (UUID pengguna)
* **Request Body (JSON):**
```json
{
  "role": "admin",
  "isActive": false
}
```
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "9a12e345-1234-40de-8899-b12fc2a30bd1",
    "username": "operator_teknik",
    "role": "admin",
    "isActive": false
  }
}
```

---

### 3.15 Audit Log: Riwayat Jejak Aktivitas Sistem
Menampilkan catatan kronologis aktivitas pengguna (misal: siapa mengubah threshold tangki, siapa menyelesaikan alert).

* **Endpoint:** `GET /api/audit-logs`
* **Header Wajib:** `Authorization: Bearer <token>` (Admin)
* **Query Parameters:**
  * `page` (`number`, default: `1`): Nomor halaman.
  * `limit` (`number`, default: `50`): Jumlah data per halaman.
  * `entity` (`string`, opsional): Filter entitas (`tanks`, `alerts`, `users`).
* **Respons Berhasil (200 OK):**
```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total": 128,
  "data": [
    {
      "id": 105,
      "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "action": "RESOLVE_ALERT",
      "entity": "alerts",
      "entityId": "89",
      "detail": "Alert level CRITICAL diselesaikan secara manual oleh admin",
      "ipAddress": "192.168.1.45",
      "createdAt": "2026-09-19T05:45:00.000Z"
    },
    {
      "id": 104,
      "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "action": "UPDATE_TANK",
      "entity": "tanks",
      "entityId": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
      "detail": "Mengubah minThresholdPercent dari 30.00 menjadi 25.00",
      "ipAddress": "192.168.1.45",
      "createdAt": "2026-09-19T05:42:00.000Z"
    }
  ]
}
```

---

### 3.16 Export Laporan: Download Riwayat Pembacaan Level Air
Digunakan untuk mengekspor data time-series pembacaan sensor ke format file spreadsheet atau data mentah (CSV / XLSX / PDF).

* **Endpoint:** `GET /api/reports/readings/export`
* **Header Wajib:** `Authorization: Bearer <token>`
* **Query Parameters:**
  * `tankId` (`UUID`, wajib): ID tangki yang ingin diekspor.
  * `startDate` (`string ISO8601`, opsional): Batas awal waktu (misal: `2026-09-01T00:00:00Z`).
  * `endDate` (`string ISO8601`, opsional): Batas akhir waktu.
  * `format` (`string`, default: `"csv"`): Pilihan format file (`csv` | `xlsx` | `pdf`).
* **Respons Berhasil (200 OK):**
  * `Content-Type: text/csv` atau `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  * `Content-Disposition: attachment; filename="readings-tank-a-2026-09.csv"`
  * *Body berupa binary file download stream.*

---

### 3.17 Export Laporan: Download Riwayat Peringatan Alert
Mengekspor rekapitulasi histori peringatan/anomali air untuk kebutuhan audit berkala rumah sakit.

* **Endpoint:** `GET /api/reports/alerts/export`
* **Header Wajib:** `Authorization: Bearer <token>`
* **Query Parameters:**
  * `level` (`string`, opsional): Filter level (`WARNING` | `CRITICAL`).
  * `startDate` (`string ISO8601`, opsional): Waktu awal.
  * `endDate` (`string ISO8601`, opsional): Waktu akhir.
  * `format` (`string`, default: `"csv"`): Pilihan format (`csv` | `xlsx` | `pdf`).
* **Respons Berhasil (200 OK):**
  * File stream download rekap riwayat alert.

---

## 4. Spesifikasi Kontrak WebSocket Realtime

Frontend web dan mobile menghubungkan WebSocket sekali saat aplikasi dibuka ke:
`ws://localhost:8000/ws`

### 4.1 Pesan Sambutan Awal (`CONNECTED`)
Diterima segera setelah handshake WebSocket berhasil:
```json
{
  "type": "CONNECTED",
  "message": "Terhubung ke stream realtime monitoring tangki",
  "timestamp": "2026-09-19T05:45:00.123Z"
}
```

### 4.2 Pembaruan Ketinggian Air Realtime (`LEVEL_UPDATE`)
Dipancarkan setiap kali sensor STM32 mengirimkan data terbaru melalui LoRa/MQTT:
```json
{
  "type": "LEVEL_UPDATE",
  "timestamp": "2026-09-19T05:45:05.000Z",
  "data": {
    "tank_id": "e0a7e584-6091-4560-b6aa-cf4a852875a1",
    "sensor_node_id": "f12e873b-7412-4211-9a72-b2a1e054231b",
    "level_percent": 72.8,
    "volume_liters": 7280,
    "raw_value": 815,
    "rssi": -77,
    "timestamp": "2026-09-19T05:45:05.000Z"
  }
}
```
*Tindakan Frontend:* Perbarui nilai persentase, meteran air animasi (*liquid gauge*), dan titik terbaru pada grafik tanpa perlu reload.

### 4.3 Peringatan Bahaya Baru Muncul (`ALERT_TRIGGERED`)
Dipancarkan saat Warning Engine mendeteksi level air masuk ke ambang `WARNING` (30%–60%) atau `CRITICAL` (<30%):
```json
{
  "type": "ALERT_TRIGGERED",
  "timestamp": "2026-09-19T05:45:10.000Z",
  "data": {
    "id": 90,
    "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
    "level": "CRITICAL",
    "message": "Level air tangki Tangki Instalasi Bedah Sentral CRITICAL: 22.0% (di bawah 35%)",
    "status": "active"
  }
}
```
*Tindakan Frontend:* Munculkan Toast/Banner darurat warna merah/kuning, ubah status warna card tangki menjadi berkedip/merah, dan trigger push notification pada mobile.

### 4.4 Peringatan Selesai (`ALERT_RESOLVED`)
Dipancarkan saat air kembali normal (>60%) atau setelah petugas menekan tombol resolve:
```json
{
  "type": "ALERT_RESOLVED",
  "timestamp": "2026-09-19T05:46:00.000Z",
  "data": {
    "id": 90,
    "tankId": "b18ce432-8411-4770-9b41-923ad90176b2",
    "level": "CRITICAL",
    "message": "Level air tangki Tangki Instalasi Bedah Sentral CRITICAL: 22.0% (di bawah 35%)",
    "status": "resolved",
    "resolvedAt": "2026-09-19T05:46:00.000Z"
  }
}
```
*Tindakan Frontend:* Tutup banner darurat dan kembalikan warna kartu tangki ke warna hijau/normal.

### 4.5 Status Konektivitas Node (`NODE_STATUS`)
Dipancarkan saat status kesehatan node STM32 berubah (misal baterai lemah atau offline):
```json
{
  "type": "NODE_STATUS",
  "timestamp": "2026-09-19T05:46:30.000Z",
  "data": {
    "sensor_node_id": "STM32-GEDUNG-A",
    "status": "offline",
    "battery_level": 15
  }
}
```

---

## 5. Panduan Pemetaan UI (Untuk Desainer Figma & Frontend)

Berdasarkan kontrak di atas, desainer Figma dapat langsung merancang komponen berikut tanpa menunggu lagi:

| Komponen di Layar Figma | Sumber Data API / WebSocket | Elemen Visual yang Harus Digambar |
| :--- | :--- | :--- |
| **Card Tangki (Dashboard)** | `GET /api/tanks` + `LEVEL_UPDATE` | - Judul Tangki & Lokasi Gedung<br>- Progress Bar / Animasi Ketinggian Air (%)<br>- Volume tersisa (Liter) / Kapasitas Total<br>- Icon Sinyal LoRa (`rssi` dBm)<br>- Badge Status: Normal (Hijau), Warning (Kuning), Critical (Merah) |
| **Banner Peringatan Darurat** | `GET /api/alerts?status=active` + `ALERT_TRIGGERED` | - Alert Bar di bagian atas dashboard jika ada alert aktif<br>- Teks pesan peringatan<br>- Tombol cepat "Lihat Detail" / "Acknowledge" |
| **Grafik Fluktuasi Ketinggian Air** | `GET /api/tanks/:id/readings?hours=24` | - Grafik Garis/Area (Sumbu X: Jam/Waktu, Sumbu Y: 0 - 100%)<br>- Garis referensi batas putus-putus merah (`minThresholdPercent`)<br>- Filter rentang waktu (misal: 6 Jam, 12 Jam, 24 Jam, 7 Hari) |
| **Modal Form Tambah/Edit Tangki** | `POST /api/tanks` & `PATCH /api/tanks/:id` | - Input teks: Nama Tangki *(Wajib)*<br>- Input teks: Lokasi Lantai/Gedung *(Opsional)*<br>- Input angka: Kapasitas Liter *(Wajib)*<br>- Input slider/angka: Threshold Minimum & Maksimum (%) |
| **Halaman Infrastruktur / Hardware** | `GET /api/gateways` & `GET /api/nodes` | - Tabel / Kartu Perangkat Hardware<br>- Device Code (Raspberry Pi Gateway & STM32)<br>- Status Badge: `active` / `online` (Hijau), `offline` (Abu-abu), `error` (Merah)<br>- Waktu Terakhir Terlihat (*Last Seen*) |
| **Halaman Login** | `POST /api/auth/login` | - Input Username & Password<br>- Tombol Submit "Masuk"<br>- State error message saat kredensial salah |
| **Navbar / Header Pengguna** | `GET /api/auth/me` | - Nama Akun & Avatar<br>- Badge Role (`Admin` / `Operator`)<br>- Dropdown Menu: Profil, Ganti Password, Logout |
| **Halaman Manajemen Pengguna** | `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` | - Tabel Daftar User (Username, Role, Status Aktif, Tanggal)<br>- Modal Tambah User Baru<br>- Toggle Switch Aktif/Nonaktif Akun |
| **Halaman Audit Logs** | `GET /api/audit-logs` | - Tabel Jejak Audit Kronologis (Waktu, Petugas, Aksi, Entitas, Rincian Perubahan, IP Address)<br>- Filter berdasarkan jenis entitas & pagination |
| **Fitur Export Laporan** | `GET /api/reports/readings/export`, `GET /api/reports/alerts/export` | - Tombol "Export Data" di halaman tangki atau riwayat alert<br>- Modal opsi rentang tanggal & pilihan format (CSV / XLSX / PDF)<br>- Indikator loading download file |


