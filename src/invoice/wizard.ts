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

const SECTION_PREFIXES = [
  /^bill\s+to\s*:/i,
  /^client\s*:/i,
  /^campaign\s*:/i,
  /^brand\s*:/i,
  /^item\s*:/i,
] as const

function isSectionLine(line: string): boolean {
  return SECTION_PREFIXES.some(re => re.test(line))
}

export function invoiceHelp(): string {
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const now = new Date()
  const nextNo = peekInvoiceNumber()
  return [
    `🧾 *Buat Invoice — ${nextNo}*`,
    ``,
    `Kirim dalam *1 pesan* dengan format section:`,
    ``,
    `\`\`\``,
    `/invoice`,
    `Bill To: [nama klien]`,
    `Campaign: [nama campaign]`,
    `Item: [nama] | [deskripsi] | [qty/-] | [rate]`,
    `Item: [nama 2] | [deskripsi] | [qty/-] | [rate]`,
    ``,
    `Brand: [nama brand]  (opsional)`,
    ``,
    `Mastersheet`,
    `[link Google Sheets]  (opsional)`,
    `\`\`\``,
    ``,
    `*Contoh:*`,
    `\`\`\``,
    `/invoice`,
    `Bill To: Pintarnya`,
    `Campaign: Pigeon May`,
    `Brand: Nike`,
    `Item: Pigeon Nano | 1x VT + IG Reels | 17 | 150rb`,
    `Item: Pigeon Micro | 1x VT + IG Reels | - | 150rb`,
    ``,
    `Mastersheet`,
    `https://docs.google.com/spreadsheets/d/xxxxxxxx/edit`,
    `\`\`\``,
    ``,
    `Section yang tersedia: \`Bill To:\`, \`Campaign:\`, \`Brand:\`, \`Item:\``,
    `Gunakan \`-\` untuk qty bila tidak perlu jumlah.`,
    `Due date otomatis *${formatDate(addDays(now, 7), tz)}*`,
  ].join('\n')
}

function parseItems(itemLines: string[]): InvoiceItem[] {
  const items: InvoiceItem[] = []
  for (const line of itemLines) {
    const itemText = line.replace(/^item\s*:\s*/i, '').trim()
    const parts = itemText.split('|').map(p => p.trim())
    if (parts.length < 4) {
      throw new Error(`Format item salah: "${line}"\nHarus: Item: nama | deskripsi | qty | rate`)
    }
    const [name, description, qtyStr, rateStr] = parts
    let qty: number | null = null
    if (qtyStr === '-' || qtyStr === '') {
      qty = null
    } else {
      qty = parseInt(qtyStr.replace(/\D/g, ''))
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Qty tidak valid: "${qtyStr}"`)
      }
    }
    const rate = parseRateInput(rateStr)
    if (rate === null) {
      throw new Error(`Rate tidak valid: "${rateStr}"\nContoh: 150000, 150rb, 1.5jt, 0, free`)
    }
    items.push({ name, description, qty, rate })
  }
  return items
}

export async function parseAndGenerateInvoice(body: string, source?: string): Promise<{ reply: string; filePath?: string; driveUrl?: string }> {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean).slice(1)

  // Categorize lines by section prefix
  let billTo: string | undefined
  let campaign: string | undefined
  let brandName: string | undefined
  const itemLines: string[] = []

  // Parse Mastersheet separately (keyword line + URL on next line)
  const mastersheetIndex = lines.findIndex(line => line.toLowerCase() === 'mastersheet')
  let mastersheetUrl: string | undefined
  let sectionLines = lines

  if (mastersheetIndex >= 0) {
    sectionLines = lines.slice(0, mastersheetIndex)
    const mastersheetLines = lines.slice(mastersheetIndex + 1)
    if (mastersheetLines.length !== 1) {
      return { reply: `❌ Setelah "Mastersheet" harus ada tepat 1 link Google Sheets.` }
    }
    mastersheetUrl = mastersheetLines[0].replace(/[,.]+$/, '')
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+(?:\/.*)?$/i.test(mastersheetUrl)) {
      return { reply: `❌ Link Mastersheet tidak valid. Gunakan link Google Sheets lengkap.` }
    }
  }

  for (const line of sectionLines) {
    if (/^bill\s+to\s*:/i.test(line)) {
      billTo = line.replace(/^bill\s+to\s*:\s*/i, '').trim()
    } else if (/^client\s*:/i.test(line)) {
      billTo = billTo || line.replace(/^client\s*:\s*/i, '').trim()
    } else if (/^campaign\s*:/i.test(line)) {
      campaign = line.replace(/^campaign\s*:\s*/i, '').trim()
    } else if (/^brand\s*:/i.test(line)) {
      brandName = line.replace(/^brand\s*:\s*/i, '').trim()
    } else if (/^item\s*:/i.test(line)) {
      itemLines.push(line)
    } else if (!isSectionLine(line)) {
      // Non-section lines that aren't a recognized section are ignored
      // (previously they'd be treated as positional args — now we require section names)
    }
  }

  // Fallback: if billTo/campaign not found via sections, treat first 2
  // non-section lines as positional (backward compatibility)
  if ((!billTo || !campaign) && sectionLines.length >= 2) {
    const nonSection = sectionLines.filter(l => !isSectionLine(l))
    if (nonSection.length >= 2) {
      if (!billTo) billTo = nonSection[0]
      if (!campaign) campaign = nonSection[1]
      // Remaining non-section lines become positional items (only if no Item: lines used)
      if (itemLines.length === 0) {
        for (let i = 2; i < nonSection.length; i++) {
          itemLines.push(nonSection[i])
        }
      }
    }
  }

  // Validate required fields
  if (!billTo) {
    return { reply: `❌ Gunakan \`Bill To: [nama klien]\` untuk menentukan klien.` }
  }
  if (!campaign) {
    return { reply: `❌ Gunakan \`Campaign: [nama campaign]\` untuk menentukan campaign.` }
  }
  if (itemLines.length === 0) {
    return { reply: `❌ Gunakan \`Item: nama | deskripsi | qty | rate\` untuk menambahkan item.` }
  }

  let items: InvoiceItem[]
  try {
    items = parseItems(itemLines)
  } catch (err) {
    return { reply: (err as Error).message }
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
    brandName,
    mastersheetUrl,
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
    try {
      await appendInvoiceLog({ data, total, driveUrl, source })
    } catch (err) {
      console.error('[Invoice] Log append failed:', err)
    }

    const replyLines = [
      `✅ Invoice *${invoiceNo}*`,
      ``,
      `📋 *${campaign}*`,
      `👤 ${billTo}`,
      summary,
      `💰 Total: *Rp${total.toLocaleString('id-ID')}*`,
    ]
    if (driveUrl) {
      replyLines.push('', `📎 ${driveUrl}`)
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
