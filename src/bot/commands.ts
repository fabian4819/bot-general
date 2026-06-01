import { getCurrentSaldo, getMonthlySummary, getWeeklySummary, getCategorySummary, setInitialBalance } from '../sheets/summary'
import { deleteLastTransaction } from '../sheets/append'

function formatRp(amount: number): string {
  return `Rp ${Math.abs(amount).toLocaleString('id-ID')}`
}

function formatSignedRp(amount: number): string {
  return `${amount < 0 ? '-' : ''}${formatRp(amount)}`
}

function parseAmount(text: string): number | null {
  const normalized = text.toLowerCase().replace(/rp/g, '').trim()
  const negative = /\b(minus|negatif)\b|^-/.test(normalized)
  const patterns = [
    { re: /(\d+)[.,](\d+)\s*(jt|juta|j)\b/, multiplier: 1_000_000 },
    { re: /(\d+)\s*(jt|juta|j)\b/, multiplier: 1_000_000 },
    { re: /(\d+)[.,](\d+)\s*(rb|ribu|rbu|k)\b/, multiplier: 1_000 },
    { re: /(\d+)\s*(rb|ribu|rbu|k)\b/, multiplier: 1_000 },
    { re: /(\d{1,3}(?:[.,]\d{3})+)(?![.,]\d)/, multiplier: 1 },
    { re: /\b(\d+)\b/, multiplier: 1 },
  ]

  for (const { re, multiplier } of patterns) {
    const match = normalized.match(re)
    if (!match) continue
    const whole = parseInt(match[1].replace(/[.,]/g, ''))
    const decimal = match[2] ? parseInt(match[2]) / Math.pow(10, match[2].length) : 0
    const amount = (whole + decimal) * multiplier
    if (Number.isFinite(amount)) return negative ? -Math.round(amount) : Math.round(amount)
  }

  return null
}

function formatSummary(label: string, s: Awaited<ReturnType<typeof getMonthlySummary>>): string {
  const sign = s.net >= 0 ? '+' : '-'
  return [
    `📊 *${label}*`,
    `✅ Masuk  : ${formatRp(s.totalMasuk)}`,
    `❌ Keluar : ${formatRp(s.totalKeluar)}`,
    `📈 Net    : ${sign}${formatRp(s.net)}`,
    `💹 Savings: ${(s.savingsRate * 100).toFixed(1)}%`,
  ].join('\n')
}

export async function handleCommand(text: string, spreadsheetId?: string): Promise<string | null> {
  const cmd = text.trim().toLowerCase()

  // /saldo
  if (cmd === '/saldo') {
    const saldo = await getCurrentSaldo(spreadsheetId)
    const sign = saldo >= 0 ? '💚' : '🔴'
    return `${sign} *Saldo Saat Ini*\n${formatSignedRp(saldo)}`
  }

  if (
    cmd.startsWith('/set saldo') ||
    cmd.startsWith('/setsaldo') ||
    cmd.startsWith('/saldo awal')
  ) {
    const amount = parseAmount(cmd)
    if (amount === null) {
      return [
        '⚠️ Nominal saldo belum terbaca.',
        'Contoh:',
        '  /set saldo 1000000',
        '  /set saldo 1jt',
        '  /saldo awal 0',
      ].join('\n')
    }

    await setInitialBalance(amount, spreadsheetId)
    const saldo = await getCurrentSaldo(spreadsheetId)
    return [
      '✅ *Saldo awal diset*',
      `Saldo awal: ${formatSignedRp(amount)}`,
      `Saldo saat ini: ${formatSignedRp(saldo)}`,
    ].join('\n')
  }

  // /laporan atau /laporan bulan ini
  if (cmd === '/laporan' || cmd === '/laporan bulan ini') {
    const now = new Date()
    const label = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' })
    const summary = await getMonthlySummary(undefined, spreadsheetId)
    return formatSummary(label, summary)
  }

  // /laporan minggu ini
  if (cmd === '/laporan minggu ini' || cmd === '/minggu') {
    const summary = await getWeeklySummary(spreadsheetId)
    return formatSummary('7 Hari Terakhir', summary)
  }

  // /laporan bulan lalu
  if (cmd === '/laporan bulan lalu') {
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const label = lastMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })
    const summary = await getMonthlySummary(lastMonth, spreadsheetId)
    return formatSummary(label, summary)
  }

  // /kategori
  if (cmd === '/kategori' || cmd === '/kat') {
    const cats = await getCategorySummary(undefined, spreadsheetId)
    if (cats.length === 0) return '📭 Belum ada pengeluaran bulan ini.'

    const now = new Date()
    const label = now.toLocaleString('id-ID', { month: 'long', year: 'numeric' })
    const lines = cats.map((c, i) => `${i + 1}. ${c.kategori}: ${formatRp(c.total)}`)
    return [`🏷️ *Pengeluaran per Kategori — ${label}*`, ...lines].join('\n')
  }

  // /hapus atau /undo
  if (cmd === '/hapus' || cmd === '/undo') {
    const deleted = await deleteLastTransaction(spreadsheetId)
    if (!deleted) return '⚠️ Tidak ada transaksi yang bisa dihapus.'
    return '🗑️ Transaksi terakhir berhasil dihapus.'
  }

  // /help
  if (cmd === '/help' || cmd === '/bantuan') {
    return [
      '🤖 *Bot Cashflow — Perintah*',
      '',
      '📝 *Catat Transaksi*',
      'Ketik pesan biasa, contoh:',
      '  • "makan siang warteg 15rb"',
      '  • "gaji masuk 5jt"',
      '  • "bayar listrik 450.000"',
      '',
      '📋 *Perintah*',
      '  /saldo — cek saldo saat ini',
      '  /set saldo 1000000 — set saldo awal',
      '  /laporan — rekap bulan ini',
      '  /laporan minggu ini — rekap 7 hari',
      '  /laporan bulan lalu — rekap bulan lalu',
      '  /kategori — breakdown kategori',
      '  /hapus — hapus transaksi terakhir',
      '  /invoice — buat invoice baru',
      '  /help — tampilkan perintah ini',
    ].join('\n')
  }

  return null  // not a command
}
