import { ParseResult, TransactionType } from '../types'

const PEMASUKAN_KEYWORDS =
  /\b(terima|dapat|dapet|masuk|gaji|transfer masuk|income|pendapatan|bayaran|untung|profit|hasil|freelance|proyek|project)\b/i

const PENGELUARAN_KEYWORDS =
  /\b(beli|bayar|bayar|keluar|spend|habis|belanja|makan|minum|bensin|bbm|bayar|byr|jajan|ngeluarin|ngeluarkan|abis)\b/i

const KATEGORI_PEMASUKAN: Record<string, RegExp> = {
  Gaji:      /\b(gaji|salary|upah|thr)\b/i,
  Freelance: /\b(freelance|proyek|project|klien|client|job)\b/i,
  Bisnis:    /\b(bisnis|usaha|jualan|jual|dagang|untung|profit)\b/i,
  Investasi: /\b(investasi|dividen|saham|crypto|bunga|return)\b/i,
  Hadiah:    /\b(hadiah|bonus|kado|gift|reward)\b/i,
}

const KATEGORI_PENGELUARAN: Record<string, RegExp> = {
  Makanan:    /\b(makan|minum|kopi|coffee|resto|warteg|restoran|warung|nasi|ayam|pizza|burger|cafe|bakso|soto|jajan|snack|mie|indomie)\b/i,
  Transport:  /\b(bensin|bbm|pertamax|gojek|grab|taxi|parkir|tol|krl|mrt|busway|ojek|motor|mobil|uber|angkot|transjakarta|kereta)\b/i,
  Belanja:    /\b(shopee|tokopedia|lazada|amazon|toko|mall|supermarket|indomaret|alfamart|beli|belanja|pakaian|baju|sepatu)\b/i,
  Utilitas:   /\b(listrik|pln|air|pdam|internet|wifi|telpon|pulsa|tagihan|token)\b/i,
  Kesehatan:  /\b(dokter|rumah sakit|rs|obat|apotek|klinik|vitamin|gym|fitness|kesehatan)\b/i,
  Hiburan:    /\b(nonton|bioskop|netflix|spotify|game|main|liburan|wisata|hiburan|disney)\b/i,
  Pendidikan: /\b(kursus|les|buku|sekolah|kuliah|kampus|kelas|training|workshop)\b/i,
  Tabungan:   /\b(tabungan|saving|simpan|deposito)\b/i,
  Investasi:  /\b(investasi|saham|reksadana|crypto|reksa dana)\b/i,
}

function parseNominal(text: string): number | null {
  // Normalize: remove spaces around numbers
  const normalized = text.toLowerCase().trim()

  // Try to extract number with Indonesian suffixes
  // Handles: 45rb, 1.5jt, 2,5jt, 500.000, 1.500.000, 45000, 450k, 1m, 1 juta, 500 ribu
  const patterns = [
    // "1.5jt" / "2,5jt" / "1,5 juta"
    { re: /(\d+)[.,](\d+)\s*(jt|juta|j)\b/, fn: (m: RegExpMatchArray) => (parseInt(m[1]) + parseInt(m[2]) / Math.pow(10, m[2].length)) * 1_000_000 },
    // "5jt" / "5 juta"
    { re: /(\d+)\s*(jt|juta|j)\b/, fn: (m: RegExpMatchArray) => parseInt(m[1]) * 1_000_000 },
    // "1.5rb" / "500rb" / "500 ribu"
    { re: /(\d+)[.,](\d+)\s*(rb|ribu|rbu)\b/, fn: (m: RegExpMatchArray) => (parseInt(m[1]) + parseInt(m[2]) / Math.pow(10, m[2].length)) * 1_000 },
    // "500rb" / "500 ribu"
    { re: /(\d+)\s*(rb|ribu|rbu|k)\b/, fn: (m: RegExpMatchArray) => parseInt(m[1]) * 1_000 },
    // "1.500.000" or "1,500,000" (thousands separator)
    { re: /(\d{1,3}(?:[.,]\d{3})+)(?![.,]\d)/, fn: (m: RegExpMatchArray) => parseInt(m[1].replace(/[.,]/g, '')) },
    // "500000" plain number >= 1000
    { re: /\b(\d{4,})\b/, fn: (m: RegExpMatchArray) => parseInt(m[1]) },
    // "500" plain number < 1000 (treated as thousands if no suffix)
    { re: /\b(\d{1,3})\b/, fn: (m: RegExpMatchArray) => parseInt(m[1]) },
  ]

  for (const { re, fn } of patterns) {
    const match = normalized.match(re)
    if (match) {
      const value = fn(match)
      if (!isNaN(value) && value > 0) return value
    }
  }

  return null
}

function detectKategori(text: string, tipe: TransactionType): string {
  const map = tipe === 'Pemasukan' ? KATEGORI_PEMASUKAN : KATEGORI_PENGELUARAN
  for (const [kategori, re] of Object.entries(map)) {
    if (re.test(text)) return kategori
  }
  return 'Lainnya'
}

export function parseMessage(text: string): ParseResult {
  const lower = text.toLowerCase()

  const isPemasukan = PEMASUKAN_KEYWORDS.test(lower)
  const isPengeluaran = PENGELUARAN_KEYWORDS.test(lower)

  // Need at least one classification signal
  if (!isPemasukan && !isPengeluaran) {
    return { success: false, error: 'Tidak terdeteksi sebagai transaksi' }
  }

  const nominal = parseNominal(text)
  if (!nominal) {
    return { success: false, error: 'Nominal tidak ditemukan' }
  }

  // If both match, pick the stronger signal (more keywords)
  const tipe: TransactionType = isPemasukan && !isPengeluaran ? 'Pemasukan' : 'Pengeluaran'
  const kategori = detectKategori(lower, tipe)

  return {
    success: true,
    transaction: {
      tipe,
      kategori,
      deskripsi: text.trim(),
      nominal,
    },
  }
}
