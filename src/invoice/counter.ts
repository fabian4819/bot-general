import fs from 'fs'
import path from 'path'

const COUNTER_FILE = path.join(process.cwd(), 'invoices', 'counter.json')

function loadCounter(): Record<string, number> {
  if (!fs.existsSync(COUNTER_FILE)) return {}
  return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8'))
}

function saveCounter(data: Record<string, number>): void {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2))
}

export function nextInvoiceNumber(): string {
  const now = new Date()
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))

  const year = local.getFullYear()
  const month = String(local.getMonth() + 1).padStart(2, '0')
  const key = `${year}${month}`

  const counter = loadCounter()
  counter[key] = (counter[key] || 0) + 1
  saveCounter(counter)

  const seq = String(counter[key]).padStart(3, '0')
  return `INV-AZK-${key}-${seq}`
}

export function peekInvoiceNumber(): string {
  const now = new Date()
  const tz = process.env.TIMEZONE || 'Asia/Jakarta'
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))

  const year = local.getFullYear()
  const month = String(local.getMonth() + 1).padStart(2, '0')
  const key = `${year}${month}`

  const counter = loadCounter()
  const next = (counter[key] || 0) + 1
  return `INV-AZK-${key}-${String(next).padStart(3, '0')}`
}
