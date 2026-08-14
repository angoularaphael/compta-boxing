import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { fetchDocumentById, parseTauxTva, SOCIETES } from '../../../../../lib/documents.js';

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_W = PAGE.width - MARGIN * 2;

const THEMES = {
  default: {
    headerBg: '#0B1F3A',
    headerFg: '#ffffff',
    headerMuted: '#94a3b8',
    accent: '#2EC4C6',
    text: '#0B1F3A',
    muted: '#64748b',
    border: '#e2e8f0',
    tableHead: '#f1f5f9',
    totalBg: '#f8fafc',
    logoPad: '#ffffff',
    lightHeader: false,
  },
  // DA DISTRIX — blanc / rouge
  distrix: {
    headerBg: '#ffffff',
    headerFg: '#1a1a1a',
    headerMuted: '#6b7280',
    accent: '#E10600',
    text: '#1a1a1a',
    muted: '#6b7280',
    border: '#fecaca',
    tableHead: '#fef2f2',
    totalBg: '#fee2e2',
    logoPad: '#ffffff',
    lightHeader: true,
    bar: '#E10600',
  },
};

function themeFor(societeKey) {
  return THEMES[societeKey] || THEMES.default;
}

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
  let taux;
  try {
    taux = parseTauxTva(doc.taux_tva, 20);
  } catch {
    taux = 20;
  }
  let ht = doc.montant_ht != null && doc.montant_ht !== '' ? Number(doc.montant_ht) : null;
  let tva = doc.montant_tva != null && doc.montant_tva !== '' ? Number(doc.montant_tva) : null;
  let ttc = doc.montant != null && doc.montant !== '' ? Number(doc.montant) : null;

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

/** Texte absolu sans faire défiler le flux (évite page 2). */
function absText(pdf, str, x, y, opts = {}) {
  pdf.text(String(str ?? ''), x, y, { lineBreak: false, ...opts });
}

