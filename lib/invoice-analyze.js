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
  let groqError = null;

  if (isGroqConfigured()) {
    try {
      return await analyzeInvoiceWithGroq(buffer, mimeType, fileName);
    } catch (err) {
      groqError = err?.message || String(err);
      console.warn('[analyzeInvoice] Groq échoué:', groqError);
    }
  } else if (isServerlessRuntime()) {
    return groqFailedResult('GROQ_API_KEY manquant sur Vercel');
  }

  try {
    const ocr = await runInvoiceOcr(buffer, mimeType, fileName);
    if (ocr.ocrStatus !== 'failed') {
      return { ...ocr, analyzer: 'tesseract' };
    }
  } catch (err) {
    console.warn('[analyzeInvoice] Tesseract échoué:', err?.message || err);
  }

  if (groqError) return groqFailedResult(groqError);
  return groqFailedResult('Analyse impossible');
}
