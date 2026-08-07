import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
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
    .format(Number(amount) || 0)
    .replace(/[\u202f\u00a0]/g, ' ');
}

function formatDateFr(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

function resolveAmounts(doc) {
  const taux = Number(doc.taux_tva ?? 20);
  let ht = doc.montant_ht != null ? Number(doc.montant_ht) : null;
  let tva = doc.montant_tva != null ? Number(doc.montant_tva) : null;
  let ttc = doc.montant != null ? Number(doc.montant) : null;

  if (ht == null && ttc != null && Number.isFinite(taux)) {
    ht = Math.round((ttc / (1 + taux / 100)) * 100) / 100;
  }
  if (tva == null && ht != null && ttc != null) {
    tva = Math.round((ttc - ht) * 100) / 100;
  }
  if (ttc == null && ht != null) {
    tva = tva != null ? tva : Math.round((ht * taux) / 100 * 100) / 100;
    ttc = Math.round((ht + tva) * 100) / 100;
  }

  return {
    ht: ht ?? 0,
    tva: tva ?? 0,
    ttc: ttc ?? 0,
    taux: Number.isFinite(taux) ? taux : 20,
  };
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
  const amounts = resolveAmounts(doc);

  const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));

  // Header
  const hasLegalMeta = Boolean(societe.siren || societe.siret || societe.tva);
  const headerH = hasLegalMeta || doc.societe === 'distrix' ? 120 : 110;
  pdf.rect(0, 0, PAGE.width, headerH).fill(COLORS.navy);

  const logoFile = societe.logo || (societe.sigle === 'BOXING CENTER' ? 'logo.png' : null);
  const logoPath = logoFile ? path.join(process.cwd(), 'public', logoFile) : null;
  const logoLoaded = logoPath && fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(logoPath);

  if (logoLoaded) {
    const logoW = doc.societe === 'distrix' ? 120 : 168;
    const logoH = doc.societe === 'distrix' ? 72 : 56;
    pdf.save();
    pdf.roundedRect(MARGIN - 6, 12, logoW + 8, logoH + 4, 4).fill(COLORS.white);
    pdf.image(logoPath, MARGIN - 2, 14, { fit: [logoW, logoH], align: 'center', valign: 'center' });
    pdf.restore();
  } else {
    pdf.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.white);
    pdf.text(societe.sigle, MARGIN, 22, { lineBreak: false });
  }

  pdf.font('Helvetica').fontSize(8).fillColor('#94a3b8');
  let metaY = logoLoaded ? (doc.societe === 'distrix' ? 90 : 76) : 50;
  pdf.text(societe.adresse, MARGIN, metaY, { lineBreak: false });
  metaY += 11;
  const legalBits = [];
  if (societe.siren) legalBits.push(`SIREN ${societe.siren}`);
  if (societe.siret) legalBits.push(`SIRET ${societe.siret}`);
  if (societe.tva) legalBits.push(`N° TVA ${societe.tva}`);
  if (legalBits.length) {
    pdf.text(legalBits.join('  ·  '), MARGIN, metaY, { width: 340, lineBreak: false });
  }

  // Document type + number
  const typeBlockX = PAGE.width - MARGIN - 180;
  pdf.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.accent);
  pdf.text(title, typeBlockX, 28, { width: 180, align: 'right' });
  pdf.font('Helvetica').fontSize(11).fillColor(COLORS.white);
  pdf.text(`N° ${doc.numero}`, typeBlockX, 50, { width: 180, align: 'right' });
  pdf.text(`Date : ${formatDateFr(doc.date_document)}`, typeBlockX, 66, { width: 180, align: 'right' });

  pdf.y = headerH + 20;

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

  pdf.y = Math.max(pdf.y + 30, 230);

  // Prestation table
  const tableY = pdf.y;
  const colDesc = CONTENT_W * 0.7;
  const colAmount = CONTENT_W * 0.3;

  pdf.rect(MARGIN, tableY, CONTENT_W, 32).fill('#f1f5f9');
  pdf.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.navy);
  pdf.text('DESCRIPTION', MARGIN + 12, tableY + 10, { width: colDesc - 24 });
  pdf.text('MONTANT HT', MARGIN + colDesc + 12, tableY + 10, { width: colAmount - 24, align: 'right' });

  const rowY = tableY + 32;
  pdf.rect(MARGIN, rowY, CONTENT_W, 0.5).fill(COLORS.border);
  pdf.font('Helvetica').fontSize(10).fillColor(COLORS.navy);

  const prestHeight = pdf.heightOfString(doc.prestation, { width: colDesc - 24 });
  const rowH = Math.max(prestHeight + 24, 40);

  pdf.text(doc.prestation, MARGIN + 12, rowY + 12, { width: colDesc - 24 });
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.navy);
  pdf.text(formatCurrency(amounts.ht), MARGIN + colDesc + 12, rowY + 12, { width: colAmount - 24, align: 'right' });

  // Totals
  const totalsX = MARGIN + colDesc;
  let totalY = rowY + rowH;
  pdf.rect(MARGIN, totalY, CONTENT_W, 1).fill(COLORS.border);

  const drawTotalLine = (label, value, { bold = false, bg = false, size = 10 } = {}) => {
    if (bg) pdf.rect(totalsX, totalY, colAmount, 22).fill('#f8fafc');
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(bold ? COLORS.navy : COLORS.muted);
    pdf.text(label, totalsX + 12, totalY + 6, { width: colAmount - 24 });
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(COLORS.navy);
    pdf.text(formatCurrency(value), totalsX + 12, totalY + 6, { width: colAmount - 24, align: 'right' });
    totalY += 22;
  };

  drawTotalLine('Total HT', amounts.ht);
  drawTotalLine(`TVA (${amounts.taux} %)`, amounts.tva);
  drawTotalLine('TOTAL TTC', amounts.ttc, { bold: true, bg: true, size: 12 });
  totalY += 8;

  pdf.y = totalY + 16;

  // Conditions
  if (doc.conditions) {
    pdf.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted);
    pdf.text('CONDITIONS', MARGIN, pdf.y);
    pdf.moveDown(0.3);
    pdf.font('Helvetica').fontSize(10).fillColor(COLORS.navy);
    pdf.text(doc.conditions, MARGIN, pdf.y, { width: CONTENT_W });
    pdf.moveDown(1);
  }

  if (isDevis) {
    pdf.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    pdf.text('Ce devis est valable 30 jours à compter de sa date d\'émission.', MARGIN, pdf.y);
    pdf.moveDown(1);
  }

  // Footer
  const footerY = PAGE.height - 70;
  pdf.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  pdf.text(`${societe.nom} — ${societe.adresse}`, MARGIN, footerY, { width: CONTENT_W, align: 'center' });
  const footerLegal = [];
  if (societe.siret) footerLegal.push(`SIRET ${societe.siret}`);
  if (societe.tva) footerLegal.push(`N° TVA ${societe.tva}`);
  if (footerLegal.length) {
    pdf.text(footerLegal.join('  ·  '), MARGIN, footerY + 12, { width: CONTENT_W, align: 'center' });
  }

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
