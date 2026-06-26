import { PDFDocument, StandardFonts } from 'pdf-lib';
import PDFDocumentKit from 'pdfkit';

/** Factures du début du mois vers la fin (date facture, puis réception). */
export function sortInvoicesChronologically(invoices) {
  return [...invoices].sort((a, b) => {
    const da = a.invoice_date || a.created_at || '';
    const db = b.invoice_date || b.created_at || '';
    if (da !== db) return da.localeCompare(db);
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

async function appendPdfBuffer(merged, buf) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const pages = await merged.copyPages(src, src.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
}

async function appendImagePage(merged, buf, mimeType) {
  const lower = String(mimeType || '').toLowerCase();
  const image =
    lower === 'image/png'
      ? await merged.embedPng(buf)
      : lower === 'image/jpeg' || lower === 'image/jpg'
        ? await merged.embedJpg(buf)
        : null;
  if (!image) return false;

  const page = merged.addPage();
  const margin = 36;
  const maxW = page.getWidth() - margin * 2;
  const maxH = page.getHeight() - margin * 2;
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: (page.getWidth() - w) / 2,
    y: (page.getHeight() - h) / 2,
    width: w,
    height: h,
  });
  return true;
}

export async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    if (!buf?.length) continue;
    try {
      await appendPdfBuffer(merged, buf);
    } catch {
      // skip invalid pdf
    }
  }
  return merged;
}

export async function mergeInvoiceFiles(files) {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const buf = file?.buffer ?? file;
    const mimeType = file?.mimeType;
    if (!buf?.length) continue;
    try {
      if (String(mimeType || '').startsWith('image/')) {
        const ok = await appendImagePage(merged, buf, mimeType);
        if (!ok) continue;
      } else {
        await appendPdfBuffer(merged, buf);
      }
    } catch {
      // skip corrupt or unsupported file
    }
  }
  if (merged.getPageCount() === 0) {
    const page = merged.addPage();
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('Aucune facture valide pour ce mois.', { x: 50, y: 700, size: 12, font });
  }
  return Buffer.from(await merged.save());
}

/** @deprecated use mergeInvoiceFiles */
export async function mergeInvoicePdfs(buffers) {
  return mergeInvoiceFiles(buffers.map((buffer) => ({ buffer })));
}

export function buildRecapPdf({ locationName, accountingMonth, invoices, unmatchedTx, unmatchedInvoices }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(`Récapitulatif comptable — ${locationName}`, { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Mois : ${accountingMonth}`);
    doc.text(`Factures : ${invoices.length}`);
    doc.moveDown();

    doc.fontSize(14).text('Factures du mois (plus ancienne → plus récente)');
    doc.moveDown(0.5);
    const sorted = sortInvoicesChronologically(invoices);
    for (const inv of sorted) {
      doc
        .fontSize(10)
        .text(
          `${inv.invoice_date || '—'} | ${inv.vendor_name || '—'} | ${inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'} | ${inv.file_name}`
        );
    }

    doc.moveDown();
    doc.fontSize(14).text('Dépenses sans facture');
    doc.moveDown(0.5);
    if (!unmatchedTx.length) {
      doc.fontSize(10).text('Aucune');
    } else {
      for (const tx of unmatchedTx) {
        doc.fontSize(10).text(`${tx.tx_date} | ${tx.label} | ${Number(tx.amount).toFixed(2)} €`);
      }
    }

    doc.moveDown();
    doc.fontSize(14).text('Factures sans dépense');
    doc.moveDown(0.5);
    if (!unmatchedInvoices.length) {
      doc.fontSize(10).text('Aucune');
    } else {
      for (const inv of unmatchedInvoices) {
        doc.fontSize(10).text(`${inv.invoice_date || '—'} | ${inv.vendor_name || '—'} | ${inv.amount_ttc != null ? `${Number(inv.amount_ttc).toFixed(2)} €` : '—'}`);
      }
    }

    doc.end();
  });
}
