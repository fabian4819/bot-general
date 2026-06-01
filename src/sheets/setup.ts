import { sheets_v4 } from 'googleapis'
import { getSheetsClient } from './client'
import { SHEET_NAMES, SheetIds, buildFormatRequests, buildChartRequests } from './template'

export async function ensureSpreadsheetTemplate(spreadsheetId: string): Promise<void> {
  const sheets = getSheetsClient()

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const needed = Object.values(SHEET_NAMES)
  const existingSheets = (meta.data.sheets || []).map(s => ({
    id: s.properties?.sheetId as number,
    title: s.properties?.title ?? '',
  }))

  const addRequests: sheets_v4.Schema$Request[] = []

  for (const title of needed) {
    if (!existingSheets.find(s => s.title === title)) {
      const defaultSheet = existingSheets.find(
        s => !needed.includes(s.title as typeof needed[number]) && addRequests.length === 0
      )
      if (defaultSheet) {
        addRequests.push({
          updateSheetProperties: {
            properties: { sheetId: defaultSheet.id, title },
            fields: 'title',
          },
        })
        defaultSheet.title = title
      } else {
        addRequests.push({ addSheet: { properties: { title } } })
      }
    }
  }

  if (addRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    })
  }

  const finalMeta = await sheets.spreadsheets.get({ spreadsheetId })
  const finalSheets = (finalMeta.data.sheets || []).map(s => ({
    id: s.properties?.sheetId as number,
    title: s.properties?.title ?? '',
  }))

  const ids: SheetIds = {
    dashboard:    finalSheets.find(s => s.title === SHEET_NAMES.dashboard)!.id,
    transaksi:    finalSheets.find(s => s.title === SHEET_NAMES.transaksi)!.id,
    rekapBulanan: finalSheets.find(s => s.title === SHEET_NAMES.rekapBulanan)!.id,
    kategori:     finalSheets.find(s => s.title === SHEET_NAMES.kategori)!.id,
    pengaturan:   finalSheets.find(s => s.title === SHEET_NAMES.pengaturan)!.id,
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateSpreadsheetProperties: {
          properties: { locale: 'en_US' },
          fields: 'locale',
        },
      }],
    },
  })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: buildFormatRequests(ids) },
  })

  const chartMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(charts(chartId))',
  })
  const chartIds = (chartMeta.data.sheets || [])
    .flatMap(sheet => sheet.charts || [])
    .map(chart => chart.chartId)
    .filter((id): id is number => typeof id === 'number')

  if (chartIds.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: chartIds.map(objectId => ({ deleteEmbeddedObject: { objectId } })),
      },
    })
  }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: buildChartRequests(ids) },
    })
  } catch (err) {
    console.warn('[Sheets] Chart setup skipped:', (err as Error).message)
  }
}
