import Tesseract from 'tesseract.js'
import { parseWithAI } from '../parser/ai'
import { ParseResult, TransactionType } from '../types'

function cleanOcrText(raw: string): string {
  const lines = raw.split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (!l || l.length < 2) return false
      if (/^[\d%]+$/.test(l)) return false
      return true
    })

  return lines.join('\n')
}

export async function parseImage(
  imageBuffer: Buffer,
  mimeType: string,
  tipe?: TransactionType,
  description?: string
): Promise<ParseResult> {
  try {
    console.log('[Vision] Running OCR with Tesseract...')

    const { data } = await Tesseract.recognize(imageBuffer, 'eng+ind', {
      logger: (info) => {
        if (info.status === 'recognizing text') {
          console.log(`[Vision OCR] ${Math.round(info.progress * 100)}%`)
        }
      },
    })

    const cleaned = cleanOcrText(data.text)
    console.log(`[Vision OCR] Cleaned text:\n${cleaned}`)

    if (!cleaned) {
      return { success: false, error: 'Tidak ada teks terbaca dari gambar.' }
    }

    const desc = description || ''
    const combined = [desc, cleaned].filter(Boolean).join('\n')

    console.log('[Vision] Parsing with DeepSeek AI...')
    const aiResult = await parseWithAI(combined, tipe)
    if (aiResult.success) {
      console.log('[Vision] DeepSeek AI parser succeeded')
    }
    return aiResult
  } catch (err) {
    console.error('[Vision] Error:', err)
    return { success: false, error: 'Gagal memproses foto.' }
  }
}
