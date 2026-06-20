import { runInvoiceOcr } from './ocr.js';
import { analyzeInvoiceWithGroq, isGroqConfigured } from './groq-invoice.js';

export async function analyzeInvoice(buffer, mimeType, fileName = '') {
  if (isGroqConfigured()) {
    try {
      return await analyzeInvoiceWithGroq(buffer, mimeType, fileName);
    } catch (err) {
      console.warn('[analyzeInvoice] Groq échoué, repli OCR local:', err.message);
    }
  }

  const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
  return { ...ocr, analyzer: 'tesseract' };
}
