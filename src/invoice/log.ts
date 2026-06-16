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

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A1:I1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        'Timestamp',
        'Invoice No',
        'Issue Date',
        'Due Date',
        'Bill To',
        'Campaign',
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
          { sheetId: invoiceSheetId, widths: [170, 160, 130, 130, 180, 220, 500, 140, 320] },
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

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${INVOICE_SHEET}!A:H`,
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
        itemsParagraph,
        `Rp${args.total.toLocaleString('id-ID')}`,
      ]],
    },
  })

  if (args.driveUrl) {
    const updatedRange = res.data.updates?.updatedRange || ''
    const rowMatch = updatedRange.match(/(\d+)$/)
    if (rowMatch) {
      const rowIndex = parseInt(rowMatch[1]) - 1
      const meta = await sheets.spreadsheets.get({ spreadsheetId })
      const sheet = meta.data.sheets?.find(s => s.properties?.title === INVOICE_SHEET)
      const sheetId = sheet?.properties?.sheetId
      if (sheetId !== undefined) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateCells: {
                  range: {
                    sheetId,
                    startRowIndex: rowIndex,
                    endRowIndex: rowIndex + 1,
                    startColumnIndex: 8,
                    endColumnIndex: 9,
                  },
                  rows: [
                    {
                      values: [
                        {
                          userEnteredValue: { stringValue: args.data.invoiceNo },
                          textFormatRuns: [
                            {
                              format: {
                                link: { uri: args.driveUrl },
                                foregroundColor: { blue: 0.29, green: 0.43, red: 0.16 },
                                underline: true,
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                  fields: 'userEnteredValue,textFormatRuns',
                },
              },
            ],
          },
        })
      }
    }
  }

  return spreadsheetUrl(spreadsheetId)
}
