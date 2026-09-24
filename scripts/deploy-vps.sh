#!/bin/bash
set -e

echo "=================================================="
echo " Deployment Backend Monitoring Tanki RSA UGM "
echo "=================================================="

# 1. Pastikan .env tersedia
if [ ! -f .env ]; then
  echo "File .env tidak ditemukan, menyalin dari .env.example..."
  cp .env.example .env
fi

# 2. Jalankan container Docker
echo "Menjalankan container dengan docker compose..."
docker compose up -d

# Tunggu database siap
echo "Menunggu database TimescaleDB siap..."
sleep 5

# 3. Install dependencies & build aplikasi
echo "Menginstall dependencies dan build TypeScript..."
npm ci
npm run build

# 4. Sinkronisasi database & seeding
echo "Mendorong skema Drizzle ke TimescaleDB..."
npm run db:push

echo "Inisialisasi tabel hypertable & data awal..."
npm run init-db

# 5. Jalankan aplikasi via PM2 jika PM2 terinstall
if command -v pm2 &> /dev/null; then
  echo "Menjalankan / me-restart aplikasi dengan PM2..."
  pm2 restart rsa-tank-backend || pm2 start dist/index.js --name "rsa-tank-backend"
  pm2 save
  echo "Aplikasi aktif di PM2. Status:"
  pm2 status
else
  echo "PM2 tidak ditemukan. Menjalankan langsung dengan node dist/index.js..."
  node dist/index.js
fi

echo "=================================================="
echo " Deployment selesai! "
echo "=================================================="
