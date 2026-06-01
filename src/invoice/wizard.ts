import { InvoiceData, InvoiceItem } from './types'
import { nextInvoiceNumber, peekInvoiceNumber } from './counter'
import { generateInvoice } from './generator'

function formatDate(date: Date, tz: string): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: tz,
  }).toUpperCase()
}

function formatDateTitleCase(date: Date, tz: string): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: tz,
  })
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function parseRateInput(text: string): number | null {
  const lower = text.toLowerCase().replace(/[,\s]/g, '')
  const jt = lower.match(/^(\d+(?:\.\d+)?)(jt|juta)$/)
  if (jt) return Math.round(parseFloat(jt[1]) * 1_000_000)
  const rb = lower.match(/^(\d+(?:\.\d+)?)(rb|ribu|k)$/)
  if (rb) return Math.round(parseFloat(rb[1]) * 1_000)
  const plain = lower.match(/^[\d.]+$/)
  if (plain) return parseInt(lower.replace(/\./g, ''))
  return null
}

export function invoiceHelp(): string {
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const now = new Date()
  const nextNo = peekInvoiceNumber()
  return [
    `🧾 *Buat Invoice — ${nextNo}*`,
    ``,
    `Kirim dalam *1 pesan* dengan format:`,
    ``,
    `\`\`\``,
    `/invoice`,
    `[nama klien]`,
    `[nama campaign]`,
    `[item] | [deskripsi] | [qty] | [rate]`,
    `[item 2] | [deskripsi] | [qty] | [rate]`,
    `\`\`\``,
    ``,
    `*Contoh:*`,
    `\`\`\``,
    `/invoice`,
    `Pintarnya`,
    `Pigeon May`,
    `Pigeon Nano | 1x VT + IG Reels | 17 | 150rb`,
    `Pigeon Micro | 1x VT + IG Reels | 15 | 250000`,
    `\`\`\``,
    ``,
    `Due date otomatis *${formatDate(addDays(now, 7), tz)}*`,
  ].join('\n')
}

export async function parseAndGenerateInvoice(body: string): Promise<{ reply: string; filePath?: string }> {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean).slice(1)

  if (lines.length < 3) {
    return {
      reply: [
        `❌ Format tidak lengkap. Minimal:`,
        `  - Nama klien`,
        `  - Nama campaign`,
        `  - 1 item (nama | deskripsi | qty | rate)`,
      ].join('\n'),
    }
  }

  const [billTo, campaign, ...itemLines] = lines

  const items: InvoiceItem[] = []
  for (const line of itemLines) {
    const parts = line.split('|').map(p => p.trim())
    if (parts.length < 4) {
      return { reply: `❌ Format item salah: "${line}"\nHarus: nama | deskripsi | qty | rate` }
    }
    const [name, description, qtyStr, rateStr] = parts
    const qty = parseInt(qtyStr.replace(/\D/g, ''))
    const rate = parseRateInput(rateStr)
    if (isNaN(qty) || qty <= 0) {
      return { reply: `❌ Qty tidak valid: "${qtyStr}"` }
    }
    if (!rate) {
      return { reply: `❌ Rate tidak valid: "${rateStr}"\nContoh: 150000, 150rb, 1.5jt` }
    }
    items.push({ name, description, qty, rate })
  }

  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const now = new Date()

  const invoiceNo = nextInvoiceNumber()
  const data: InvoiceData = {
    invoiceNo,
    issueDate: formatDate(now, tz),
    dueDate: formatDateTitleCase(addDays(now, 7), tz),
    billTo,
    campaign,
    items,
  }

  const total = items.reduce((s, i) => s + i.qty * i.rate, 0)
  const summary = items
    .map(i => `   • ${i.name}: ${i.qty} × Rp${i.rate.toLocaleString('id-ID')} = Rp${(i.qty * i.rate).toLocaleString('id-ID')}`)
    .join('\n')

  try {
    const filePath = await generateInvoice(data)
    return {
      reply: [
        `✅ Invoice *${invoiceNo}* dibuat!`,
        ``,
        `📋 *${campaign}*`,
        `👤 ${billTo}`,
        summary,
        `💰 Total: *Rp${total.toLocaleString('id-ID')}*`,
      ].join('\n'),
      filePath,
    }
  } catch (err) {
    console.error('[Invoice] Generate error:', err)
    return { reply: `❌ Gagal generate invoice: ${(err as Error).message}` }
  }
}
