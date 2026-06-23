import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import path from 'path'
import fs from 'fs'
import { Readable } from 'stream'
import { InvoiceData } from './types'
import { getDriveUploadClient } from '../sheets/client'

const TEMPLATE   = path.join(process.cwd(), 'template-invoice.png')
const OUTPUT_DIR = path.join(process.cwd(), 'invoices')
const DRIVE_FOLDER_ID = process.env.INVOICE_DRIVE_FOLDER_ID || '1Hl--CoPa5y8UNKRoWB3SoXReGZyDItwd'

const PAGE_W = 1240
const PAGE_H = 1754  // pixel height of one A4-proportioned page
const RENDER_SCALE = 2

// Table layout
const CONTENT_X      = 95
const CONTENT_RIGHT  = 1150
const CONTENT_W      = CONTENT_RIGHT - CONTENT_X

const TABLE_X        = CONTENT_X
const TABLE_W        = CONTENT_W
const TABLE_RIGHT    = TABLE_X + TABLE_W
const TABLE_HEADER_Y = 870
const TABLE_HEADER_H = 76
const ITEM_ROW_H     = 108
const TABLE_BODY_Y   = TABLE_HEADER_Y + TABLE_HEADER_H

const COL_ITEM_X     = TABLE_X + 20
const COL_ITEM_END   = TABLE_X + 485
const COL_QTY_END    = TABLE_X + 625
const COL_RATE_END   = TABLE_X + 860
const COL_QTY_X      = (COL_ITEM_END + COL_QTY_END) / 2
const COL_RATE_X     = COL_RATE_END - 25
const COL_AMT_X      = TABLE_RIGHT - 25

// Below-table card layout (NOTES left | subtotal right)
const NOTES_X       = CONTENT_X
const NOTES_W       = 535
const CARD_GAP      = 30
const RIGHT_CARD_X  = NOTES_X + NOTES_W + CARD_GAP
const RIGHT_CARD_W  = CONTENT_RIGHT - RIGHT_CARD_X
const CARD_H        = 205

const FOOTER_H = 140
const BRAND_PURPLE = '#6B46C1'
const BRAND_BLUE = '#2563EB'

