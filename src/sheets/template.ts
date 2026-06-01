import { sheets_v4 } from 'googleapis'

export const SHEET_NAMES = {
  dashboard:    '📊 Dashboard',
  transaksi:    'Transaksi',
  rekapBulanan: 'Rekap Bulanan',
  kategori:     'Kategori',
  pengaturan:   'Pengaturan',
} as const

export type SheetIds = Record<keyof typeof SHEET_NAMES, number>

const COLOR = {
  green:      { red: 0.204, green: 0.659, blue: 0.325 },
  lightGreen: { red: 0.898, green: 0.965, blue: 0.914 },
  darkGreen:  { red: 0.067, green: 0.392, blue: 0.157 },
  red:        { red: 0.796, green: 0.196, blue: 0.196 },
  lightRed:   { red: 0.992, green: 0.906, blue: 0.906 },
  blue:       { red: 0.259, green: 0.522, blue: 0.957 },
  darkBlue:   { red: 0.125, green: 0.306, blue: 0.706 },
  lightBlue:  { red: 0.91,  green: 0.945, blue: 1 },
  orange:     { red: 0.961, green: 0.576, blue: 0.086 },
  purple:     { red: 0.424, green: 0.263, blue: 0.757 },
  lightPurple:{ red: 0.961, green: 0.953, blue: 1 },
  white:      { red: 1,     green: 1,     blue: 1     },
  black:      { red: 0.10,  green: 0.10,  blue: 0.10  },
  greyText:   { red: 0.36,  green: 0.36,  blue: 0.36  },
  border:     { red: 0.86,  green: 0.86,  blue: 0.86  },
  headerGrey: { red: 0.10,  green: 0.10,  blue: 0.10  },
}

const CATEGORY_NAMES = [
  'Makanan', 'Transport', 'Belanja', 'Utilitas', 'Kesehatan',
  'Hiburan', 'Pendidikan', 'Tabungan', 'Investasi', 'Lainnya',
]

function headerCell(value: string): sheets_v4.Schema$CellData {
  return {
    userEnteredValue: { stringValue: value },
    userEnteredFormat: {
      textFormat: { bold: true, foregroundColor: COLOR.white },
      backgroundColor: COLOR.headerGrey,
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'MIDDLE',
    },
  }
}

function rupiahFormat(): sheets_v4.Schema$CellFormat {
  return { numberFormat: { type: 'NUMBER', pattern: '"Rp "#,##0' } }
}

function dateFormat(): sheets_v4.Schema$CellFormat {
  return { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } }
}

function buildMonthRows(): sheets_v4.Schema$RowData[] {
  const rows: sheets_v4.Schema$RowData[] = []
  const now = new Date()
  const start = new Date(now.getFullYear() - 1, now.getMonth(), 1)

  for (let i = 0; i < 24; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1)
    rows.push({
      values: [
        {
          userEnteredValue: { formulaValue: `=DATE(${d.getFullYear()},${d.getMonth() + 1},1)` },
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'mmm yyyy' } },
        },
        {
          userEnteredValue: {
            formulaValue: `=SUMIFS(Transaksi!F:F,Transaksi!C:C,"Pemasukan",Transaksi!B:B,">="&A${i + 2},Transaksi!B:B,"<"&EDATE(A${i + 2},1))`,
          },
          userEnteredFormat: rupiahFormat(),
        },
        {
          userEnteredValue: {
            formulaValue: `=SUMIFS(Transaksi!F:F,Transaksi!C:C,"Pengeluaran",Transaksi!B:B,">="&A${i + 2},Transaksi!B:B,"<"&EDATE(A${i + 2},1))`,
          },
          userEnteredFormat: rupiahFormat(),
        },
        {
          userEnteredValue: { formulaValue: `=B${i + 2}-C${i + 2}` },
          userEnteredFormat: rupiahFormat(),
        },
        {
          userEnteredValue: { formulaValue: `=IF(B${i + 2}>0,D${i + 2}/B${i + 2},0)` },
          userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } },
        },
      ],
    })
  }
  return rows
}

const KATEGORI_LIST = [
  '🍽️ Makanan', '🚗 Transport', '🛍️ Belanja', '💡 Utilitas',
  '❤️ Kesehatan', '🎮 Hiburan', '📚 Pendidikan', '💰 Tabungan',
  '📈 Investasi', '📦 Lainnya',
]

function freezeHeader(sheetId: number, rows = 1): sheets_v4.Schema$Request {
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: rows } },
      fields: 'gridProperties.frozenRowCount',
    },
  }
}

function setColumnWidths(
  sheetId: number,
  widths: number[],
  startIndex = 0,
): sheets_v4.Schema$Request[] {
  return widths.map((pixels, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: startIndex + i, endIndex: startIndex + i + 1 },
      properties: { pixelSize: pixels },
      fields: 'pixelSize',
    },
  }))
}

