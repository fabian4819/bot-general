export interface InvoiceItem {
  name: string
  description: string
  qty: number | null
  rate: number | null
}

export interface InvoiceData {
  invoiceNo: string
  issueDate: string    // formatted: "29 MAY 2026"
  dueDate: string      // formatted: "5 June 2026"
  billTo: string
  campaign: string
  items: InvoiceItem[]
}

export type WizardStep =
  | 'BILL_TO'
  | 'CAMPAIGN'
  | 'ITEM_NAME'
  | 'ITEM_DESC'
  | 'ITEM_QTY'
  | 'ITEM_RATE'
  | 'MORE_ITEMS'

export interface WizardState {
  step: WizardStep
  data: Partial<InvoiceData> & { items: InvoiceItem[] }
  currentItem: Partial<InvoiceItem>
}
