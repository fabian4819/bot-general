# WhatsApp Cashflow Tracker Bot — Implementation Plan

## Overview

Bot WhatsApp personal yang mendeteksi pesan pemasukan/pengeluaran, lalu otomatis mencatat ke Google Sheets dengan visualisasi laporan keuangan yang lengkap.

---

## Architecture

```
User (WhatsApp)
      │
      │ chat: "makan siang 45rb" / "gaji masuk 5jt"
      ▼
┌─────────────────┐
│  Baileys WA     │  ← unofficial WA client (WebSocket, no API key needed)
│  (Node.js)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Message Parser │  ← regex + DeepSeek AI fallback untuk parsing natural language
│  (NLP Engine)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Google Sheets  │  ← googleapis SDK, append row + update formula
│  API v4         │
└─────────────────┘
```

---

## Tech Stack

| Layer | Choice | Alasan |
|-------|--------|--------|
| WhatsApp Client | [Baileys](https://github.com/WhiskeySockets/Baileys) | Free, no approval needed, personal use, aktif dimaintain |
| Runtime | Node.js 20 LTS | Ecosystem terbaik untuk Baileys |
| Language | TypeScript | Type safety, lebih maintainable |
| Spreadsheet | Google Sheets API v4 | Free, collaborative, built-in charting |
| AI Parser | DeepSeek API (deepseek-chat) | Sangat murah, context window besar, bagus untuk bahasa Indonesia |
| Scheduler | node-cron | Weekly/monthly summary otomatis |
| Deployment | PM2 + VPS (atau local machine) | Persistent process |

---

## Project Structure

```
bot-cashflow/
├── src/
│   ├── index.ts              # entry point, init WA connection
│   ├── bot/
│   │   ├── handler.ts        # route incoming messages
│   │   └── commands.ts       # /laporan, /saldo, /kategori
│   ├── parser/
│   │   ├── regex.ts          # fast path: regex patterns
│   │   └── ai.ts             # slow path: DeepSeek API fallback
│   ├── sheets/
│   │   ├── client.ts         # Google Sheets auth + client
│   │   ├── append.ts         # append transaction row
│   │   ├── summary.ts        # query summary data
│   │   └── template.ts       # setup initial sheet template
│   ├── scheduler/
│   │   └── reports.ts        # weekly/monthly auto report
│   └── types.ts              # Transaction, ParseResult, etc.
├── credentials/
│   └── google-service-account.json   # gitignored
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── PLAN.md
```

---

## Phase 1 — Core Bot (Week 1)

### 1.1 Setup WhatsApp Connection (Baileys)
- Init session dengan QR code scan sekali
- Simpan session ke file (`auth_info_baileys/`) agar tidak perlu scan ulang
- Listen event `messages.upsert`
- Filter: hanya proses pesan dari nomor sendiri (self-chat) ATAU dari grup tertentu

### 1.2 Message Parser

**Regex Fast Path** — handle 80% kasus umum:
```
Pattern pemasukan: /(terima|dapat|masuk|gaji|transfer masuk|income)\s*([\d.,]+[rbjt]?k?)/i
Pattern pengeluaran: /(beli|bayar|makan|bensin|keluar|spend)\s*([\d.,]+[rbjt]?k?)/i
Nominal parser: "45rb" → 45000, "1.5jt" → 1500000, "2,5jt" → 2500000
```

**DeepSeek AI Fallback** — untuk kalimat ambigu:
- Model: `deepseek-chat` via OpenAI-compatible API (`https://api.deepseek.com`)
- Prompt: ekstrak type (in/out), amount (number), category, description
- Hanya dipanggil jika regex tidak match
- Response JSON structured (pakai `response_format: { type: "json_object" }`)

**Format pesan yang didukung:**
```
"makan siang warteg 12rb"           → pengeluaran, makanan, 12000
"bayar listrik 450.000"             → pengeluaran, utilitas, 450000
"gaji masuk 8jt"                    → pemasukan, gaji, 8000000
"dapat freelance 2,5jt"             → pemasukan, freelance, 2500000
"transfer ke tabungan 1jt"          → pengeluaran, tabungan, 1000000
"/saldo"                            → command: tampilkan saldo
"/laporan bulan ini"                → command: kirim summary
```

### 1.3 Google Sheets Client
- Auth via Service Account (tidak perlu OAuth per-user)
- Buat spreadsheet baru via API jika belum ada
- Simpan Spreadsheet ID di `.env`

---

## Phase 2 — Spreadsheet Template (Week 1-2)

### Sheet Structure (5 sheets):

#### Sheet 1: `📊 Dashboard`
- Kartu saldo hari ini (formula)
- Grafik pemasukan vs pengeluaran bulan ini (bar chart)
- Grafik pengeluaran per kategori (pie chart)
- Top 5 kategori terbesar bulan ini

#### Sheet 2: `📝 Transaksi`
| Kolom | Keterangan |
|-------|------------|
| Timestamp | Auto: datetime |
| Tanggal | Date saja (untuk grouping) |
| Tipe | Pemasukan / Pengeluaran |
| Kategori | Makanan, Transport, dll |
| Deskripsi | Teks asli dari pesan |
| Nominal | Number |
| Saldo | Running balance (formula) |
| Source | "WhatsApp" |

#### Sheet 3: `📅 Rekap Bulanan`
- Auto-generated via formula SUMIFS
- Kolom: Bulan, Total Masuk, Total Keluar, Net, % Savings Rate
- Grafik trend 12 bulan

#### Sheet 4: `🏷️ Kategori`
- Master list kategori dengan ikon
- Budget per kategori (input manual)
- Aktual vs budget (formula + conditional formatting merah/hijau)

#### Sheet 5: `⚙️ Pengaturan`
- Nama bot
- Nomor WhatsApp yang dimonitor
- Default kategori jika tidak terdeteksi
- Saldo awal

### Kategori Default:
```
Pemasukan: Gaji, Freelance, Bisnis, Investasi, Hadiah, Lainnya
Pengeluaran: Makanan, Transport, Belanja, Utilitas, Kesehatan,
             Hiburan, Pendidikan, Tabungan, Investasi, Lainnya
```

---

## Phase 3 — Bot Commands (Week 2)

| Command | Response |
|---------|----------|
| `/saldo` | "Saldo saat ini: Rp 4.250.000" |
| `/laporan` | Summary bulan ini: masuk/keluar/net |
| `/laporan minggu ini` | Summary 7 hari terakhir |
| `/kategori` | Breakdown per kategori bulan ini |
| `/hapus` | Hapus transaksi terakhir (dengan konfirmasi) |
| `/undo` | Alias hapus |
| `/help` | Daftar perintah |

---

## Phase 4 — Auto Reports (Week 2)

Via `node-cron`:
- **Harian (21:00)**: "Hari ini keluar Rp X, masuk Rp Y"
- **Mingguan (Minggu 20:00)**: Rekap 7 hari + top kategori
- **Bulanan (tgl 1, 08:00)**: Laporan lengkap bulan lalu

---

## Environment Variables

```env
# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
SPREADSHEET_ID=...               # diisi setelah sheet dibuat

# DeepSeek API (optional, untuk AI parser fallback)
DEEPSEEK_API_KEY=...

# Bot Config
OWNER_PHONE=628xxxxxxxxxx        # nomor yang boleh berinteraksi
SESSION_PATH=./auth_info_baileys
TIMEZONE=Asia/Jakarta
```

---

## Google Sheets Setup (One-time)

1. Buat project di Google Cloud Console
2. Enable Google Sheets API + Google Drive API
3. Buat Service Account → download JSON key
4. Jalankan `npm run setup-sheets` → akan buat spreadsheet baru dengan template lengkap
5. Share spreadsheet ke email service account
6. Copy Spreadsheet ID ke `.env`

---

## Security Considerations

- **Whitelist nomor**: bot hanya proses pesan dari `OWNER_PHONE`, abaikan semua pesan lain
- **Credentials gitignored**: `.env` dan `credentials/` masuk `.gitignore`
- **Session encryption**: Baileys mengenkripsi session secara default
- **Rate limiting**: max 1 Google Sheets write per 3 detik untuk hindari quota limit

---

## Implementation Order

```
[x] 1. Setup project (TypeScript, dependencies)
[ ] 2. Google Sheets client + setup-sheets script
[ ] 3. Spreadsheet template (5 sheets + formatting + charts)
[ ] 4. Baileys WA connection + session persistence
[ ] 5. Regex parser (nominal parser Indonesia)
[ ] 6. Append transaction ke sheet
[ ] 7. Bot reply confirmation
[ ] 8. Commands (/saldo, /laporan, /hapus)
[ ] 9. DeepSeek AI fallback parser
[ ] 10. Auto-report scheduler
[ ] 11. Deploy dengan PM2
```

---

## Dependencies

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.x",
    "googleapis": "^144.x",
    "openai": "^4.x",                  // DeepSeek pakai OpenAI-compatible API
    "node-cron": "^3.x",
    "dotenv": "^16.x",
    "qrcode-terminal": "^0.12.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "tsx": "^4.x"
  }
}
```

---

## Spreadsheet Visualization Plan

### Dashboard Charts (via Google Sheets built-in):
1. **Bar chart**: Pemasukan vs Pengeluaran per bulan (12 bulan terakhir)
2. **Pie chart**: Breakdown kategori pengeluaran bulan ini
3. **Line chart**: Trend saldo harian bulan ini
4. **Stacked bar**: Komposisi pengeluaran per minggu

### Conditional Formatting:
- Saldo negatif → merah
- Savings rate > 20% → hijau, < 10% → merah
- Pengeluaran melebihi budget kategori → highlight oranye

---

## Estimated Timeline

| Week | Deliverable |
|------|-------------|
| 1 | WA bot running + basic parser + append ke sheet |
| 2 | Spreadsheet template lengkap + commands + AI parser |
| 3 | Auto reports + polish + deploy PM2 |
