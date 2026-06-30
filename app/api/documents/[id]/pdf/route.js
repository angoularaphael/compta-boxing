import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { fetchDocumentById, SOCIETES } from '../../../../../lib/documents.js';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const CONTENT_W = PAGE.width - MARGIN * 2;

const COLORS = {
  navy: '#0B1F3A',
  accent: '#2EC4C6',
  muted: '#64748b',
  border: '#e2e8f0',
  white: '#ffffff',
};

function formatCurrency(amount) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
    .format(Number(amount))
    .replace(/[\u202f\u00a0]/g, ' ');
}

function formatDateFr(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

export async function GET(_request, { params }) {
  const { id } = params;

  const doc = await fetchDocumentById(id);
  if (!doc) {
    return NextResponse.json({ ok: false, error: 'Document introuvable' }, { status: 404 });
  }

  const societe = SOCIETES[doc.societe] || SOCIETES.boxing_center;
  const isDevis = doc.type === 'devis';
  const title = isDevis ? 'DEVIS' : 'FACTURE';

  const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));

  // Header
  pdf.rect(0, 0, PAGE.width, 100).fill(COLORS.navy);
  pdf.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.white);
  pdf.text(societe.sigle, MARGIN, 30, { lineBreak: false });
  pdf.font('Helvetica').fontSize(10).fillColor('#94a3b8');
  pdf.text(societe.adresse, MARGIN, 58);
  if (societe.siret) pdf.text(societe.siret, MARGIN, 72);

  // Document type + number
  const typeBlockX = PAGE.width - MARGIN - 180;
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accent);
  pdf.text(title, typeBlockX, 30, { width: 180, align: 'right' });
  pdf.font('Helvetica').fontSize(11).fillColor(COLORS.white);
  pdf.text(`N° ${doc.numero}`, typeBlockX, 52, { width: 180, align: 'right' });
  pdf.text(`Date : ${formatDateFr(doc.date_document)}`, typeBlockX, 68, { width: 180, align: 'right' });

  pdf.y = 120;

  // Client block
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
  pdf.text('DESTINATAIRE', MARGIN, pdf.y);
  pdf.moveDown(0.4);
  pdf.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.navy);
  pdf.text(doc.client_nom, MARGIN, pdf.y);
  pdf.font('Helvetica').fontSize(10).fillColor(COLORS.navy);
  if (doc.client_adresse) { pdf.moveDown(0.3); pdf.text(doc.client_adresse); }
  if (doc.client_email) { pdf.moveDown(0.2); pdf.text(doc.client_email); }
  if (doc.client_telephone) { pdf.moveDown(0.2); pdf.text(doc.client_telephone); }

  if (doc.reference) {
    pdf.moveDown(0.5);
    pdf.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    pdf.text(`Référence : ${doc.reference}`);
  }

  pdf.y = Math.max(pdf.y + 30, 220);

  // Prestation table
  const tableY = pdf.y;
  const colDesc = CONTENT_W * 0.7;
  const colAmount = CONTENT_W * 0.3;

  // Header row
  pdf.rect(MARGIN, tableY, CONTENT_W, 32).fill('#f1f5f9');
  pdf.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy);
  pdf.text('DESCRIPTION', MARGIN + 12, tableY + 10, { width: colDesc - 24 });
  pdf.text('MONTANT', MARGIN + colDesc + 12, tableY + 10, { width: colAmount - 24, align: 'right' });

  // Content row
  const rowY = tableY + 32;
  pdf.rect(MARGIN, rowY, CONTENT_W, 0.5).fill(COLORS.border);
  pdf.font('Helvetica').fontSize(10).fillColor(COLORS.navy);

  const prestHeight = pdf.heightOfString(doc.prestation, { width: colDesc - 24 });
  const rowH = Math.max(prestHeight + 24, 40);

  pdf.text(doc.prestation, MARGIN + 12, rowY + 12, { width: colDesc - 24 });
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.navy);
  pdf.text(formatCurrency(doc.montant), MARGIN + colDesc + 12, rowY + 12, { width: colAmount - 24, align: 'right' });

  // Total row
  const totalY = rowY + rowH;
  pdf.rect(MARGIN, totalY, CONTENT_W, 1).fill(COLORS.border);
  pdf.rect(MARGIN + colDesc, totalY + 1, colAmount, 36).fill('#f8fafc');
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
  pdf.text('TOTAL TTC', MARGIN + colDesc + 12, totalY + 8, { width: colAmount - 24 });
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.navy);
  pdf.text(formatCurrency(doc.montant), MARGIN + colDesc + 12, totalY + 20, { width: colAmount - 24, align: 'right' });

  pdf.y = totalY + 56;

  // Conditions
  if (doc.conditions) {
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
    pdf.text('CONDITIONS', MARGIN, pdf.y);
    pdf.moveDown(0.3);
    pdf.font('Helvetica').fontSize(10).fillColor(COLORS.navy);
    pdf.text(doc.conditions, MARGIN, pdf.y, { width: CONTENT_W });
    pdf.moveDown(1);
  }

  // Validity for devis
  if (isDevis) {
    pdf.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    pdf.text('Ce devis est valable 30 jours à compter de sa date d\'émission.', MARGIN, pdf.y);
    pdf.moveDown(1);
  }

  // Footer
  const footerY = PAGE.height - 60;
  pdf.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  pdf.text(`${societe.nom} — ${societe.adresse}`, MARGIN, footerY, { width: CONTENT_W, align: 'center' });
  pdf.text(societe.siret ? societe.siret : '', MARGIN, footerY + 12, { width: CONTENT_W, align: 'center' });

  pdf.end();

  await new Promise((resolve) => pdf.on('end', resolve));
  const buffer = Buffer.concat(chunks);

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.numero}.pdf"`,
    },
  });
}
