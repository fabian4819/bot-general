import fs from 'fs'
import { parseMessage } from '../parser/regex'
import { parseWithAI } from '../parser/ai'
import { appendTransaction } from '../sheets/append'
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

    const reply = await handleCommand(trimmed)
    if (reply) return { text: reply }
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
  await appendTransaction(tx)

  const emoji = tx.tipe === 'Pemasukan' ? '✅' : '💸'
  const label = tx.tipe === 'Pemasukan' ? 'Pemasukan' : 'Pengeluaran'

  return {
    text: [
      `${emoji} *${label} dicatat!*`,
      `💰 ${formatRp(tx.nominal)}`,
      `🏷️ ${tx.kategori}`,
      `📝 ${tx.deskripsi}`,
    ].join('\n'),
  }
}
