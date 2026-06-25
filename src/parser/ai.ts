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

function buildPrompt(tipeHint?: string): string {
  const tipeRule = tipeHint
    ? `TIPE SUDAH DITENTUKAN: "${tipeHint}". Gunakan ini, jangan tentukan sendiri.`
    : 'Tentukan tipe dari konteks pesan (Pemasukan atau Pengeluaran).'

  return `Kamu adalah parser transaksi keuangan. Ekstrak informasi dari pesan bahasa Indonesia.

Pesan bisa berupa teks biasa atau hasil scan OCR struk belanja (kotor). Jika ini struk belanja, cari TOTAL BELANJA (nilai terbesar, biasanya di baris terakhir).

${tipeRule}

Balas HANYA dengan JSON valid, tanpa komentar, tanpa markdown:
{
  "tipe": "Pemasukan" | "Pengeluaran",
  "nominal": <angka, tanpa titik/koma pemisah ribu>,
  "kategori": "<salah satu dari list>",
  "deskripsi": "<deskripsi singkat>"
}

Kategori Pemasukan: Gaji, Freelance, Bisnis, Investasi, Hadiah, Lainnya
Kategori Pengeluaran: Makanan, Transport, Belanja, Utilitas, Kesehatan, Hiburan, Pendidikan, Tabungan, Investasi, Lainnya

Jika bukan transaksi keuangan, balas: {"error": "bukan transaksi"}`

}

export async function parseWithAI(text: string, tipeHint?: string): Promise<ParseResult> {
  try {
    const response = await getClient().chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildPrompt(tipeHint) },
        { role: 'user', content: text.slice(0, 3000) },
      ],
      temperature: 0,
      max_tokens: 500,
    })

    const raw = response.choices[0]?.message?.content
    if (!raw) return { success: false, error: 'AI tidak merespons' }

    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { success: false, error: 'Respons AI tidak valid' }

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return { success: false, error: 'Respons AI tidak valid' }
    }

    if (parsed.error) return { success: false, error: parsed.error }

    if (!parsed.tipe || !parsed.nominal || parsed.nominal <= 0) {
      return { success: false, error: 'Data tidak lengkap dari AI' }
    }

    return {
      success: true,
      transaction: {
        tipe: parsed.tipe,
        kategori: parsed.kategori || 'Lainnya',
        deskripsi: text.trim().slice(0, 200),
        nominal: Number(parsed.nominal),
      },
    }
  } catch (err) {
    console.error('[AI Parser]', err)
    return { success: false, error: 'AI parser error' }
  }
}
