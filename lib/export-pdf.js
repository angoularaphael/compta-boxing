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

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const FOOTER_Y = PAGE.height - 36;

const COLORS = {
  navy: '#0f172a',
  navyLight: '#1e3a5f',
  accent: '#2563eb',
  gold: '#C9A227',
  muted: '#64748b',
  border: '#e2e8f0',
  headerBg: '#f1f5f9',
  white: '#ffffff',
  warnBg: '#fef3c7',
  warnText: '#92400e',
  okBg: '#dcfce7',
  okText: '#166534',
};

const currencyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function formatCurrency(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  // PDFKit/Helvetica ne gère pas l'espace fine insécable (U+202F) du locale fr-FR → affiché comme "/"
  return currencyFmt.format(Number(amount)).replace(/[\u202f\u00a0]/g, ' ');
}

function formatDateFr(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return dateFmt.format(d);
}

function formatMonthLabel(accountingMonth) {
  const [y, m] = String(accountingMonth || '').split('-');
  if (!y || !m) return accountingMonth || '—';
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return accountingMonth;
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);
}

function invoiceReference(inv) {
  if (inv.invoice_number) return String(inv.invoice_number).trim();
  return '—';
}

function truncate(text, maxLen) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s || '—';
  return `${s.slice(0, maxLen - 1)}…`;
}

function sumAmounts(items, key) {
  return items.reduce((sum, item) => {
    const v = item[key];
    return v != null && !Number.isNaN(Number(v)) ? sum + Number(v) : sum;
  }, 0);
}

function ensureSpace(doc, neededHeight) {
  if (doc.y + neededHeight <= FOOTER_Y) return;
  doc.addPage();
  doc.y = MARGIN;
}

function drawFooter(doc, pageNum) {
  const prevY = doc.y;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(`Boxing Center — document généré automatiquement`, MARGIN, FOOTER_Y, {
      width: CONTENT_WIDTH * 0.7,
      align: 'left',
      lineBreak: false,
    });
  doc.text(`Page ${pageNum}`, MARGIN, FOOTER_Y, {
    width: CONTENT_WIDTH,
    align: 'right',
    lineBreak: false,
  });
  doc.y = prevY;
}

function drawBrandHeader(doc, locationName) {
  doc.save();
  doc.rect(0, 0, PAGE.width, 88).fill(COLORS.navy);

  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.white);
  doc.text('BOXING', MARGIN, 26, { lineBreak: false });
  const boxingWidth = doc.widthOfString('BOXING');
  doc.fillColor(COLORS.gold).text('CENTER', MARGIN + boxingWidth + 6, 26, { lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8');
  doc.text('COMPTABILITÉ', MARGIN, 50, { lineBreak: false });

  const titleW = 220;
  const titleX = PAGE.width - MARGIN - titleW;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.white);
  doc.text('Récapitulatif comptable', titleX, 28, { width: titleW, align: 'right' });
  doc.font('Helvetica').fontSize(11).fillColor('#cbd5e1');
  doc.text(locationName, titleX, 48, { width: titleW, align: 'right' });

  doc.restore();
  doc.y = 104;
}

