import { getSheetsClient, getSpreadsheetId } from './client'
import { MonthlySummary, CategorySummary } from '../types'

// Google Sheets stores dates as serial numbers (days since Dec 30, 1899)
function sheetDateToDate(value: string | number): Date {
  if (typeof value === 'number') {
    return new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000)
  }
  return new Date(value)
}

async function getInitialBalance(spreadsheetId = getSpreadsheetId()): Promise<number> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Pengaturan!B4',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  return Number(res.data.values?.[0]?.[0] || 0)
}

export async function setInitialBalance(amount: number, spreadsheetId = getSpreadsheetId()): Promise<void> {
  const sheets = getSheetsClient()
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Pengaturan!B4',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[amount]] },
  })
}

// Reads all transactions from columns B (date), C (tipe), D (kategori), F (nominal)
async function getAllTransactions(spreadsheetId = getSpreadsheetId()): Promise<{ tanggal: string | number; tipe: string; kategori: string; nominal: number }[]> {
  const sheets = getSheetsClient()

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Transaksi!B:F',
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  const rows = res.data.values || []
  const result = []

  for (let i = 1; i < rows.length; i++) {
    const [tanggal, tipe, kategori, , nominal] = rows[i]
    if (!tanggal || !tipe || !nominal) continue
    result.push({ tanggal: tanggal, tipe: String(tipe), kategori: String(kategori || 'Lainnya'), nominal: Number(nominal) })
  }

  return result
}

export async function getCurrentSaldo(spreadsheetId = getSpreadsheetId()): Promise<number> {
  const [initialBalance, txs] = await Promise.all([
    getInitialBalance(spreadsheetId),
    getAllTransactions(spreadsheetId),
  ])

  return txs.reduce((saldo, tx) => {
    return tx.tipe === 'Pemasukan' ? saldo + tx.nominal : saldo - tx.nominal
  }, initialBalance)
}

export async function getMonthlySummary(date?: Date, spreadsheetId = getSpreadsheetId()): Promise<MonthlySummary> {
  const ref = date || new Date()
  const year = ref.getFullYear()
  const month = ref.getMonth() + 1

  const txs = await getAllTransactions(spreadsheetId)

  let totalMasuk = 0
  let totalKeluar = 0

  for (const tx of txs) {
    const d = sheetDateToDate(tx.tanggal)
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue
    if (tx.tipe === 'Pemasukan') totalMasuk += tx.nominal
    else if (tx.tipe === 'Pengeluaran') totalKeluar += tx.nominal
  }

  const net = totalMasuk - totalKeluar
  const savingsRate = totalMasuk > 0 ? net / totalMasuk : 0

  return { totalMasuk, totalKeluar, net, savingsRate }
}

export async function getWeeklySummary(spreadsheetId = getSpreadsheetId()): Promise<MonthlySummary> {
  const txs = await getAllTransactions(spreadsheetId)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  let totalMasuk = 0
  let totalKeluar = 0

  for (const tx of txs) {
    if (sheetDateToDate(tx.tanggal) < weekAgo) continue
    if (tx.tipe === 'Pemasukan') totalMasuk += tx.nominal
    else if (tx.tipe === 'Pengeluaran') totalKeluar += tx.nominal
  }

  const net = totalMasuk - totalKeluar
  const savingsRate = totalMasuk > 0 ? net / totalMasuk : 0

  return { totalMasuk, totalKeluar, net, savingsRate }
}

export async function getCategorySummary(date?: Date, spreadsheetId = getSpreadsheetId()): Promise<CategorySummary[]> {
  const ref = date || new Date()
  const year = ref.getFullYear()
  const month = ref.getMonth() + 1

  const txs = await getAllTransactions(spreadsheetId)
  const totals: Record<string, number> = {}

  for (const tx of txs) {
    if (tx.tipe !== 'Pengeluaran') continue
    const d = sheetDateToDate(tx.tanggal)
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue
    totals[tx.kategori] = (totals[tx.kategori] || 0) + tx.nominal
  }

  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([kategori, total]) => ({ kategori, total }))
}
