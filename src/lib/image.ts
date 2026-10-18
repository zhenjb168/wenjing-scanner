import type { ScanFilter, ScanPage } from '../types'

const MAX_EDGE = 2200

function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): string {
  return canvas.toDataURL('image/jpeg', quality)
}

async function decode(source: Blob | string): Promise<ImageBitmap> {
  if (typeof source !== 'string') return createImageBitmap(source, { imageOrientation: 'from-image' })
  const response = await fetch(source)
  return createImageBitmap(await response.blob())
}

function fitSize(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function edgeCrop(canvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number } {
  const sample = document.createElement('canvas')
  const scale = Math.min(1, 720 / Math.max(canvas.width, canvas.height))
  sample.width = Math.max(1, Math.round(canvas.width * scale))
  sample.height = Math.max(1, Math.round(canvas.height * scale))
  const context = sample.getContext('2d', { willReadFrequently: true })!
  context.drawImage(canvas, 0, 0, sample.width, sample.height)
  const { data } = context.getImageData(0, 0, sample.width, sample.height)
  const gray = new Uint8Array(sample.width * sample.height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10

  const col = new Float64Array(sample.width)
  const row = new Float64Array(sample.height)
  for (let y = 1; y < sample.height - 1; y++) {
    for (let x = 1; x < sample.width - 1; x++) {
      const p = y * sample.width + x
      const strength = Math.abs(gray[p + 1] - gray[p - 1]) + Math.abs(gray[p + sample.width] - gray[p - sample.width])
      col[x] += strength
      row[y] += strength
    }
  }

  const peak = (values: Float64Array, start: number, end: number) => {
    let best = start
    for (let i = start + 1; i <= end; i++) if (values[i] > values[best]) best = i
    return best
  }
  const left = peak(col, Math.floor(sample.width * 0.02), Math.floor(sample.width * 0.35))
  const right = peak(col, Math.floor(sample.width * 0.65), Math.floor(sample.width * 0.98))
  const top = peak(row, Math.floor(sample.height * 0.02), Math.floor(sample.height * 0.35))
  const bottom = peak(row, Math.floor(sample.height * 0.65), Math.floor(sample.height * 0.98))
  const detectedArea = ((right - left) * (bottom - top)) / (sample.width * sample.height)
  if (detectedArea < 0.48) return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  return {
    x: Math.round(left / scale),
    y: Math.round(top / scale),
    width: Math.round((right - left) / scale),
    height: Math.round((bottom - top) / scale)
  }
}

export async function preparePage(file: File): Promise<ScanPage> {
  const bitmap = await decode(file)
  const size = fitSize(bitmap.width, bitmap.height)
  const source = document.createElement('canvas')
  source.width = size.width
  source.height = size.height
  source.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const crop = edgeCrop(source)
  const result = document.createElement('canvas')
  result.width = crop.width
  result.height = crop.height
  result.getContext('2d')!.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  const dataUrl = canvasToJpeg(result)
  return { id: crypto.randomUUID(), originalDataUrl: dataUrl, dataUrl, filter: 'color', ocrText: '' }
}

export async function applyFilter(page: ScanPage, filter: ScanFilter): Promise<ScanPage> {
  const bitmap = await decode(page.originalDataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: filter !== 'color' })!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  if (filter !== 'color') {
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < image.data.length; i += 4) {
      const value = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114
      const output = filter === 'bw' ? (value > 158 ? 255 : 18) : Math.min(255, Math.max(0, (value - 128) * 1.18 + 138))
      image.data[i] = image.data[i + 1] = image.data[i + 2] = output
    }
    context.putImageData(image, 0, 0)
  }
  return { ...page, dataUrl: canvasToJpeg(canvas), filter }
}

async function rotateDataUrl(dataUrl: string): Promise<string> {
  const bitmap = await decode(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.height
  canvas.height = bitmap.width
  const context = canvas.getContext('2d')!
  context.translate(canvas.width, 0)
  context.rotate(Math.PI / 2)
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvasToJpeg(canvas)
}

export async function rotatePage(page: ScanPage): Promise<ScanPage> {
  const originalDataUrl = await rotateDataUrl(page.originalDataUrl)
  return applyFilter({ ...page, originalDataUrl, dataUrl: originalDataUrl }, page.filter)
}