function formatRp(n: number): string {
  return 'Rp' + n.toLocaleString('id-ID')
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function scaleSvg(svg: string, width: number, height: number): string {
  return svg.replace(
    `<svg width="${PAGE_W}" height="${height}"`,
    `<svg width="${width}" height="${height * RENDER_SCALE}" viewBox="0 0 ${PAGE_W} ${height}"`,
  )
}

function addFooter(lines: string[], pageTop: number): void {
  const footerTop = pageTop + PAGE_H - FOOTER_H
  const footerTextY = footerTop + 82

  lines.push(`<rect x="0" y="${footerTop}" width="${PAGE_W}" height="${FOOTER_H}" fill="#FBFAFF"/>`)
  lines.push(`<line x1="${CONTENT_X}" y1="${footerTop}" x2="${CONTENT_RIGHT}" y2="${footerTop}" stroke="#E8E4FF" stroke-width="1"/>`)
  lines.push(`<text x="${CONTENT_X}" y="${footerTextY}" font-size="22" font-weight="bold" fill="${BRAND_PURPLE}">Scale Brands. Amplify Impact</text>`)
  lines.push(`<text x="${CONTENT_RIGHT}" y="${footerTextY}" font-size="22" font-weight="bold" fill="${BRAND_BLUE}" text-anchor="end">@azerakol.id</text>`)
}

function buildSvg(data: InvoiceData, total: number): { svg: string; svgHeight: number } {
  const lines: string[] = []

  // Dynamic Y anchors
  const lastItemDescY = TABLE_BODY_Y + (data.items.length - 1) * ITEM_ROW_H + 67
  const itemsBottom   = lastItemDescY + 20

  const naturalNotesTop = itemsBottom + 40
  const pageContentBottom = PAGE_H - FOOTER_H - 36
  const notesFitsFirstPage = naturalNotesTop + CARD_H <= pageContentBottom
  const naturalTermsBottom = naturalNotesTop + CARD_H + 45 + 185
  const singlePageFits = naturalTermsBottom <= pageContentBottom

  const notesTop    = singlePageFits || notesFitsFirstPage ? naturalNotesTop : PAGE_H + 90
  const notesBottom = notesTop + CARD_H

  let termsTop: number
  if (singlePageFits || notesTop >= PAGE_H) {
    termsTop = notesBottom + 45
  } else {
    termsTop = PAGE_H + 90
  }
  const termsBottom = termsTop + 185

  const contentBottom = termsBottom + FOOTER_H + 48
  const svgHeight = singlePageFits ? PAGE_H : Math.ceil(contentBottom / PAGE_H) * PAGE_H

  // White background: table header down to content bottom
  lines.push(`<rect x="0" y="${TABLE_HEADER_Y}" width="${PAGE_W}" height="${svgHeight - TABLE_HEADER_Y}" fill="white"/>`)

  // Table
  const tableBodyH = data.items.length * ITEM_ROW_H
  const tableBottom = TABLE_BODY_Y + tableBodyH
  const tableTotalH = TABLE_HEADER_H + tableBodyH

  lines.push(`<rect x="${TABLE_X}" y="${TABLE_HEADER_Y}" width="${TABLE_W}" height="${tableTotalH}" rx="10" fill="white" stroke="#D8D8D8" stroke-width="1.2"/>`)
  lines.push(`<rect x="${TABLE_X}" y="${TABLE_HEADER_Y}" width="${TABLE_W}" height="${TABLE_HEADER_H}" rx="10" fill="#181818"/>`)
  lines.push(`<rect x="${TABLE_X}" y="${TABLE_HEADER_Y + TABLE_HEADER_H - 10}" width="${TABLE_W}" height="10" fill="#181818"/>`)

  data.items.forEach((_, i) => {
    if (i % 2 === 1) {
      lines.push(`<rect x="${TABLE_X + 1}" y="${TABLE_BODY_Y + i * ITEM_ROW_H}" width="${TABLE_W - 2}" height="${ITEM_ROW_H}" fill="#FCFCFD"/>`)
    }
  })

  const colDividers = [COL_ITEM_END, COL_QTY_END, COL_RATE_END]
  colDividers.forEach((x) => {
    lines.push(`<line x1="${x}" y1="${TABLE_HEADER_Y + 14}" x2="${x}" y2="${TABLE_HEADER_Y + TABLE_HEADER_H - 14}" stroke="#FFFFFF" stroke-width="1.4" opacity="0.32"/>`)
    lines.push(`<line x1="${x}" y1="${TABLE_BODY_Y}" x2="${x}" y2="${tableBottom}" stroke="#ECECEC" stroke-width="1"/>`)
  })

  lines.push(`<line x1="${TABLE_X}" y1="${TABLE_BODY_Y}" x2="${TABLE_RIGHT}" y2="${TABLE_BODY_Y}" stroke="#DADADA" stroke-width="1.2"/>`)

  lines.push(`<text x="${COL_ITEM_X}" y="${TABLE_HEADER_Y + 48}" font-size="19" font-weight="bold" fill="white">ITEM</text>`)
  lines.push(`<text x="${COL_QTY_X}" y="${TABLE_HEADER_Y + 48}" font-size="19" font-weight="bold" fill="white" text-anchor="middle">QTY</text>`)
  lines.push(`<text x="${COL_RATE_X}" y="${TABLE_HEADER_Y + 48}" font-size="19" font-weight="bold" fill="white" text-anchor="end">RATE</text>`)
  lines.push(`<text x="${COL_AMT_X}" y="${TABLE_HEADER_Y + 48}" font-size="19" font-weight="bold" fill="white" text-anchor="end">AMOUNT</text>`)

  // Item rows
  data.items.forEach((item, i) => {
    const rowTop = TABLE_BODY_Y + i * ITEM_ROW_H
    const nameY  = rowTop + 45
    const descY  = nameY + 32
    const valueY = rowTop + 54
    const amount = (item.qty ?? 1) * item.rate
    lines.push(`<text x="${COL_ITEM_X}" y="${nameY}" font-size="22" font-weight="bold" fill="#1a1a1a">${escape(item.name)}</text>`)
    lines.push(`<text x="${COL_ITEM_X}" y="${descY}" font-size="15" fill="#666">${escape(item.description)}</text>`)
    lines.push(`<text x="${COL_QTY_X}" y="${valueY}" font-size="22" fill="#1a1a1a" text-anchor="middle">${item.qty ?? '-'}</text>`)
    lines.push(`<text x="${COL_RATE_X}" y="${valueY}" font-size="22" fill="#1a1a1a" text-anchor="end">${formatRp(item.rate)}</text>`)
    lines.push(`<text x="${COL_AMT_X}" y="${valueY}" font-size="22" font-weight="bold" fill="#1a1a1a" text-anchor="end">${formatRp(amount)}</text>`)
    const lineY = rowTop + ITEM_ROW_H
    if (i < data.items.length - 1) lines.push(`<line x1="${TABLE_X}" y1="${lineY}" x2="${TABLE_RIGHT}" y2="${lineY}" stroke="#EAEAEA" stroke-width="1"/>`)
  })

  lines.push(`<rect x="${TABLE_X}" y="${TABLE_HEADER_Y}" width="${TABLE_W}" height="${tableTotalH}" rx="10" fill="none" stroke="#D8D8D8" stroke-width="1.2"/>`)

  // Notes card
  lines.push(`<rect x="${NOTES_X}" y="${notesTop}" width="${NOTES_W}" height="${CARD_H}" rx="14" fill="#F5F3FF" stroke="#DDD8FE" stroke-width="1.5"/>`)
  lines.push(`<text x="${NOTES_X + 28}" y="${notesTop + 52}" font-size="24" font-weight="bold" fill="#6B46C1">NOTES</text>`)
  lines.push(`<text x="${NOTES_X + 28}" y="${notesTop + 113}" font-size="19" fill="#555">Price includes applicable tax and administrative</text>`)
  lines.push(`<text x="${NOTES_X + 28}" y="${notesTop + 142}" font-size="19" fill="#555">costs. Please send proof of payment after transfer.</text>`)

  // Subtotal card
  const RCX  = RIGHT_CARD_X     // label left edge
  const RCX2 = RIGHT_CARD_X + RIGHT_CARD_W  // right edge (text-anchor=end)

  lines.push(`<rect x="${RIGHT_CARD_X}" y="${notesTop}" width="${RIGHT_CARD_W}" height="${CARD_H}" rx="14" fill="white" stroke="#E8E4FF" stroke-width="1.5"/>`)

  const subY   = notesTop + 52
  const taxY   = subY + 54
  const divY   = taxY + 24
  const totalY = divY + 57

  lines.push(`<text x="${RCX + 28}" y="${subY}" font-size="21" fill="#888">Subtotal</text>`)
  lines.push(`<text x="${RCX2 - 20}" y="${subY}" font-size="21" fill="#333" text-anchor="end">${formatRp(total)}</text>`)

  lines.push(`<text x="${RCX + 28}" y="${taxY}" font-size="21" fill="#888">Tax</text>`)
  lines.push(`<text x="${RCX2 - 20}" y="${taxY}" font-size="21" font-weight="bold" fill="#6B46C1" text-anchor="end">Included</text>`)

  lines.push(`<line x1="${RCX + 28}" y1="${divY}" x2="${RCX2 - 20}" y2="${divY}" stroke="#e8e4ff" stroke-width="1"/>`)

  lines.push(`<text x="${RCX + 28}" y="${totalY}" font-size="26" font-weight="bold" fill="#1a1a1a">TOTAL DUE</text>`)
  lines.push(`<text x="${RCX2 - 20}" y="${totalY}" font-size="34" font-weight="bold" fill="#6B46C1" text-anchor="end">${formatRp(total)}</text>`)

  // Terms and conditions
  lines.push(`<text x="${CONTENT_X}" y="${termsTop + 40}" font-size="30" font-weight="bold" fill="#1a1a1a">TERMS &amp; CONDITIONS</text>`)
  const terms = [
    'Payment is due within 7 days from the invoice date.',
    'Invoice is valid without signature as a computer-generated document.',
    'Campaign deliverables, reports, and revisions follow the approved brief/SOW.',
  ]
  terms.forEach((term, i) => {
    const y = termsTop + 90 + i * 36
    const bulletColor = i % 2 === 0 ? BRAND_PURPLE : BRAND_BLUE
    lines.push(`<circle cx="${CONTENT_X + 18}" cy="${y - 7}" r="5.6" fill="${bulletColor}"/>`)
    lines.push(`<text x="${CONTENT_X + 40}" y="${y}" font-size="19" fill="#555">${escape(term)}</text>`)
  })

  // Footer text appears on every generated page.
  const pageCount = Math.ceil(svgHeight / PAGE_H)
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    addFooter(lines, pageIndex * PAGE_H)
  }

  const svg = `<svg width="${PAGE_W}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: "Helvetica Neue", Arial, sans-serif; }</style></defs>
  <text x="765" y="370" font-size="24" font-weight="bold" fill="#1a1a1a">${escape(data.invoiceNo)}</text>
  ${data.brandName ? `<text x="765" y="340" font-size="16" fill="#6B46C1">BRAND: ${escape(data.brandName.toUpperCase())}</text>` : ''}
  <text x="768" y="393" font-size="15" fill="#555">ISSUE DATE: ${escape(data.issueDate)}</text>
  <text x="120" y="590" font-size="21" font-weight="bold" fill="#1a1a1a">${escape(data.billTo)}</text>
  <text x="1130" y="790" font-size="21" font-weight="bold" fill="white" text-anchor="end">Due Date : ${escape(data.dueDate)}</text>
  ${lines.join('\n  ')}
</svg>`

  return { svg, svgHeight }
}

