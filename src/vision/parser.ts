import Tesseract from 'tesseract.js'
import { parseWithAI } from '../parser/ai'
import { parseMessage } from '../parser/regex'
import { ParseResult } from '../types'

export async function parseImage(
  imageBuffer: Buffer,
  mimeType: string,
  caption?: string
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

    const rawText = data.text.trim()
    console.log(`[Vision OCR] Raw text:\n${rawText}`)

    if (!rawText) {
      return { success: false, error: 'Tidak ada teks terbaca dari gambar.' }
    }

    // Use caption + OCR text for parsing
    const combined = [caption, rawText].filter(Boolean).join('\n')

    // Try regex parser first (fast path)
    const regexResult = parseMessage(combined)
    if (regexResult.success && regexResult.transaction) {
      console.log('[Vision] Regex parser succeeded')
      return regexResult
    }

    // Fallback to DeepSeek AI parser
    console.log('[Vision] Regex failed, trying DeepSeek AI...')
    const aiResult = await parseWithAI(combined)
    if (aiResult.success) {
      console.log('[Vision] DeepSeek AI parser succeeded')
    }
    return aiResult
  } catch (err) {
    console.error('[Vision] Error:', err)
    return { success: false, error: 'Gagal memproses foto.' }
  }
}
