import { getSheetsClient } from '../sheets/client'
import { InvoiceData } from './types'

const INVOICE_SHEET = 'Invoices'
const ITEM_SHEET = 'Invoice Items'

let ensuredSpreadsheetId: string | null = null

function getInvoiceSpreadsheetId(): string | null {
  return process.env.INVOICE_SPREADSHEET_ID || null
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

async function ensureInvoiceLogSheets(spreadsheetId: string): Promise<void> {
  if (ensuredSpreadsheetId === spreadsheetId) return

  const sheets = getSheetsClient()
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existingSheets = (meta.data.sheets || []).map(sheet => ({
    id: sheet.properties?.sheetId as number,
    title: sheet.properties?.title ?? '',
  }))

  const addRequests = [INVOICE_SHEET, ITEM_SHEET]
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
  const items = finalMeta.data.sheets?.find(sheet => sheet.properties?.title === ITEM_SHEET)
  const invoiceSheetId = invoices?.properties?.sheetId
  const itemSheetId = items?.properties?.sheetId
  if (invoiceSheetId === undefined || itemSheetId === undefined) {
    throw new Error('Invoice log sheets gagal dibuat')
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A1:K1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        'Timestamp',
        'Invoice No',
        'Issue Date',
        'Due Date',
        'Bill To',
        'Campaign',
        'Item Count',
        'Total',
        'PDF File',
        'Drive URL',
        'Source',
      ]],
    },
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${ITEM_SHEET}!A1:I1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        'Timestamp',
        'Invoice No',
        'Bill To',
        'Campaign',
        'Item',
        'Description',
        'Qty',
        'Rate',
        'Amount',
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
          repeatCell: {
            range: { sheetId: itemSheetId, startRowIndex: 0, endRowIndex: 1 },
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
        {
          updateSheetProperties: {
            properties: { sheetId: itemSheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        ...[
          { sheetId: invoiceSheetId, widths: [170, 160, 130, 130, 180, 220, 100, 140, 280, 320, 180] },
          { sheetId: itemSheetId, widths: [170, 160, 180, 220, 180, 260, 80, 130, 130] },
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
  localPath: string
  driveUrl: string | null
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

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A:K`,
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
        args.data.items.length,
        args.total,
        args.localPath.split('/').pop() || args.localPath,
        args.driveUrl || '',
        args.source || '',
      ]],
    },
  })

  const itemRows = args.data.items.map(item => {
    const amount = (item.qty ?? 1) * item.rate
    return [
      timestamp,
      args.data.invoiceNo,
      args.data.billTo,
      args.data.campaign,
      item.name,
      item.description,
      item.qty ?? '-',
      item.rate,
      amount,
    ]
  })

  if (itemRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${ITEM_SHEET}!A:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: itemRows },
    })
  }

  return spreadsheetUrl(spreadsheetId)
}
