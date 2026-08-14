import archiver from 'archiver';

function safePart(value, fallback = 'fichier') {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return (s || fallback).slice(0, 60);
}

function extensionOf(fileName, mimeType) {
  const fromName = String(fileName || '').match(/\.[a-z0-9]{2,5}$/i);
  if (fromName) return fromName[0].toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('csv')) return '.csv';
  return '.pdf';
}

function amountPart(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  return `_${Number(amount).toFixed(2).replace('.', ',')}e`;
}

export function invoiceDossierName(inv, index) {
  const date = inv.invoice_date || 'sans-date';
  const seq = String(index + 1).padStart(2, '0');
  const vendor = safePart(inv.vendor_name || inv.file_name || 'facture');
  const ext = extensionOf(inv.file_name, inv.mime_type);
  return `02-factures/${date}_${seq}_${vendor}${amountPart(inv.amount_ttc)}${ext}`;
}

export function statementDossierName(statement, month) {
  const ext = extensionOf(statement?.file_name, statement?.mime_type);
  const original = safePart(statement?.file_name?.replace(/\.[^.]+$/, '') || `releve-${month}`);
  return `01-releve/${original}${ext}`;
}

export function uniqueZipName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : '';
  let i = 2;
  let next = `${base}_${i}${ext}`;
  while (used.has(next)) {
    i += 1;
    next = `${base}_${i}${ext}`;
  }
  used.add(next);
  return next;
}

export async function createZipBuffer(files) {
  const chunks = [];
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('data', (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  for (const file of files) {
    if (!file?.buffer?.length || !file.name) continue;
    archive.append(file.buffer, { name: file.name });
  }
  await archive.finalize();
  await ended;
  return Buffer.concat(chunks);
}
