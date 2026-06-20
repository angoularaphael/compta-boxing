import pdf from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { extractInvoiceFields } from './extract-invoice.js';

export async function extractTextFromPdf(buffer) {
  try {
    const result = await pdf(buffer);
    return (result.text || '').trim();
  } catch {
    return '';
  }
}

export async function extractTextFromImage(buffer) {
  try {
    const { data } = await Tesseract.recognize(buffer, 'fra', {
      logger: () => {},
    });
    return (data.text || '').trim();
  } catch {
    return '';
  }
}

export async function runInvoiceOcr(buffer, mimeType, fileName = '') {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  let text = '';

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    text = await extractTextFromPdf(buffer);
    if (text.length < 40) {
      text = await extractTextFromImage(buffer);
    }
  } else if (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(name)) {
    text = await extractTextFromImage(buffer);
  } else {
    text = await extractTextFromPdf(buffer);
    if (!text) text = await extractTextFromImage(buffer);
  }

  if (!text) {
    return {
      invoiceDate: null,
      amountTtc: null,
      vendorName: null,
      ocrStatus: 'failed',
      ocrRaw: '',
    };
  }

  return extractInvoiceFields(text);
}
