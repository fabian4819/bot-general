import { InvoiceData, InvoiceItem } from './types'
import { nextInvoiceNumber, peekInvoiceNumber } from './counter'
import { generateInvoice } from './generator'
import { appendInvoiceLog } from './log'

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
  if (lower === '0' || lower === 'free' || lower === 'gratis') return 0
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
    `[item] | [deskripsi] | [qty/-] | [rate/-]`,
    `[item 2] | [deskripsi] | [qty/-] | [rate/-]`,
    `\`\`\``,
    ``,
    `*Contoh:*`,
    `\`\`\``,
    `/invoice`,
    `Pintarnya`,
    `Pigeon May`,
    `Pigeon Nano | 1x VT + IG Reels | 17 | 150rb`,
    `Pigeon Micro | 1x VT + IG Reels | - | 150rb`,
    `Pigeon Mini | Strategy Pack | 5 | 250000`,
    `\`\`\``,
    ``,
    `Gunakan \`-\` untuk qty bila tidak perlu jumlah.`,
    `Due date otomatis *${formatDate(addDays(now, 7), tz)}*`,
  ].join('\n')
}

export async function parseAndGenerateInvoice(body: string, source?: string): Promise<{ reply: string; filePath?: string; driveUrl?: string }> {
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
    let qty: number | null = null
    if (qtyStr === '-' || qtyStr === '') {
      qty = null
    } else {
      qty = parseInt(qtyStr.replace(/\D/g, ''))
      if (isNaN(qty) || qty <= 0) {
        return { reply: `❌ Qty tidak valid: "${qtyStr}"` }
      }
    }
    const rate = parseRateInput(rateStr)
    if (rate === null) {
      return { reply: `❌ Rate tidak valid: "${rateStr}"\nContoh: 150000, 150rb, 1.5jt, 0, free` }
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

  const total = items.reduce((s, i) => s + (i.qty ?? 1) * i.rate, 0)
  const summary = items
    .map(i => {
      const qtyStr = i.qty !== null ? String(i.qty) : '-'
      const amt = (i.qty ?? 1) * i.rate
      return `   • ${i.name}: ${qtyStr} × Rp${i.rate.toLocaleString('id-ID')} = Rp${amt.toLocaleString('id-ID')}`
    })
    .join('\n')

  try {
    const { localPath, driveUrl } = await generateInvoice(data)
    let logUrl: string | null = null
    try {
      logUrl = await appendInvoiceLog({ data, total, source })
    } catch (err) {
      console.error('[Invoice] Log append failed:', err)
    }

    const replyLines = [
      `✅ Invoice *${invoiceNo}* dibuat!`,
      ``,
      `📋 *${campaign}*`,
      `👤 ${billTo}`,
      summary,
      `💰 Total: *Rp${total.toLocaleString('id-ID')}*`,
    ]
    if (driveUrl) {
      replyLines.push('', `📎 ${driveUrl}`)
    }
    if (logUrl) {
      replyLines.push('', `📊 Log invoice: ${logUrl}`)
    }
    return {
      reply: replyLines.join('\n'),
      filePath: localPath,
      driveUrl: driveUrl ?? undefined,
    }
  } catch (err) {
    console.error('[Invoice] Generate error:', err)
    return { reply: `❌ Gagal generate invoice: ${(err as Error).message}` }
  }
}
