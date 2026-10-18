export type ScanFilter = 'color' | 'gray' | 'bw'

export interface ScanPage {
  id: string
  originalDataUrl: string
  dataUrl: string
  filter: ScanFilter
  ocrText: string
}

export interface ScanDocument {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pages: ScanPage[]
}
