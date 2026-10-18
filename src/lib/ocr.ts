import { createWorker } from 'tesseract.js'

export async function recognizeText(image: string, onProgress: (progress: number) => void): Promise<string> {
  const worker = await createWorker('chi_sim+eng', undefined, {
    logger(message) {
      if (message.status === 'recognizing text') onProgress(message.progress)
    }
  })
  try {
    const result = await worker.recognize(image)
    return result.data.text.trim()
  } finally {
    await worker.terminate()
  }
}