export async function GET(_request, { params }) {
  const { id } = params;

  const doc = await fetchDocumentById(id);
  if (!doc) {
    return NextResponse.json({ ok: false, error: 'Document introuvable' }, { status: 404 });
  }

  const societe = SOCIETES[doc.societe] || SOCIETES.boxing_center;
  const theme = themeFor(doc.societe);
  const isDevis = doc.type === 'devis';
  const title = isDevis ? 'DEVIS' : 'FACTURE';
  const amounts = resolveAmounts(doc);

  const pdf = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: true });
  const chunks = [];
  pdf.on('data', (c) => chunks.push(c));

  const headerH = 88;
  pdf.rect(0, 0, PAGE.width, headerH).fill(theme.headerBg);

  // Bandeau rouge Distrix sous le header blanc
  if (theme.lightHeader && theme.bar) {
    pdf.rect(0, headerH - 4, PAGE.width, 4).fill(theme.bar);
  }

  const logoFile = societe.logo || (societe.sigle === 'BOXING CENTER' ? 'logo.png' : null);
  const logoPath = logoFile ? path.join(process.cwd(), 'public', logoFile) : null;
  const logoLoaded = logoPath && fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(logoPath);

  if (logoLoaded) {
    const logoW = doc.societe === 'distrix' ? 70 : 140;
    const logoH = doc.societe === 'distrix' ? 56 : 48;
    if (!theme.lightHeader) {
      pdf.save();
      pdf.roundedRect(MARGIN - 4, 10, logoW + 8, logoH + 4, 4).fill(theme.logoPad);
      pdf.restore();
    }
    pdf.image(logoPath, MARGIN, 12, { fit: [logoW, logoH], align: 'center', valign: 'center' });
    pdf.font('Helvetica').fontSize(7.5).fillColor(theme.headerMuted);
    absText(pdf, societe.adresse, MARGIN + logoW + 14, 18);
    const legalBits = [];
    if (societe.siren) legalBits.push(`SIREN ${societe.siren}`);
    if (societe.siret) legalBits.push(`SIRET ${societe.siret}`);
    if (societe.tva) legalBits.push(`N° TVA ${societe.tva}`);
    if (legalBits.length) {
      absText(pdf, legalBits.join('  ·  '), MARGIN + logoW + 14, 32, { width: 220 });
    }
  } else {
    pdf.font('Helvetica-Bold').fontSize(18).fillColor(theme.lightHeader ? theme.accent : theme.headerFg);
    absText(pdf, societe.sigle, MARGIN, 16);
    pdf.font('Helvetica').fontSize(8).fillColor(theme.headerMuted);
    absText(pdf, societe.adresse, MARGIN, 40);
    const legalBits = [];
    if (societe.siren) legalBits.push(`SIREN ${societe.siren}`);
    if (societe.siret) legalBits.push(`SIRET ${societe.siret}`);
    if (societe.tva) legalBits.push(`N° TVA ${societe.tva}`);
    if (legalBits.length) {
      absText(pdf, legalBits.join('  ·  '), MARGIN, 54, { width: 320 });
    }
  }

  const typeBlockX = PAGE.width - MARGIN - 170;
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(theme.accent);
  absText(pdf, title, typeBlockX, 18, { width: 170, align: 'right' });
  pdf.font('Helvetica').fontSize(10).fillColor(theme.headerFg);
  absText(pdf, `N° ${doc.numero}`, typeBlockX, 38, { width: 170, align: 'right' });
  absText(pdf, `Date : ${formatDateFr(doc.date_document)}`, typeBlockX, 54, { width: 170, align: 'right' });

  let y = headerH + 18;

  pdf.font('Helvetica-Bold').fontSize(8).fillColor(theme.muted);
  absText(pdf, 'DESTINATAIRE', MARGIN, y);
  y += 14;
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(theme.text);
  absText(pdf, doc.client_nom, MARGIN, y);
  y += 15;
  pdf.font('Helvetica').fontSize(9).fillColor(theme.text);
  if (doc.client_adresse) {
    absText(pdf, doc.client_adresse, MARGIN, y, { width: CONTENT_W * 0.55 });
    y += 12;
  }
  if (doc.client_email) {
    absText(pdf, doc.client_email, MARGIN, y);
    y += 12;
  }
  if (doc.client_telephone) {
    absText(pdf, doc.client_telephone, MARGIN, y);
    y += 12;
  }
  if (doc.reference) {
    pdf.font('Helvetica').fontSize(8).fillColor(theme.muted);
    absText(pdf, `Référence : ${doc.reference}`, MARGIN, y);
    y += 12;
  }

  y += 16;

  const colDesc = CONTENT_W * 0.68;
  const colAmount = CONTENT_W * 0.32;
  const tableY = y;

  pdf.rect(MARGIN, tableY, CONTENT_W, 26).fill(theme.tableHead);
  if (theme.lightHeader) {
    pdf.rect(MARGIN, tableY, 3, 26).fill(theme.accent);
  }
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(theme.text);
  absText(pdf, 'DESCRIPTION', MARGIN + 10, tableY + 8, { width: colDesc - 20 });
  absText(pdf, 'MONTANT HT', MARGIN + colDesc + 8, tableY + 8, { width: colAmount - 16, align: 'right' });

  const rowY = tableY + 26;
  pdf.font('Helvetica').fontSize(9).fillColor(theme.text);
  const prestHeight = Math.min(
    pdf.heightOfString(doc.prestation || '', { width: colDesc - 20 }),
    120
  );
  const rowH = Math.max(prestHeight + 18, 36);

  pdf.text(doc.prestation || '', MARGIN + 10, rowY + 8, {
    width: colDesc - 20,
    height: rowH - 12,
    ellipsis: true,
  });
  pdf.font('Helvetica-Bold').fontSize(10).fillColor(theme.text);
  absText(pdf, formatCurrency(amounts.ht), MARGIN + colDesc + 8, rowY + 8, {
    width: colAmount - 16,
    align: 'right',
  });

  let totalY = rowY + rowH + 4;
  pdf.rect(MARGIN, totalY, CONTENT_W, 0.75).fill(theme.border);
  totalY += 8;

  const totalsX = MARGIN + colDesc;
  const drawTotalLine = (label, value, { bold = false, bg = false } = {}) => {
    if (bg) pdf.rect(totalsX, totalY - 2, colAmount, 18).fill(theme.totalBg);
    pdf
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 10 : 9)
      .fillColor(bold ? theme.accent : theme.muted);
    absText(pdf, label, totalsX + 8, totalY, { width: colAmount - 16 });
    pdf
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 11 : 9)
      .fillColor(bold ? theme.accent : theme.text);
    absText(pdf, formatCurrency(value), totalsX + 8, totalY, { width: colAmount - 16, align: 'right' });
    totalY += 18;
  };

  drawTotalLine('Total HT', amounts.ht);
  drawTotalLine(`TVA (${amounts.taux} %)`, amounts.tva);
  drawTotalLine('TOTAL TTC', amounts.ttc, { bold: true, bg: true });

  y = totalY + 14;

  if (doc.conditions) {
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(theme.muted);
    absText(pdf, 'CONDITIONS', MARGIN, y);
    y += 12;
    pdf.font('Helvetica').fontSize(9).fillColor(theme.text);
    pdf.text(doc.conditions, MARGIN, y, { width: CONTENT_W, height: 48, ellipsis: true });
    y += Math.min(pdf.heightOfString(doc.conditions, { width: CONTENT_W }), 48) + 8;
  }

  if (isDevis) {
    pdf.font('Helvetica').fontSize(8).fillColor(theme.muted);
    absText(pdf, "Ce devis est valable 30 jours à compter de sa date d'émission.", MARGIN, y);
  }

  const range = pdf.bufferedPageRange();
  pdf.switchToPage(range.start);
  const footerY = PAGE.height - 42;
  if (theme.lightHeader && theme.bar) {
    pdf.rect(0, footerY - 10, PAGE.width, 1.5).fill(theme.bar);
  }
  pdf.font('Helvetica').fontSize(7.5).fillColor(theme.muted);
  absText(pdf, `${societe.nom} — ${societe.adresse}`, MARGIN, footerY, {
    width: CONTENT_W,
    align: 'center',
  });
  const footerLegal = [];
  if (societe.siret) footerLegal.push(`SIRET ${societe.siret}`);
  if (societe.tva) footerLegal.push(`N° TVA ${societe.tva}`);
  if (footerLegal.length) {
    absText(pdf, footerLegal.join('  ·  '), MARGIN, footerY + 12, {
      width: CONTENT_W,
      align: 'center',
    });
  }

  pdf.end();

  await new Promise((resolve) => pdf.on('end', resolve));
  let buffer = Buffer.concat(chunks);

  try {
    const { PDFDocument } = await import('pdf-lib');
    const src = await PDFDocument.load(buffer);
    if (src.getPageCount() > 1) {
      const out = await PDFDocument.create();
      const [first] = await out.copyPages(src, [0]);
      out.addPage(first);
      buffer = Buffer.from(await out.save());
    }
  } catch (err) {
    console.warn('[documents/pdf] trim pages failed', err?.message || err);
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.numero}.pdf"`,
    },
  });
}
