import { PDFDocument } from 'pdf-lib'
import type { ScanDocument } from '../types'

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(',')[1])
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export async function createPdf(document: ScanDocument): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(document.title)
  pdf.setCreator('文镜')
  for (const page of document.pages) {
    const image = await pdf.embedJpg(dataUrlBytes(page.dataUrl))
    const a4 = image.width > image.height ? { width: 841.89, height: 595.28 } : { width: 595.28, height: 841.89 }
    const output = pdf.addPage([a4.width, a4.height])
    const scale = Math.min(a4.width / image.width, a4.height / image.height)
    const width = image.width * scale
    const height = image.height * scale
    output.drawImage(image, { x: (a4.width - width) / 2, y: (a4.height - height) / 2, width, height })
  }
  const bytes = await pdf.save()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type: 'application/pdf' })
}

export async function sharePdf(document: ScanDocument) {
  const blob = await createPdf(document)
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = `${document.title || '扫描文档'}.pdf`
  anchor.style.display = 'none'
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