function drawMetaRow(doc, { accountingMonth, invoiceCount, generatedAt, totalTtc }) {
  const boxH = 52;
  const gap = 10;
  const boxW = (CONTENT_WIDTH - gap * 3) / 4;
  const items = [
    { label: 'Mois comptable', value: formatMonthLabel(accountingMonth) },
    { label: 'Factures', value: String(invoiceCount) },
    { label: 'Total TTC', value: formatCurrency(totalTtc) },
    { label: 'Généré le', value: formatDateFr(generatedAt) },
  ];

  const y = doc.y;
  items.forEach((item, i) => {
    const x = MARGIN + i * (boxW + gap);
    doc.save();
    doc.roundedRect(x, y, boxW, boxH, 4).fillAndStroke(COLORS.headerBg, COLORS.border);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
    doc.text(item.label.toUpperCase(), x + 10, y + 10, { width: boxW - 20, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.navy);
    doc.text(item.value, x + 10, y + 26, { width: boxW - 20, lineBreak: false });
    doc.restore();
  });

  doc.y = y + boxH + 22;
}

function drawSectionTitle(doc, title, subtitle) {
  ensureSpace(doc, 48);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.navy);
  doc.text(title, MARGIN, doc.y, { width: CONTENT_WIDTH });
  if (subtitle) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
    doc.text(subtitle, MARGIN, doc.y, { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.6);
}

function drawTable(doc, { columns, rows, rowHeight = 22, headerHeight = 26 }) {
  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted);
    doc.text('Aucun élément.', MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.moveDown(0.8);
    return;
  }

  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  const startX = MARGIN + (CONTENT_WIDTH - tableWidth) / 2;

  function drawHeaderRow(y) {
    doc.save();
    doc.rect(startX, y, tableWidth, headerHeight).fill(COLORS.navy);
    let x = startX;
    for (const col of columns) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.white);
      doc.text(col.label, x + 8, y + 8, {
        width: col.width - 16,
        align: col.align || 'left',
        lineBreak: false,
      });
      x += col.width;
    }
    doc.restore();
  }

  function drawDataRow(y, row, stripe) {
    doc.save();
    if (stripe) {
      doc.rect(startX, y, tableWidth, rowHeight).fill(COLORS.headerBg);
    }
    doc.rect(startX, y, tableWidth, rowHeight).stroke(COLORS.border);
    let x = startX;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const value = row[col.key] ?? '—';
      const color = row._colors?.[col.key] || COLORS.navy;
      doc.font(row._bold?.[col.key] ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(color);
      doc.text(String(value), x + 8, y + 6, {
        width: col.width - 16,
        align: col.align || 'left',
        lineBreak: false,
      });
      x += col.width;
    }
    doc.restore();
  }

  ensureSpace(doc, headerHeight + rowHeight * Math.min(rows.length, 3));
  let y = doc.y;
  drawHeaderRow(y);
  y += headerHeight;

  rows.forEach((row, idx) => {
    if (y + rowHeight > FOOTER_Y) {
      doc.addPage();
      y = MARGIN;
      drawHeaderRow(y);
      y += headerHeight;
    }
    drawDataRow(y, row, idx % 2 === 1);
    y += rowHeight;
  });

  doc.y = y + 14;
}

function drawAlertBox(doc, { tone, title, body }) {
  const pad = 12;
  const bg = tone === 'warn' ? COLORS.warnBg : COLORS.okBg;
  const fg = tone === 'warn' ? COLORS.warnText : COLORS.okText;
  doc.font('Helvetica-Bold').fontSize(9);
  const titleH = doc.heightOfString(title, { width: CONTENT_WIDTH - pad * 2 });
  doc.font('Helvetica').fontSize(9);
  const bodyH = body ? doc.heightOfString(body, { width: CONTENT_WIDTH - pad * 2 }) : 0;
  const boxH = pad * 2 + titleH + (body ? bodyH + 4 : 0);

  ensureSpace(doc, boxH + 8);
  const y = doc.y;
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, boxH, 4).fillAndStroke(bg, COLORS.border);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(fg);
  doc.text(title, MARGIN + pad, y + pad, { width: CONTENT_WIDTH - pad * 2 });
  if (body) {
    doc.font('Helvetica').fontSize(9).fillColor(fg);
    doc.text(body, MARGIN + pad, y + pad + titleH + 4, { width: CONTENT_WIDTH - pad * 2 });
  }
  doc.restore();
  doc.y = y + boxH + 14;
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

