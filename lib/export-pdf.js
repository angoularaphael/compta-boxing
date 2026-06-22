import { PDFDocument, StandardFonts } from 'pdf-lib';
import PDFDocumentKit from 'pdfkit';

export async function mergeInvoicePdfs(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    if (!buf?.length) continue;
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch {
      // skip invalid pdf
    }
  }
  if (merged.getPageCount() === 0) {
    const page = merged.addPage();
    const font = await merged.embedFont(StandardFonts.Helvetica);
    page.drawText('Aucune facture PDF valide pour ce mois.', { x: 50, y: 700, size: 12, font });
  }
  return Buffer.from(await merged.save());
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

    doc.fontSize(14).text('Factures du mois (plus récente → plus ancienne)');
    doc.moveDown(0.5);
    const sorted = [...invoices].sort((a, b) => {
      const da = a.invoice_date || '';
      const db = b.invoice_date || '';
      return db.localeCompare(da);
    });
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