function setRowHeight(sheetId: number, startIndex: number, endIndex: number, pixels: number): sheets_v4.Schema$Request {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex, endIndex },
      properties: { pixelSize: pixels },
      fields: 'pixelSize',
    },
  }
}

function addTableBorder(
  sheetId: number,
  endRowIndex: number,
  endColumnIndex: number,
): sheets_v4.Schema$Request {
  const border = { style: 'SOLID' as const, width: 1, color: COLOR.border }
  return {
    updateBorders: {
      range: { sheetId, startRowIndex: 0, endRowIndex, startColumnIndex: 0, endColumnIndex },
      top: border,
      bottom: border,
      left: border,
      right: border,
      innerHorizontal: border,
      innerVertical: border,
    },
  }
}

export function buildFormatRequests(ids: SheetIds): sheets_v4.Schema$Request[] {
  const req: sheets_v4.Schema$Request[] = []

  Object.values(ids).forEach(sheetId => {
    req.push({
      repeatCell: {
        range: { sheetId },
        cell: {
          userEnteredFormat: {
            textFormat: { fontFamily: 'Inter', fontSize: 10, foregroundColor: COLOR.black },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment',
      },
    })
  })

  // ─── Pengaturan ─────────────────────────────────────────────────────────────
  req.push(freezeHeader(ids.pengaturan, 1))
  req.push({
    updateCells: {
      range: { sheetId: ids.pengaturan, startRowIndex: 0, startColumnIndex: 0 },
      rows: [
        { values: [{ userEnteredValue: { stringValue: '⚙️ Pengaturan' }, userEnteredFormat: { textFormat: { bold: true, fontSize: 16, foregroundColor: COLOR.purple } } }] },
        { values: [{ userEnteredValue: { stringValue: 'Nama' } }, { userEnteredValue: { stringValue: 'Cashflow Tracker' } }] },
        { values: [{ userEnteredValue: { stringValue: 'Nomor WA' } }, { userEnteredValue: { stringValue: '' } }] },
        { values: [{ userEnteredValue: { stringValue: 'Saldo Awal' } }, { userEnteredValue: { numberValue: 0 }, userEnteredFormat: rupiahFormat() }] },
        { values: [{ userEnteredValue: { stringValue: 'Kategori Default' } }, { userEnteredValue: { stringValue: 'Lainnya' } }] },
      ],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })
  req.push(...setColumnWidths(ids.pengaturan, [190, 280]))
  req.push(addTableBorder(ids.pengaturan, 5, 2))

  // ─── Transaksi headers ───────────────────────────────────────────────────────
  req.push(freezeHeader(ids.transaksi, 1))
  req.push({
    updateCells: {
      range: { sheetId: ids.transaksi, startRowIndex: 0, startColumnIndex: 0 },
      rows: [{
        values: [
          headerCell('Timestamp'), headerCell('Tanggal'), headerCell('Tipe'),
          headerCell('Kategori'), headerCell('Deskripsi'), headerCell('Nominal'),
          headerCell('Saldo'), headerCell('Source'),
        ],
      }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    repeatCell: {
      range: { sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 7 },
      cell: { userEnteredFormat: rupiahFormat() },
      fields: 'userEnteredFormat.numberFormat',
    },
  })

  req.push({
    setBasicFilter: {
      filter: { range: { sheetId: ids.transaksi, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 } },
    },
  })

  req.push({
    repeatCell: {
      range: { sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
      cell: { userEnteredFormat: dateFormat() },
      fields: 'userEnteredFormat.numberFormat',
    },
  })

  req.push({
    setDataValidation: {
      range: { sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [{ userEnteredValue: 'Pemasukan' }, { userEnteredValue: 'Pengeluaran' }],
        },
        showCustomUi: true,
        strict: true,
      },
    },
  })

  req.push({
    setDataValidation: {
      range: { sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: CATEGORY_NAMES.map(name => ({ userEnteredValue: name })),
        },
        showCustomUi: true,
        strict: false,
      },
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }],
        booleanRule: {
          condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0' }] },
          format: { textFormat: { foregroundColor: COLOR.red, bold: true } },
        },
      },
      index: 0,
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Pemasukan' }] },
          format: { backgroundColor: COLOR.lightGreen },
        },
      },
      index: 1,
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.transaksi, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'Pengeluaran' }] },
          format: { backgroundColor: COLOR.lightRed },
        },
      },
      index: 2,
    },
  })

  req.push(...setColumnWidths(ids.transaksi, [170, 115, 120, 140, 360, 150, 150, 110]))
  req.push(setRowHeight(ids.transaksi, 0, 1, 34))
  req.push(addTableBorder(ids.transaksi, 1000, 8))

  // ─── Rekap Bulanan ───────────────────────────────────────────────────────────
  req.push(freezeHeader(ids.rekapBulanan, 1))
  req.push({
    updateCells: {
      range: { sheetId: ids.rekapBulanan, startRowIndex: 0, startColumnIndex: 0 },
      rows: [{
        values: [
          headerCell('Bulan'), headerCell('Total Masuk'), headerCell('Total Keluar'),
          headerCell('Net'), headerCell('Savings Rate'),
        ],
      }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    updateCells: {
      range: { sheetId: ids.rekapBulanan, startRowIndex: 1, startColumnIndex: 0 },
      rows: buildMonthRows(),
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    setBasicFilter: {
      filter: { range: { sheetId: ids.rekapBulanan, startRowIndex: 0, endRowIndex: 25, startColumnIndex: 0, endColumnIndex: 5 } },
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.rekapBulanan, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 }],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=E2>=1/5' }] },
          format: { backgroundColor: COLOR.lightGreen },
        },
      },
      index: 0,
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.rekapBulanan, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 }],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND(E2<1/10,E2>0)' }] },
          format: { backgroundColor: COLOR.lightRed },
        },
      },
      index: 1,
    },
  })

  req.push(...setColumnWidths(ids.rekapBulanan, [130, 155, 155, 155, 125]))
  req.push(setRowHeight(ids.rekapBulanan, 0, 1, 34))
  req.push(addTableBorder(ids.rekapBulanan, 25, 5))

  // ─── Kategori ────────────────────────────────────────────────────────────────
  req.push(freezeHeader(ids.kategori, 1))
  req.push({
    updateCells: {
      range: { sheetId: ids.kategori, startRowIndex: 0, startColumnIndex: 0 },
      rows: [
        {
          values: [
            headerCell('Kategori'), headerCell('Budget/Bulan'),
            headerCell('Aktual Bulan Ini'), headerCell('Sisa'), headerCell('Status'),
          ],
        },
        ...KATEGORI_LIST.map((nama, i) => {
          const row = i + 2
          return {
            values: [
              { userEnteredValue: { stringValue: nama } },
              { userEnteredValue: { numberValue: 0 }, userEnteredFormat: rupiahFormat() },
              {
                userEnteredValue: {
                  formulaValue: `=SUMIFS(Transaksi!F:F,Transaksi!C:C,"Pengeluaran",Transaksi!D:D,MID(A${row},FIND(" ",A${row})+1,100),Transaksi!B:B,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),Transaksi!B:B,"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1))`,
                },
                userEnteredFormat: rupiahFormat(),
              },
              { userEnteredValue: { formulaValue: `=IF(B${row}=0,"",B${row}-C${row})` }, userEnteredFormat: rupiahFormat() },
              { userEnteredValue: { formulaValue: `=IF(B${row}=0,"–",IF(C${row}>B${row},"🔴 Over",IF(C${row}>B${row}*0.8,"🟡 Hampir",IF(C${row}=0,"⚪ Belum","🟢 Aman"))))` } },
            ],
          }
        }),
      ],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    setBasicFilter: {
      filter: { range: { sheetId: ids.kategori, startRowIndex: 0, endRowIndex: 11, startColumnIndex: 0, endColumnIndex: 5 } },
    },
  })

  req.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: ids.kategori, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
        booleanRule: {
          condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0' }] },
          format: { textFormat: { foregroundColor: COLOR.red, bold: true } },
        },
      },
      index: 0,
    },
  })

  req.push(...setColumnWidths(ids.kategori, [180, 150, 160, 140, 130]))
  req.push(setRowHeight(ids.kategori, 0, 1, 34))
  req.push(addTableBorder(ids.kategori, 11, 5))

  // ─── Dashboard ───────────────────────────────────────────────────────────────
  req.push(freezeHeader(ids.dashboard, 1))
  req.push({
    updateCells: {
      range: { sheetId: ids.dashboard, startRowIndex: 0, startColumnIndex: 0 },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: '💰 CASHFLOW DASHBOARD' },
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 18, foregroundColor: COLOR.white },
            backgroundColor: COLOR.purple,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        }],
      }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    mergeCells: {
      range: { sheetId: ids.dashboard, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
      mergeType: 'MERGE_ALL',
    },
  })

  req.push({
    updateCells: {
      range: { sheetId: ids.dashboard, startRowIndex: 2, startColumnIndex: 0 },
      rows: [
        {
          values: [
            { userEnteredValue: { stringValue: 'Saldo Saat Ini' }, userEnteredFormat: { textFormat: { bold: true, fontSize: 12 } } },
            {
              userEnteredValue: { formulaValue: `=IFERROR(INDEX(Transaksi!G:G,MATCH(9E+307,Transaksi!G:G)),Pengaturan!B4)` },
              userEnteredFormat: { ...rupiahFormat(), textFormat: { bold: true, fontSize: 16, foregroundColor: COLOR.purple } },
            },
          ],
        },
        {
          values: [
            { userEnteredValue: { stringValue: 'Masuk Bulan Ini' } },
            {
              userEnteredValue: { formulaValue: `=SUMIFS(Transaksi!F:F,Transaksi!C:C,"Pemasukan",Transaksi!B:B,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),Transaksi!B:B,"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1))` },
              userEnteredFormat: { ...rupiahFormat(), textFormat: { bold: true, foregroundColor: COLOR.green } },
            },
          ],
        },
        {
          values: [
            { userEnteredValue: { stringValue: 'Keluar Bulan Ini' } },
            {
              userEnteredValue: { formulaValue: `=SUMIFS(Transaksi!F:F,Transaksi!C:C,"Pengeluaran",Transaksi!B:B,">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),Transaksi!B:B,"<"&EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),1))` },
              userEnteredFormat: { ...rupiahFormat(), textFormat: { bold: true, foregroundColor: COLOR.red } },
            },
          ],
        },
        {
          values: [
            { userEnteredValue: { stringValue: 'Net Bulan Ini' } },
            { userEnteredValue: { formulaValue: `=B4-B5` }, userEnteredFormat: rupiahFormat() },
          ],
        },
        {
          values: [
            { userEnteredValue: { stringValue: 'Savings Rate' } },
            { userEnteredValue: { formulaValue: `=IF(B4>0,B6/B4,0)` }, userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
          ],
        },
      ],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  })

  req.push({
    repeatCell: {
      range: { sheetId: ids.dashboard, startRowIndex: 2, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 2 },
      cell: { userEnteredFormat: { backgroundColor: COLOR.lightPurple } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  })
  req.push(...setColumnWidths(ids.dashboard, [210, 180, 40, 160, 160, 160, 160, 160]))
  req.push(setRowHeight(ids.dashboard, 0, 1, 42))
  req.push(addTableBorder(ids.dashboard, 7, 2))

  return req
}

export function buildChartRequests(ids: SheetIds): sheets_v4.Schema$Request[] {
  return [
    {
      addChart: {
        chart: {
          spec: {
            title: 'Pemasukan vs Pengeluaran (12 Bulan)',
            basicChart: {
              chartType: 'COLUMN',
              legendPosition: 'BOTTOM_LEGEND',
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Bulan' },
                { position: 'LEFT_AXIS', title: 'Jumlah (Rp)' },
              ],
              domains: [{
                domain: {
                  sourceRange: { sources: [{ sheetId: ids.rekapBulanan, startRowIndex: 0, endRowIndex: 25, startColumnIndex: 0, endColumnIndex: 1 }] },
                },
              }],
              series: [
                {
                  series: { sourceRange: { sources: [{ sheetId: ids.rekapBulanan, startRowIndex: 0, endRowIndex: 25, startColumnIndex: 1, endColumnIndex: 2 }] } },
                  targetAxis: 'LEFT_AXIS',
                  color: COLOR.green,
                },
                {
                  series: { sourceRange: { sources: [{ sheetId: ids.rekapBulanan, startRowIndex: 0, endRowIndex: 25, startColumnIndex: 2, endColumnIndex: 3 }] } },
                  targetAxis: 'LEFT_AXIS',
                  color: COLOR.red,
                },
              ],
              headerCount: 1,
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: ids.dashboard, rowIndex: 9, columnIndex: 0 },
              widthPixels: 600,
              heightPixels: 350,
            },
          },
        },
      },
    },
    {
      addChart: {
        chart: {
          spec: {
            title: 'Pengeluaran per Kategori (Bulan Ini)',
            pieChart: {
              legendPosition: 'RIGHT_LEGEND',
              domain: {
                sourceRange: { sources: [{ sheetId: ids.kategori, startRowIndex: 1, endRowIndex: 11, startColumnIndex: 0, endColumnIndex: 1 }] },
              },
              series: {
                sourceRange: { sources: [{ sheetId: ids.kategori, startRowIndex: 1, endRowIndex: 11, startColumnIndex: 2, endColumnIndex: 3 }] },
              },
            },
          },
          position: {
            overlayPosition: {
              anchorCell: { sheetId: ids.dashboard, rowIndex: 9, columnIndex: 5 },
              widthPixels: 500,
              heightPixels: 350,
            },
          },
        },
      },
    },
  ]
}
