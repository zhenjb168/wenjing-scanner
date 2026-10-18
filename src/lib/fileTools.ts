import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import type { ScanDocument } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href

type PdfTextItem = { str: string; transform: number[]; width: number }

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '') || '文镜文档'
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || '文镜文档'
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeName(name)
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

async function loadPdf(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return PDFDocument.load(bytes, { ignoreEncryption: false })
}

async function pdfjsDocument(file: File) {
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

function asBlob(bytes: Uint8Array, type: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type })
}

export async function mergePdfs(files: File[]) {
  if (files.length < 2) throw new Error('请选择至少两个 PDF 文件')
  const output = await PDFDocument.create()
  output.setCreator('文镜')
  for (const file of files) {
    const source = await loadPdf(file)
    const pages = await output.copyPages(source, source.getPageIndices())
    pages.forEach(page => output.addPage(page))
  }
  downloadBlob(asBlob(await output.save({ useObjectStreams: true }), 'application/pdf'), '文镜-合并文档.pdf')
}

export async function splitPdf(file: File) {
  const source = await loadPdf(file)
  const zip = new JSZip()
  for (let index = 0; index < source.getPageCount(); index++) {
    const output = await PDFDocument.create()
    const [page] = await output.copyPages(source, [index])
    output.addPage(page)
    zip.file(`${baseName(file.name)}-${String(index + 1).padStart(3, '0')}.pdf`, await output.save())
  }
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${baseName(file.name)}-拆分.zip`)
}

async function getPageItems(page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjsDocument>>['getPage']>>) {
  const content = await page.getTextContent()
  return content.items
    .filter((item): item is PdfTextItem & typeof item => 'str' in item && Boolean(item.str.trim()))
    .map(item => ({ str: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width }))
}

function rowsFromItems(items: { str: string; x: number; y: number; width: number }[]) {
  const rows: typeof items[] = []
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - item.y) <= 4)
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows.map(row => row.sort((a, b) => a.x - b.x))
}

function cellsFromRow(row: { str: string; x: number; width: number }[]) {
  const cells: string[] = []
  let current = ''
  let end = 0
  row.forEach((item, index) => {
    const gap = index ? item.x - end : 0
    if (index && gap > 24) {
      cells.push(current.trim())
      current = item.str
    } else {
      current += `${current ? ' ' : ''}${item.str}`
    }
    end = item.x + item.width
  })
  if (current) cells.push(current.trim())
  return cells
}

export async function pdfToImages(file: File, onProgress?: (label: string) => void) {
  const pdf = await pdfjsDocument(file)
  const zip = new JSZip()
  for (let number = 1; number <= pdf.numPages; number++) {
    onProgress?.(`正在渲染第 ${number}/${pdf.numPages} 页…`)
    const page = await pdf.getPage(number)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图像画布')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败')), 'image/jpeg', 0.92))
    zip.file(`${baseName(file.name)}-${String(number).padStart(3, '0')}.jpg`, blob)
  }
  downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${baseName(file.name)}-图片.zip`)
}

export async function pdfToWord(file: File, onProgress?: (label: string) => void) {
  const pdf = await pdfjsDocument(file)
  const children: Paragraph[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    onProgress?.(`正在提取第 ${number}/${pdf.numPages} 页文字…`)
    const page = await pdf.getPage(number)
    const rows = rowsFromItems(await getPageItems(page))
    children.push(new Paragraph({ text: `第 ${number} 页`, heading: HeadingLevel.HEADING_1 }))
    if (rows.length) rows.forEach(row => children.push(new Paragraph(cellsFromRow(row).join('\t'))))
    else children.push(new Paragraph({ children: [new TextRun({ text: '此页没有可提取文字，可能是扫描图片。', italics: true })] }))
    if (number < pdf.numPages) children.push(new Paragraph({ children: [new PageBreak()] }))
  }
  const doc = new Document({ sections: [{ children }] })
  downloadBlob(await Packer.toBlob(doc), `${baseName(file.name)}.docx`)
}

export async function pdfToExcel(file: File, onProgress?: (label: string) => void) {
  const pdf = await pdfjsDocument(file)
  const sheets: { name: string; rows: string[][] }[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    onProgress?.(`正在分析第 ${number}/${pdf.numPages} 页表格…`)
    const page = await pdf.getPage(number)
    const rows = rowsFromItems(await getPageItems(page)).map(cellsFromRow)
    sheets.push({ name: `第${number}页`, rows: rows.length ? rows : [['此页没有可提取文字']] })
  }
  downloadBlob(await createXlsx(sheets), `${baseName(file.name)}.xlsx`)
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function columnName(index: number) {
  let name = ''
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  return name
}

async function createXlsx(sheets: { name: string; rows: string[][] }[]) {
  const zip = new JSZip()
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`)
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const sheetRefs = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetRefs}</sheets></workbook>`)
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>')
  sheets.forEach((sheet, sheetIndex) => {
    const maxColumns = Math.max(1, ...sheet.rows.map(row => row.length))
    const columns = Array.from({ length: maxColumns }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="20" customWidth="1"/>`).join('')
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`).join('')}</row>`).join('')
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${columns}</cols><sheetData>${rows}</sheetData></worksheet>`)
  })
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

function decodeXmlText(value: string) {
  const node = new DOMParser().parseFromString(value, 'application/xml')
  return Array.from(node.getElementsByTagNameNS('*', 't')).map(item => item.textContent?.trim()).filter(Boolean) as string[]
}

export async function pptToWord(file: File, onProgress?: (label: string) => void) {
  const zip = await JSZip.loadAsync(file)
  const slides = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  if (!slides.length) throw new Error('没有在文件中找到 PPT 幻灯片')
  const children: Paragraph[] = []
  for (let index = 0; index < slides.length; index++) {
    onProgress?.(`正在读取第 ${index + 1}/${slides.length} 张幻灯片…`)
    const xml = await zip.file(slides[index])?.async('string')
    const texts = xml ? decodeXmlText(xml) : []
    children.push(new Paragraph({ text: `幻灯片 ${index + 1}`, heading: HeadingLevel.HEADING_1 }))
    texts.forEach((text, textIndex) => children.push(new Paragraph({ children: [new TextRun({ text, bold: textIndex === 0 })], bullet: textIndex ? { level: 0 } : undefined })))
    if (!texts.length) children.push(new Paragraph('此页没有可提取文字。'))
    if (index < slides.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }))
  }
  downloadBlob(await Packer.toBlob(new Document({ sections: [{ children }] })), `${baseName(file.name)}.docx`)
}

export async function scanToWord(scan: ScanDocument) {
  const children: Paragraph[] = [new Paragraph({ text: scan.title, heading: HeadingLevel.TITLE })]
  scan.pages.forEach((page, index) => {
    children.push(new Paragraph({ text: `第 ${index + 1} 页`, heading: HeadingLevel.HEADING_1 }))
    const lines = page.ocrText.trim().split(/\n+/).filter(Boolean)
    if (lines.length) lines.forEach(line => children.push(new Paragraph(line)))
    else children.push(new Paragraph({ children: [new TextRun({ text: '本页尚未识别文字。', italics: true })] }))
    if (index < scan.pages.length - 1) children.push(new Paragraph({ children: [new PageBreak()] }))
  })
  downloadBlob(await Packer.toBlob(new Document({ sections: [{ children }] })), `${scan.title || '扫描文档'}.docx`)
}
