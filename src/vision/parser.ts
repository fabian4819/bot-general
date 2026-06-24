import { GoogleGenerativeAI } from '@google/generative-ai'
import { ParseResult } from '../types'

let genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY not set')
    genAI = new GoogleGenerativeAI(key)
  }
  return genAI
}

const PROMPT = `Kamu adalah asisten pencatat keuangan. Dari foto nota/struk/invoice ini, ekstrak informasi transaksi.

Perhatikan:
- Cari TOTAL PEMBAYARAN (jumlah yang dibayar, bukan subtotal)
- Jika ada diskon, ambil nominal setelah diskon
- Default: ini PENGELUARAN (kecuali jelas-jelas tanda terima uang masuk)
- Deskripsi: nama toko dan ringkasan item

Balas HANYA dengan JSON valid, tanpa komentar:
{
  "tipe": "Pemasukan" | "Pengeluaran",
  "nominal": <angka, tanpa titik/koma pemisah ribu>,
  "kategori": "<salah satu dari list>",
  "deskripsi": "<nama toko - item utama>"
}

Kategori Pemasukan: Gaji, Freelance, Bisnis, Investasi, Hadiah, Lainnya
Kategori Pengeluaran: Makanan, Transport, Belanja, Utilitas, Kesehatan, Hiburan, Pendidikan, Tabungan, Investasi, Lainnya

Jika foto bukan nota/struk/invoice transaksi, balas: {"error": "bukan nota"}`

export async function parseImage(
  imageBuffer: Buffer,
  mimeType: string,
  caption?: string
): Promise<ParseResult> {
  try {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' })

    const parts: any[] = [
      {
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType,
        },
      },
      { text: PROMPT },
    ]

    if (caption) {
      parts.push({ text: `Catatan pengirim: "${caption}"` })
    }

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] })
    const response = result.response
    const raw = response.text().trim()

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { success: false, error: 'Respons AI tidak valid' }

    const parsed = JSON.parse(jsonMatch[0])

    if (parsed.error) return { success: false, error: parsed.error }

    if (!parsed.tipe || !parsed.nominal || parsed.nominal <= 0) {
      return { success: false, error: 'Data tidak lengkap dari AI' }
    }

    return {
      success: true,
      transaction: {
        tipe: parsed.tipe,
        kategori: parsed.kategori || 'Lainnya',
        deskripsi: parsed.deskripsi || (caption || 'Transaksi dari foto'),
        nominal: Number(parsed.nominal),
      },
    }
  } catch (err) {
    console.error('[Vision Parser]', err)
    return { success: false, error: 'Vision parser error' }
  }
}
