import { runInvoiceOcr } from './ocr.js';
import { analyzeInvoiceWithGroq, isGroqConfigured } from './groq-invoice.js';

function groqFailedResult(message) {
  return {
    invoiceDate: null,
    amountTtc: null,
    vendorName: null,
    ocrStatus: 'failed',
    ocrRaw: `groq: ${message}`.slice(0, 8000),
    analyzer: 'groq',
  };
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL);
}

export async function analyzeInvoice(buffer, mimeType, fileName = '') {
  if (isGroqConfigured()) {
    try {
      return await analyzeInvoiceWithGroq(buffer, mimeType, fileName);
    } catch (err) {
      const msg = err?.message || String(err);
      console.warn('[analyzeInvoice] Groq échoué:', msg);
      if (isServerlessRuntime()) {
        return groqFailedResult(msg);
      }
    }
  }

  if (isServerlessRuntime()) {
    return groqFailedResult('GROQ_API_KEY manquant sur Vercel');
  }

  const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
  return { ...ocr, analyzer: 'tesseract' };
}
