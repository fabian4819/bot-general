import { getSheetsClient, getSpreadsheetId } from './client'
import { getCurrentSaldo } from './summary'
import { Transaction } from '../types'

export async function appendTransaction(tx: Transaction): Promise<void> {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()

  // Calculate running balance before appending
  const currentSaldo = await getCurrentSaldo()
  const newSaldo = tx.tipe === 'Pemasukan'
    ? currentSaldo + tx.nominal
    : currentSaldo - tx.nominal

  const row = [
    tx.timestamp,
    tx.tanggal,
    tx.tipe,
    tx.kategori,
    tx.deskripsi,
    tx.nominal,
    newSaldo,
    tx.source,
  ]

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Transaksi!A:H',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  })
}

export async function deleteLastTransaction(): Promise<boolean> {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Transaksi!A:A',
  })

  const rows = res.data.values || []
  const lastRow = rows.length

  if (lastRow <= 1) return false

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const sheet = meta.data.sheets?.find(s => s.properties?.title === 'Transaksi')
  const sheetId = sheet?.properties?.sheetId

  if (sheetId === undefined) return false

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: lastRow - 1,
            endIndex: lastRow,
          },
        },
      }],
    },
  })

  return true
}
