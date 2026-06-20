import { readFileSync } from 'fs';
import { analyzeInvoiceWithGroq } from '../lib/groq-invoice.js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const fakePdf = Buffer.from(
  'Facture CARREFOUR MARKET\nDate: 15/03/2026\nTotal TTC: 42,50 EUR\nSIRET 123'
);

console.log('Testing Groq text (PDF path)...');
const r1 = await analyzeInvoiceWithGroq(fakePdf, 'application/pdf', 'facture.pdf');
console.log(JSON.stringify(r1, null, 2));

console.log('\nVision model:', process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct');
