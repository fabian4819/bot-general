import { getSheetsClient } from '../sheets/client'
import { InvoiceData } from './types'

const INVOICE_SHEET = 'Invoices'

let ensuredSpreadsheetId: string | null = null

function getInvoiceSpreadsheetId(): string | null {
  return process.env.INVOICE_SPREADSHEET_ID || null
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

function extractSpreadsheetId(url: string): string | null {
  return url.match(/\/spreadsheets\/d\/([\w-]+)/i)?.[1] ?? null
}

async function getMastersheetTitle(url: string): Promise<string> {
  const spreadsheetId = extractSpreadsheetId(url)
  if (!spreadsheetId) return 'Mastersheet'

  try {
    const sheets = getSheetsClient()
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties.title',
    })
    return meta.data.properties?.title || 'Mastersheet'
  } catch (err) {
    console.warn('[Invoice] Mastersheet title unavailable, using fallback label:', err)
    return 'Mastersheet'
  }
}

async function ensureInvoiceLogSheets(spreadsheetId: string): Promise<void> {
  if (ensuredSpreadsheetId === spreadsheetId) return

  const sheets = getSheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existingSheets = (meta.data.sheets || []).map(sheet => ({
    id: sheet.properties?.sheetId as number,
    title: sheet.properties?.title ?? '',
  }))

  const addRequests = [INVOICE_SHEET]
    .filter(title => !existingSheets.some(sheet => sheet.title === title))
    .map(title => ({ addSheet: { properties: { title } } }))

  if (addRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    })
  }

  const finalMeta = await sheets.spreadsheets.get({ spreadsheetId })
  const invoices = finalMeta.data.sheets?.find(sheet => sheet.properties?.title === INVOICE_SHEET)
  const invoiceSheetId = invoices?.properties?.sheetId
  if (invoiceSheetId === undefined) {
    throw new Error('Invoice log sheet gagal dibuat')
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A1:J1`,
  })
  const headerValues = (header.data.values?.[0] || []).map(String)
  const needsMastersheetColumn = headerValues[6] === 'Items' && !headerValues.includes('Mastersheet')

  if (needsMastersheetColumn) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          insertDimension: {
            range: {
              sheetId: invoiceSheetId,
              dimension: 'COLUMNS',
              startIndex: 6,
              endIndex: 7,
            },
            inheritFromBefore: true,
          },
        }],
      },
    })
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A1:J1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        'Timestamp',
        'Invoice No',
        'Issue Date',
        'Due Date',
        'Bill To',
        'Campaign',
        'Mastersheet',
        'Items',
        'Total',
        'Drive URL',
      ]],
    },
  })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: invoiceSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.1, green: 0.1, blue: 0.1 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: invoiceSheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        ...[
          { sheetId: invoiceSheetId, widths: [170, 160, 130, 130, 180, 220, 260, 500, 140, 320] },
        ].flatMap(({ sheetId, widths }) => widths.map((pixelSize, index) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
            properties: { pixelSize },
            fields: 'pixelSize',
          },
        }))),
      ],
    },
  })

  ensuredSpreadsheetId = spreadsheetId
}

export async function appendInvoiceLog(args: {
  data: InvoiceData
  total: number
  driveUrl?: string | null
  source?: string
}): Promise<string | null> {
  const spreadsheetId = getInvoiceSpreadsheetId()
  if (!spreadsheetId) {
    console.warn('[Invoice] INVOICE_SPREADSHEET_ID not set, invoice log skipped')
    return null
  }

  const sheets = getSheetsClient()
  await ensureInvoiceLogSheets(spreadsheetId)

  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: process.env.TIMEZONE || 'Asia/Jakarta',
    hour12: false,
  }).replace(/\//g, '-')

  const itemsParagraph = args.data.items
    .map(item => {
      const qtyStr = item.qty !== null ? String(item.qty) : '-'
      const rateStr = item.rate !== null ? `Rp${item.rate.toLocaleString('id-ID')}` : '-'
      return `${item.name} | ${item.description} | ${qtyStr} | ${rateStr}`
    })
    .join('\n')

  const mastersheetTitle = args.data.mastersheetUrl
    ? await getMastersheetTitle(args.data.mastersheetUrl)
    : ''

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A:J`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        timestamp,
        args.data.invoiceNo,
        args.data.issueDate,
        args.data.dueDate,
        args.data.billTo,
        args.data.campaign,
        mastersheetTitle,
        itemsParagraph,
        `Rp${args.total.toLocaleString('id-ID')}`,
        '',
      ]],
    },
  })

  if (args.data.mastersheetUrl || args.driveUrl) {
    const updatedRange = res.data.updates?.updatedRange || ''
    const rowMatch = updatedRange.match(/(\d+)$/)
    if (rowMatch) {
      const rowIndex = parseInt(rowMatch[1]) - 1
      const meta = await sheets.spreadsheets.get({ spreadsheetId })
      const sheet = meta.data.sheets?.find(s => s.properties?.title === INVOICE_SHEET)
      const sheetId = sheet?.properties?.sheetId
      if (sheetId !== undefined) {
        const linkCell = (columnIndex: number, label: string, uri: string) => ({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            rows: [{
              values: [{
                userEnteredValue: { stringValue: label },
                textFormatRuns: [{
                  format: {
                    link: { uri },
                    foregroundColor: { red: 0.16, green: 0.43, blue: 0.79 },
                    underline: true,
                  },
                }],
              }],
            }],
            fields: 'userEnteredValue,textFormatRuns',
          },
        })

        const requests = []
        if (args.data.mastersheetUrl) {
          requests.push(linkCell(6, mastersheetTitle, args.data.mastersheetUrl))
        }
        if (args.driveUrl) {
          requests.push(linkCell(9, args.data.invoiceNo, args.driveUrl))
        }

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests,
          },
        })
      }
    }
  }

  return spreadsheetUrl(spreadsheetId)
}
