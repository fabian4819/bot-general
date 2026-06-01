import 'dotenv/config'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import { SHEET_NAMES, SheetIds, buildFormatRequests, buildChartRequests } from '../src/sheets/template'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
]

async function main() {
  const jsonPath = path.join(process.cwd(), 'credentials', 'google-service-account.json')
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ File tidak ditemukan: credentials/google-service-account.json')
    process.exit(1)
  }

  const credentials = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  console.log(`🔑 Service account: ${credentials.client_email}`)

  const spreadsheetId = process.env.SPREADSHEET_ID
  if (!spreadsheetId) {
    console.error('\n❌ SPREADSHEET_ID belum diset di .env')
    console.error('\nLangkah:')
    console.error('  1. Buka sheets.google.com → buat spreadsheet baru kosong')
    console.error(`  2. Share ke: ${credentials.client_email} (Editor)`)
    console.error('  3. Copy ID dari URL dan tambahkan ke .env: SPREADSHEET_ID=...')
    process.exit(1)
  }

  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
  const sheets = google.sheets({ version: 'v4', auth })

  // 1. Get existing sheets
  console.log('🔐 Memverifikasi akses ke spreadsheet...')
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  let existingSheets = (meta.data.sheets || []).map(s => ({
    id: s.properties?.sheetId as number,
    title: s.properties?.title ?? '',
  }))
  console.log(`✅ Akses OK: "${meta.data.properties?.title}"`)
  console.log(`   Sheets saat ini: ${existingSheets.map(s => s.title).join(', ')}`)

  // 2. Rename default sheet if needed, add missing sheets
  const addRequests: any[] = []
  const needed = Object.values(SHEET_NAMES)

  for (const title of needed) {
    if (!existingSheets.find(s => s.title === title)) {
      // If there's a generic default sheet, rename it to the first needed name
      const defaultSheet = existingSheets.find(
        s => !needed.includes(s.title as any) && addRequests.length === 0
      )
      if (defaultSheet) {
        addRequests.push({
          updateSheetProperties: {
            properties: { sheetId: defaultSheet.id, title },
            fields: 'title',
          },
        })
        // Mark it as used
        defaultSheet.title = title
      } else {
        addRequests.push({ addSheet: { properties: { title } } })
      }
    }
  }

  if (addRequests.length > 0) {
    console.log('📋 Menyiapkan sheets...')
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    })
    console.log('✅ Sheets siap')
  }

  // 3. Fetch actual sheet IDs after setup
  const finalMeta = await sheets.spreadsheets.get({ spreadsheetId })
  const finalSheets = (finalMeta.data.sheets || []).map(s => ({
    id: s.properties?.sheetId as number,
    title: s.properties?.title ?? '',
  }))

  const ids: SheetIds = {
    dashboard:    finalSheets.find(s => s.title === SHEET_NAMES.dashboard)!.id,
    transaksi:    finalSheets.find(s => s.title === SHEET_NAMES.transaksi)!.id,
    rekapBulanan: finalSheets.find(s => s.title === SHEET_NAMES.rekapBulanan)!.id,
    kategori:     finalSheets.find(s => s.title === SHEET_NAMES.kategori)!.id,
    pengaturan:   finalSheets.find(s => s.title === SHEET_NAMES.pengaturan)!.id,
  }
  console.log('📌 Sheet IDs:', ids)

  // 4. Set locale to en_US so comma-separated formulas work correctly
  console.log('🌐 Setting locale ke en_US...')
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateSpreadsheetProperties: {
          properties: { locale: 'en_US' },
          fields: 'locale',
        },
      }],
    },
  })
  console.log('✅ Locale selesai')

  // 5. Apply formatting, headers, formulas
  console.log('🎨 Menerapkan template dan formatting...')
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: buildFormatRequests(ids) },
  })
  console.log('✅ Formatting selesai')

  // 5. Add charts
  console.log('📈 Menambahkan charts...')
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: buildChartRequests(ids) },
    })
    console.log('✅ Charts ditambahkan')
  } catch (err) {
    console.warn('⚠️  Chart gagal (bisa ditambah manual):', (err as Error).message)
  }

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
  console.log('\n✅ Setup selesai!')
  console.log(`\n📎 Link spreadsheet: ${url}`)
  console.log('\n📌 Langkah selanjutnya:')
  console.log('  1. npm run dev')
  console.log('  2. Scan QR code dengan WhatsApp')
  console.log('  3. Kirim pesan ke diri sendiri: "makan siang 25rb"')
}

main().catch(err => {
  console.error('❌ Setup error:', err.message || err)
  if (err.errors) console.error('Detail:', JSON.stringify(err.errors, null, 2))
  process.exit(1)
})
