export type TransactionType = 'Pemasukan' | 'Pengeluaran'

export interface Transaction {
  timestamp: string  // ISO datetime
  tanggal: string    // YYYY-MM-DD
  tipe: TransactionType
  kategori: string
  deskripsi: string
  nominal: number
  source: string
}

export interface ParseResult {
  success: boolean
  transaction?: Pick<Transaction, 'tipe' | 'kategori' | 'deskripsi' | 'nominal'>
  error?: string
}

export interface MonthlySummary {
  totalMasuk: number
  totalKeluar: number
  net: number
  savingsRate: number
}

export interface CategorySummary {
  kategori: string
  total: number
}
