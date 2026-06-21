import { botUrlFromEnv, isValidBotUrl } from './bots.js';

function formatInvoiceNotifyText(locationName, invoice) {
  if (invoice.ocr_status === 'duplicate') {
    const lines = [
      `⚠️ Facture déjà enregistrée — ${locationName}`,
      invoice.invoice_number ? `📄 N° ${invoice.invoice_number}` : null,
      invoice.vendor_name ? `🏢 ${invoice.vendor_name}` : null,
      invoice.invoice_date ? `📅 ${invoice.invoice_date}` : null,
      invoice.amount_ttc != null ? `💶 ${Number(invoice.amount_ttc).toFixed(2)} €` : null,
      'Cette facture existe déjà ce mois-ci. Aucune action nécessaire.',
    ];
    return lines.filter(Boolean).join('\n');
  }

  const lines = [
    `✅ Analyse terminée — ${locationName}`,
    invoice.vendor_name ? `🏢 ${invoice.vendor_name}` : null,
    invoice.invoice_number ? `📄 N° ${invoice.invoice_number}` : null,
    invoice.invoice_date ? `📅 Date facture : ${invoice.invoice_date}` : null,
    invoice.amount_ttc != null ? `💶 ${Number(invoice.amount_ttc).toFixed(2)} €` : null,
    `📁 Mois comptable : ${invoice.accounting_month || '—'}`,
  ];
  if (invoice.ocr_status === 'failed') {
    lines.push('⚠️ Analyse incomplète — réessayez ou complétez sur le site.');
  } else if (invoice.ocr_status === 'partial') {
    lines.push('ℹ️ Analyse partielle — complétez sur le site si besoin.');
  }
  return lines.filter(Boolean).join('\n');
}

export async function notifyWhatsAppInvoiceReady(location, invoice) {
  if (!invoice || invoice.source !== 'whatsapp' || !invoice.source_phone) return;

  const botUrl = isValidBotUrl(location?.bot_url)
    ? String(location.bot_url).replace(/\/$/, '')
    : botUrlFromEnv(location?.slug);
  if (!isValidBotUrl(botUrl)) {
    console.warn('[notifyWhatsApp] bot_url manquant pour', location?.slug);
    return;
  }

  const secret = location?.whatsapp_secret || process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const text = formatInvoiceNotifyText(location.name || location.slug, invoice);

  try {
    const res = await fetch(`${botUrl}/api/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret,
      },
      body: JSON.stringify({ phone: invoice.source_phone, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[notifyWhatsApp]', res.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn('[notifyWhatsApp]', err.message);
  }
}
