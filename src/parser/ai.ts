import OpenAI from 'openai'
import { ParseResult } from '../types'

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set')
    client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: 'https://api.deepseek.com',
    })
  }
  return client
}

const SYSTEM_PROMPT = `Kamu adalah parser transaksi keuangan. Ekstrak informasi dari pesan bahasa Indonesia.

Balas HANYA dengan JSON valid, tanpa komentar:
{
  "tipe": "Pemasukan" | "Pengeluaran",
  "nominal": <angka, tanpa titik/koma pemisah ribu>,
  "kategori": <salah satu dari list>,
  "deskripsi": <teks asli>
}

Kategori Pemasukan: Gaji, Freelance, Bisnis, Investasi, Hadiah, Lainnya
Kategori Pengeluaran: Makanan, Transport, Belanja, Utilitas, Kesehatan, Hiburan, Pendidikan, Tabungan, Investasi, Lainnya

Jika bukan transaksi keuangan, balas: {"error": "bukan transaksi"}`

export async function parseWithAI(text: string): Promise<ParseResult> {
  try {
    const response = await getClient().chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 150,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) return { success: false, error: 'AI tidak merespons' }

    const parsed = JSON.parse(raw)

    if (parsed.error) return { success: false, error: parsed.error }

    if (!parsed.tipe || !parsed.nominal || parsed.nominal <= 0) {
      return { success: false, error: 'Data tidak lengkap dari AI' }
    }

    return {
      success: true,
      transaction: {
        tipe: parsed.tipe,
        kategori: parsed.kategori || 'Lainnya',
        deskripsi: text.trim(),
        nominal: Number(parsed.nominal),
      },
    }
  } catch (err) {
    console.error('[AI Parser]', err)
    return { success: false, error: 'AI parser error' }
  }
}
