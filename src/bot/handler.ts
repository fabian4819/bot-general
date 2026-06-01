import fs from 'fs'
import { parseMessage } from '../parser/regex'
import { parseWithAI } from '../parser/ai'
import { appendTransaction } from '../sheets/append'
import { getOrCreateUserSpreadsheet } from '../sheets/userRegistry'
import { handleCommand } from './commands'
import { invoiceHelp, parseAndGenerateInvoice } from '../invoice/wizard'
import { Transaction } from '../types'

function formatRp(amount: number): string {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

function buildTransaction(
  parsed: NonNullable<ReturnType<typeof parseMessage>['transaction']>
): Transaction {
  const now = new Date()
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const timestamp = now.toLocaleString('id-ID', { timeZone: tz, hour12: false }).replace(/\//g, '-')
  const tanggal = now.toLocaleDateString('sv-SE', { timeZone: tz })
  return {
    timestamp, tanggal,
    tipe: parsed.tipe, kategori: parsed.kategori,
    deskripsi: parsed.deskripsi, nominal: parsed.nominal,
    source: 'WhatsApp',
  }
}

function withSpreadsheetNotice(reply: string, created: boolean, fallback: boolean, spreadsheetUrl: string): string {
  if (!created && !fallback) return reply
  if (fallback) {
    return [
      reply,
      '',
      `⚠️ Spreadsheet pribadi belum bisa dibuat otomatis, sementara dicatat ke spreadsheet default: ${spreadsheetUrl}`,
    ].join('\n')
  }

  return [
    reply,
    '',
    `📊 Spreadsheet cashflow kamu dibuat: ${spreadsheetUrl}`,
  ].join('\n')
}

function commandNeedsSpreadsheet(cmd: string): boolean {
  return [
    '/saldo',
    '/set saldo',
    '/setsaldo',
    '/saldo awal',
    '/laporan',
    '/laporan bulan ini',
    '/laporan minggu ini',
    '/minggu',
    '/laporan bulan lalu',
    '/kategori',
    '/kat',
    '/hapus',
    '/undo',
  ].some(command => cmd === command || cmd.startsWith(`${command} `))
}

export type HandlerResult = {
  text: string
  document?: Buffer
  documentFileName?: string
  documentMimetype?: string
}

export async function handleMessage(text: string, jid: string): Promise<HandlerResult> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '' }

  // ── Slash commands ───────────────────────────────────────────────────────────
  if (trimmed.startsWith('/')) {
    const firstLine = trimmed.split('\n')[0].toLowerCase().trim()

    // Invoice: /invoice alone → show guide, /invoice with data → generate
    if (firstLine === '/invoice' || firstLine === '/inv') {
      if (!trimmed.includes('\n')) {
        return { text: invoiceHelp() }
      }
      const { reply, filePath } = await parseAndGenerateInvoice(trimmed)
      if (filePath) {
        return {
          text: reply,
          document: fs.readFileSync(filePath),
          documentFileName: filePath.split('/').pop(),
          documentMimetype: 'application/pdf',
        }
      }
      return { text: reply }
    }

    if (!commandNeedsSpreadsheet(firstLine)) {
      const reply = await handleCommand(trimmed)
      if (reply) return { text: reply }
      return { text: `❓ Perintah tidak dikenal. Ketik /help untuk daftar perintah.` }
    }

    const sheet = await getOrCreateUserSpreadsheet(jid)
    const reply = await handleCommand(trimmed, sheet.record.spreadsheetId)
    if (reply) {
      return {
        text: withSpreadsheetNotice(reply, sheet.created, sheet.fallback, sheet.record.spreadsheetUrl),
      }
    }
    return { text: `❓ Perintah tidak dikenal. Ketik /help untuk daftar perintah.` }
  }

  // ── Cashflow transaction ─────────────────────────────────────────────────────
  let result = parseMessage(trimmed)

  if (!result.success) {
    console.log(`[Parser] Regex failed ("${trimmed}"), trying AI...`)
    result = await parseWithAI(trimmed)
  }

  if (!result.success || !result.transaction) {
    return { text: `❓ Tidak terdeteksi sebagai transaksi. Ketik /help untuk contoh format.` }
  }

  const tx = buildTransaction(result.transaction)
  const sheet = await getOrCreateUserSpreadsheet(jid)
  await appendTransaction(tx, sheet.record.spreadsheetId)

  const emoji = tx.tipe === 'Pemasukan' ? '✅' : '💸'
  const label = tx.tipe === 'Pemasukan' ? 'Pemasukan' : 'Pengeluaran'

  return {
    text: [
      `${emoji} *${label} dicatat!*`,
      `💰 ${formatRp(tx.nominal)}`,
      `🏷️ ${tx.kategori}`,
      `📝 ${tx.deskripsi}`,
      ...(sheet.created ? ['', `📊 Spreadsheet cashflow kamu dibuat: ${sheet.record.spreadsheetUrl}`] : []),
      ...(sheet.fallback ? ['', `⚠️ Spreadsheet pribadi belum bisa dibuat otomatis, sementara dicatat ke spreadsheet default: ${sheet.record.spreadsheetUrl}`] : []),
    ].join('\n'),
  }
}