export function buildRecapPdf({
  locationName,
  accountingMonth,
  invoices,
  unmatchedTx,
  unmatchedInvoices,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocumentKit({ margin: MARGIN, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const sorted = sortInvoicesChronologically(invoices);
    const unmatchedIds = new Set((unmatchedInvoices || []).map((inv) => inv.id));
    const generatedAt = new Date().toISOString().slice(0, 10);
    const totalTtc = sumAmounts(sorted, 'amount_ttc');

    drawBrandHeader(doc, locationName);
    drawMetaRow(doc, {
      accountingMonth,
      invoiceCount: sorted.length,
      generatedAt,
      totalTtc,
    });

    drawSectionTitle(
      doc,
      'Factures du mois',
      'Classées de la plus ancienne à la plus récente. Les pièces jointes suivent ce récapitulatif.'
    );

    const invoiceColumns = [
      { key: 'date', label: 'Date', width: 72, align: 'left' },
      { key: 'vendor', label: 'Fournisseur', width: 168, align: 'left' },
      { key: 'reference', label: 'Référence', width: 88, align: 'left' },
      { key: 'amount', label: 'Montant TTC', width: 88, align: 'right' },
      { key: 'status', label: 'Rapprochement', width: 96, align: 'center' },
    ];

    const invoiceRows = sorted.map((inv) => {
      const matched = !unmatchedIds.has(inv.id);
      return {
        date: formatDateFr(inv.invoice_date),
        vendor: truncate(inv.vendor_name, 36),
        reference: truncate(invoiceReference(inv), 14),
        amount: formatCurrency(inv.amount_ttc),
        status: matched ? 'Rapprochée' : 'Sans dépense',
        _colors: {
          status: matched ? COLORS.okText : COLORS.warnText,
        },
        _bold: { amount: true },
      };
    });

    if (invoiceRows.length) {
      invoiceRows.push({
        date: '',
        vendor: '',
        reference: 'Total',
        amount: formatCurrency(totalTtc),
        status: '',
        _bold: { reference: true, amount: true },
        _colors: { reference: COLORS.navy, amount: COLORS.navy },
      });
    }

    drawTable(doc, { columns: invoiceColumns, rows: invoiceRows });

    drawSectionTitle(
      doc,
      'Dépenses sans facture',
      'Écritures du relevé bancaire sans facture associée pour ce mois.'
    );

    const txColumns = [
      { key: 'date', label: 'Date', width: 80, align: 'left' },
      { key: 'label', label: 'Libellé', width: 280, align: 'left' },
      { key: 'amount', label: 'Montant', width: 100, align: 'right' },
    ];

    const txRows = (unmatchedTx || []).map((tx) => ({
      date: formatDateFr(tx.tx_date),
      label: truncate(tx.label, 52),
      amount: formatCurrency(tx.amount),
      _bold: { amount: true },
    }));

    if (txRows.length) {
      txRows.push({
        date: '',
        label: 'Total',
        amount: formatCurrency(sumAmounts(unmatchedTx, 'amount')),
        _bold: { label: true, amount: true },
      });
    }

    drawTable(doc, { columns: txColumns, rows: txRows });

    drawSectionTitle(
      doc,
      'Factures sans dépense',
      'Synthèse des factures non rapprochées — le détail figure dans le tableau ci-dessus.'
    );

    if (!unmatchedInvoices?.length) {
      drawAlertBox(doc, {
        tone: 'ok',
        title: 'Toutes les factures sont rapprochées avec le relevé bancaire.',
      });
    } else {
      const names = unmatchedInvoices
        .map((inv) => {
          const vendor = inv.vendor_name || 'Fournisseur inconnu';
          const amt = inv.amount_ttc != null ? formatCurrency(inv.amount_ttc) : '';
          return amt ? `${vendor} (${amt})` : vendor;
        })
        .join(' · ');
      drawAlertBox(doc, {
        tone: 'warn',
        title: `${unmatchedInvoices.length} facture${unmatchedInvoices.length > 1 ? 's' : ''} sans dépense correspondante`,
        body: names,
      });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter(doc, i - range.start + 1);
    }

    doc.end();
  });
}
