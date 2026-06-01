import cron from 'node-cron'
import { getMonthlySummary, getWeeklySummary, getCategorySummary, getCurrentSaldo } from '../sheets/summary'

type SendFn = (text: string) => Promise<void>

function formatRp(amount: number): string {
  return `Rp ${Math.abs(amount).toLocaleString('id-ID')}`
}

async function sendDailyReport(send: SendFn): Promise<void> {
  const now = new Date()
  const summary = await getMonthlySummary()
  const saldo = await getCurrentSaldo()

  const hari = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
  const sign = summary.net >= 0 ? '📈' : '📉'

  await send([
    `🌙 *Rekap Harian — ${hari}*`,
    ``,
    `💳 Saldo    : ${formatRp(saldo)}`,
    `✅ Masuk    : ${formatRp(summary.totalMasuk)}`,
    `❌ Keluar   : ${formatRp(summary.totalKeluar)}`,
    `${sign} Net bulan : ${summary.net >= 0 ? '+' : '-'}${formatRp(summary.net)}`,
  ].join('\n'))
}

async function sendWeeklyReport(send: SendFn): Promise<void> {
  const weekly = await getWeeklySummary()
  const cats = await getCategorySummary()
  const top3 = cats.slice(0, 3).map(c => `  • ${c.kategori}: ${formatRp(c.total)}`).join('\n')

  await send([
    `📊 *Rekap Mingguan (7 Hari Terakhir)*`,
    ``,
    `✅ Masuk  : ${formatRp(weekly.totalMasuk)}`,
    `❌ Keluar : ${formatRp(weekly.totalKeluar)}`,
    `📈 Net    : ${weekly.net >= 0 ? '+' : '-'}${formatRp(weekly.net)}`,
    ``,
    `🏷️ *Top Pengeluaran:*`,
    top3 || '  Belum ada data',
  ].join('\n'))
}

async function sendMonthlyReport(send: SendFn): Promise<void> {
  const now = new Date()
  // Get last month
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const label = lastMonth.toLocaleString('id-ID', { month: 'long', year: 'numeric' })

  const summary = await getMonthlySummary(lastMonth)
  const cats = await getCategorySummary(lastMonth)
  const catLines = cats.map(c => `  • ${c.kategori}: ${formatRp(c.total)}`).join('\n')

  const sign = summary.net >= 0 ? '🟢' : '🔴'

  await send([
    `📅 *Laporan Bulanan — ${label}*`,
    ``,
    `✅ Total Masuk  : ${formatRp(summary.totalMasuk)}`,
    `❌ Total Keluar : ${formatRp(summary.totalKeluar)}`,
    `${sign} Net           : ${summary.net >= 0 ? '+' : '-'}${formatRp(summary.net)}`,
    `💹 Savings Rate : ${(summary.savingsRate * 100).toFixed(1)}%`,
    ``,
    `🏷️ *Pengeluaran per Kategori:*`,
    catLines || '  Tidak ada data',
  ].join('\n'))
}

export function startScheduler(send: SendFn): void {
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'

  // Daily report at 21:00
  cron.schedule('0 21 * * *', () => {
    sendDailyReport(send).catch(err => console.error('[Scheduler] Daily error:', err))
  }, { timezone: tz })

  // Weekly report every Sunday at 20:00
  cron.schedule('0 20 * * 0', () => {
    sendWeeklyReport(send).catch(err => console.error('[Scheduler] Weekly error:', err))
  }, { timezone: tz })

  // Monthly report on 1st of each month at 08:00
  cron.schedule('0 8 1 * *', () => {
    sendMonthlyReport(send).catch(err => console.error('[Scheduler] Monthly error:', err))
  }, { timezone: tz })

  console.log('[Scheduler] Started: daily 21:00, weekly Sun 20:00, monthly 1st 08:00')
}
