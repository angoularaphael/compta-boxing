import { getSupabase } from './supabase';

const BUCKET_INVOICES = 'compta-invoices';
const BUCKET_STATEMENTS = 'compta-statements';
const BUCKET_EXPORTS = 'compta-exports';

export { BUCKET_INVOICES, BUCKET_STATEMENTS, BUCKET_EXPORTS };

export async function uploadFile(bucket, storagePath, buffer, contentType) {
  const sb = getSupabase();
  const { error } = await sb.storage.from(bucket).upload(storagePath, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) {
    const msg = String(error.message || '');
    if (msg.toLowerCase().includes('bucket') || error.statusCode === 404 || error.statusCode === '404') {
      throw new Error(
        `Bucket Storage "${bucket}" introuvable — exécutez la migration 006_storage_buckets.sql dans Supabase`
      );
    }
    throw error;
  }
  return storagePath;
}

export async function downloadFile(bucket, storagePath) {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(bucket).download(storagePath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

export async function getSignedUrl(bucket, storagePath, expiresIn = 3600) {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function getSignedDownloadUrl(bucket, storagePath, fileName, expiresIn = 300) {
  const sb = getSupabase();
  const download = String(fileName || 'fichier').replace(/["\r\n]/g, '_') || 'fichier';
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(storagePath, expiresIn, {
    download,
  });
  if (error) throw error;
  return data.signedUrl;
}

export function buildInvoicePath(locationSlug, accountingMonth, fileName) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = Date.now();
  return `${locationSlug}/${accountingMonth}/${stamp}-${safe}`;
}

export function buildStatementPath(locationSlug, accountingMonth, fileName) {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${locationSlug}/${accountingMonth}/releve-${safe}`;
}

export function buildExportPath(locationSlug, accountingMonth) {
  return `${locationSlug}/${accountingMonth}/export-${Date.now()}.zip`;
}
