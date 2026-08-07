import { inflateSync } from 'zlib';

/**
 * Extrait le texte lisible des flux PDF (PDFKit / FlateDecode) quand pdf-parse échoue
 * (ex. xref cassé → « bad XRef entry »).
 */
export function extractTextFromPdfStreams(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const parts = [];
  let cursor = 0;

  while (cursor < buf.length) {
    const streamIdx = buf.indexOf(Buffer.from('stream'), cursor);
    if (streamIdx < 0) break;

    let dataStart = streamIdx + 6;
    if (buf[dataStart] === 0x0d) dataStart += 1;
    if (buf[dataStart] === 0x0a) dataStart += 1;

    const endIdx = buf.indexOf(Buffer.from('endstream'), dataStart);
    if (endIdx < 0) break;

    let dataEnd = endIdx;
    while (dataEnd > dataStart && (buf[dataEnd - 1] === 0x0a || buf[dataEnd - 1] === 0x0d)) {
      dataEnd -= 1;
    }

    const raw = buf.subarray(dataStart, dataEnd);
    let content = null;
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1');
    }

    const text = decodePdfContentOperators(content);
    if (text) parts.push(text);
    cursor = endIdx + 9;
  }

  return parts.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

function decodePdfContentOperators(content) {
  if (!content) return '';
  const chunks = [];

  const tjBlocks = content.matchAll(/\[(.*?)\]\s*TJ/gs);
  for (const m of tjBlocks) {
    chunks.push(decodePdfArray(m[1]));
  }

  const tjSingles = content.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g);
  for (const m of tjSingles) {
    const inner = m[0].replace(/\s*Tj$/, '');
    chunks.push(decodePdfLiteral(inner.slice(1, -1)));
  }

  const hexSingles = content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g);
  for (const m of hexSingles) {
    chunks.push(decodePdfHex(m[1]));
  }

  return chunks.filter(Boolean).join('\n');
}

function decodePdfArray(raw) {
  let out = '';
  const re = /<([0-9A-Fa-f\s]+)>|\((?:\\.|[^\\)])*\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[0].startsWith('<')) out += decodePdfHex(m[1]);
    else out += decodePdfLiteral(m[0].slice(1, -1));
  }
  return out;
}

function decodePdfHex(hex) {
  const clean = String(hex || '').replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isFinite(code) || code < 32) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

function decodePdfLiteral(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
