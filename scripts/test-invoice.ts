import { generateInvoice } from '../src/invoice/generator'
import { InvoiceData } from '../src/invoice/types'
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

const data: InvoiceData = {
  invoiceNo: 'INV-AZK-202605-014',
  issueDate: '29 MAY 2026',
  dueDate: '5 June 2026',
  billTo: 'Pintarnya',
  campaign: 'Pigeon May',
  brandName: 'Nike',
  items: [
    { name: 'Pigeon May Nano',  description: '1x VT + YC + IG Reels', qty: 17, rate: 150_000 },
    { name: 'Pigeon May Micro', description: '1x VT + YC + IG Reels', qty: 15, rate: 250_000 },
    { name: 'Pigeon May Macro', description: '1x VT + YC + IG Reels', qty: 8, rate: 350_000 },
    { name: 'Pigeon May Max', description: '1x VT + YC + IG Reels', qty: 4, rate: 500_000 },
  ],
}

generateInvoice(data).then(async (pdfPath) => {
  console.log('PDF saved:', pdfPath)

  // Also save a PNG preview in assets/ for quick visual check
  const assetsDir = path.join(process.cwd(), 'assets')
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir)

  // Re-render PNG preview at half resolution for quick viewing
  // (just re-run the same logic from the PDF's first page region)
  console.log('Done — check', pdfPath)
}).catch(console.error)