export async function generateInvoice(data: InvoiceData): Promise<{ localPath: string; driveUrl: string | null }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const total = data.items.reduce((sum, i) => sum + (i.qty ?? 1) * i.rate, 0)
  const { svg, svgHeight } = buildSvg(data, total)
  const renderW = PAGE_W * RENDER_SCALE
  const renderH = svgHeight * RENDER_SCALE
  const renderPageH = PAGE_H * RENDER_SCALE
  const highResSvg = scaleSvg(svg, renderW, svgHeight)

  // Base canvas: render at 2x so PDF text and lines stay sharper.
  let baseBuffer: Buffer
  if (svgHeight > PAGE_H) {
    const blank = await sharp({
      create: { width: renderW, height: renderH, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer()
    const template2x = await sharp(TEMPLATE)
      .resize(PAGE_W * RENDER_SCALE, PAGE_H * RENDER_SCALE, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
    baseBuffer = await sharp(blank)
      .composite([{ input: template2x, top: 0, left: 0 }])
      .png()
      .toBuffer()
  } else {
    baseBuffer = await sharp(TEMPLATE)
      .resize(renderW, renderH, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
  }

  const fullPng = await sharp(baseBuffer)
    .composite([{ input: Buffer.from(highResSvg), top: 0, left: 0 }])
    .png()
    .toBuffer()

  // PDF: slice into A4 pages
  const pdfDoc    = await PDFDocument.create()
  const PDF_W     = 595
  const PDF_H     = 842
  const scale     = PDF_W / renderW
  const pageCount = Math.ceil(svgHeight / PAGE_H)

  for (let p = 0; p < pageCount; p++) {
    const cropTop = p * renderPageH
    const cropH   = Math.min(renderPageH, renderH - cropTop)
    const slice   = await sharp(fullPng)
      .extract({ left: 0, top: cropTop, width: renderW, height: cropH })
      .png()
      .toBuffer()
    const img  = await pdfDoc.embedPng(slice)
    const page = pdfDoc.addPage([PDF_W, PDF_H])
    page.drawImage(img, { x: 0, y: PDF_H - cropH * scale, width: PDF_W, height: cropH * scale })
  }

  const fileName   = `Invoice AZERAKOL.ID_${data.campaign}_${data.invoiceNo}.pdf`
  const outputPath = path.join(OUTPUT_DIR, fileName)
  const pdfBytes   = await pdfDoc.save()
  fs.writeFileSync(outputPath, pdfBytes)

  let driveUrl: string | null = null
  try {
    const drive = getDriveUploadClient()
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [DRIVE_FOLDER_ID],
      },
      media: {
        mimeType: 'application/pdf',
        body: Readable.from(Buffer.from(pdfBytes)),
      },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    })
    driveUrl = res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`
    console.log(`[Invoice] Uploaded to Drive: ${driveUrl}`)
  } catch (err) {
    console.error('[Invoice] Drive upload failed:', err)
  }

  return { localPath: outputPath, driveUrl }
}
