import fs from 'fs/promises'
import path from 'path'
import { getDriveClient, getSheetsClient, getSpreadsheetId } from './client'
import { ensureSpreadsheetTemplate } from './setup'

type UserSpreadsheetRecord = {
  key: string
  phone?: string
  jid: string
  spreadsheetId: string
  spreadsheetUrl: string
  createdAt: string
  fallback?: boolean
  manual?: boolean
}

type Registry = {
  users: Record<string, UserSpreadsheetRecord>
}

const DATA_DIR = path.join(process.cwd(), 'data')
const REGISTRY_FILE = path.join(DATA_DIR, 'user-spreadsheets.json')

function extractPhone(jid: string): string | undefined {
  if (!jid.endsWith('@s.whatsapp.net')) return undefined
  return jid.split('@')[0]
}

function getUserKey(jid: string): { key: string; phone?: string } {
  const phone = extractPhone(jid)
  if (phone) return { key: phone, phone }
  return { key: jid.replace(/[^a-zA-Z0-9_.-]/g, '_') }
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

function getManualSpreadsheetId(phone?: string): string | null {
  if (!phone) return null
  const raw = process.env.USER_SPREADSHEETS || ''
  for (const item of raw.split(',')) {
    const [mappedPhone, spreadsheetId] = item.split(':').map(part => part.trim())
    if (mappedPhone === phone && spreadsheetId) return spreadsheetId
  }
  return null
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8')
    return JSON.parse(raw) as Registry
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
    return { users: {} }
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2))
}

async function shareSpreadsheet(spreadsheetId: string): Promise<void> {
  const drive = getDriveClient()
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      type: 'anyone',
      role: 'writer',
    },
    fields: 'id',
  })
}

async function createSpreadsheet(label: string, waLabel: string): Promise<UserSpreadsheetRecord> {
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `Cashflow - ${label}`,
        locale: 'en_US',
      },
    },
    fields: 'spreadsheetId,spreadsheetUrl',
  })

  const spreadsheetId = res.data.spreadsheetId
  if (!spreadsheetId) throw new Error('Gagal membuat spreadsheet baru')

  await ensureSpreadsheetTemplate(spreadsheetId)

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Pengaturan!B3',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[waLabel]] },
  })

  try {
    await shareSpreadsheet(spreadsheetId)
  } catch (err) {
    console.warn('[Sheets] Gagal share spreadsheet otomatis:', (err as Error).message)
  }

  return {
    key: label,
    phone: waLabel.match(/^\d+$/) ? waLabel : undefined,
    jid: waLabel,
    spreadsheetId,
    spreadsheetUrl: res.data.spreadsheetUrl || spreadsheetUrl(spreadsheetId),
    createdAt: new Date().toISOString(),
  }
}

async function useManualSpreadsheet(
  key: string,
  phone: string,
  jid: string,
  spreadsheetId: string,
): Promise<UserSpreadsheetRecord> {
  const sheets = getSheetsClient()

  await ensureSpreadsheetTemplate(spreadsheetId)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Pengaturan!B3',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[phone]] },
  })

  return {
    key,
    phone,
    jid,
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    createdAt: new Date().toISOString(),
    manual: true,
  }
}

async function useDefaultSpreadsheet(key: string, phone: string | undefined, jid: string): Promise<UserSpreadsheetRecord> {
  const spreadsheetId = getSpreadsheetId()
  const sheets = getSheetsClient()
  const waLabel = phone || jid

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Pengaturan!B3',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[waLabel]] },
  })

  return {
    key,
    phone,
    jid,
    spreadsheetId,
    spreadsheetUrl: spreadsheetUrl(spreadsheetId),
    createdAt: new Date().toISOString(),
    fallback: true,
  }
}

export async function getOrCreateUserSpreadsheet(jid: string): Promise<{
  record: UserSpreadsheetRecord
  created: boolean
  fallback: boolean
}> {
  const registry = await readRegistry()
  const { key, phone } = getUserKey(jid)
  const manualSpreadsheetId = getManualSpreadsheetId(phone)

  if (phone && manualSpreadsheetId) {
    const existing = registry.users[key]
    if (existing?.spreadsheetId === manualSpreadsheetId && !existing.fallback) {
      return { record: existing, created: false, fallback: false }
    }

    const record = await useManualSpreadsheet(key, phone, jid, manualSpreadsheetId)
    registry.users[key] = record
    await writeRegistry(registry)
    return { record, created: false, fallback: false }
  }

  const existing = registry.users[key]
  if (existing) return { record: existing, created: false, fallback: Boolean(existing.fallback) }

  const ownerPhone = process.env.OWNER_PHONE
  const defaultSpreadsheetId = process.env.SPREADSHEET_ID

  if (phone && ownerPhone && defaultSpreadsheetId && phone === ownerPhone) {
    const sheets = getSheetsClient()
    await sheets.spreadsheets.values.update({
      spreadsheetId: defaultSpreadsheetId,
      range: 'Pengaturan!B3',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[phone]] },
    })

    const record: UserSpreadsheetRecord = {
      key,
      phone,
      jid,
      spreadsheetId: getSpreadsheetId(),
      spreadsheetUrl: spreadsheetUrl(defaultSpreadsheetId),
      createdAt: new Date().toISOString(),
    }
    registry.users[key] = record
    await writeRegistry(registry)
    return { record, created: false, fallback: false }
  }

  const label = phone || key.slice(0, 32)
  let record: UserSpreadsheetRecord
  let fallback = false

  try {
    record = await createSpreadsheet(label, phone || jid)
  } catch (err) {
    fallback = true
    console.warn(
      '[Sheets] Gagal membuat spreadsheet baru, pakai default spreadsheet sementara:',
      (err as Error).message
    )
    record = await useDefaultSpreadsheet(key, phone, jid)
  }

  registry.users[key] = { ...record, key, phone, jid }
  await writeRegistry(registry)
  return { record: registry.users[key], created: !fallback, fallback }
}
