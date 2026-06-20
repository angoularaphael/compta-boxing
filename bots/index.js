/**
 * Bot WhatsApp Compta Boxing — une instance par salle (LOCATION_SLUG).
 * Reçoit images/PDF de factures ou relevés et les envoie à l'API compta-boxing.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  getContentType,
} = require('@whiskeysockets/baileys');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3011);
const LOCATION_SLUG = String(process.env.LOCATION_SLUG || '').trim();
const LOCATION_NAME = process.env.LOCATION_NAME || LOCATION_SLUG;
const WEBHOOK_URL = String(process.env.COMPTA_WEBHOOK_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const ALLOWED_PHONES = String(process.env.ALLOWED_PHONES || '')
  .split(/[,;\s]+/)
  .map((p) => p.replace(/\D/g, ''))
  .filter(Boolean);

const AUTH_DIR = path.join(__dirname, 'auth', LOCATION_SLUG || 'default');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let sock = null;
let currentQrBase64 = null;
let isConnected = false;

const app = express();
app.use(cors());
app.use(express.json());

function ensureConfig() {
  if (!LOCATION_SLUG) throw new Error('LOCATION_SLUG requis');
  if (!WEBHOOK_URL) throw new Error('COMPTA_WEBHOOK_URL requis');
}

function phoneFromJid(jid) {
  return String(jid || '').split('@')[0].replace(/\D/g, '');
}

function isAllowed(msg) {
  if (!ALLOWED_PHONES.length) return true;
  const phone = phoneFromJid(msg.key?.remoteJid);
  return ALLOWED_PHONES.some((p) => phone.endsWith(p) || p.endsWith(phone));
}

function mediaMeta(msg) {
  const type = getContentType(msg.message);
  if (type === 'imageMessage') {
    return {
      type,
      mimetype: msg.message.imageMessage.mimetype || 'image/jpeg',
      fileName: `facture-${Date.now()}.jpg`,
    };
  }
  if (type === 'documentMessage') {
    const doc = msg.message.documentMessage;
    return {
      type,
      mimetype: doc.mimetype || 'application/pdf',
      fileName: doc.fileName || `document-${Date.now()}.pdf`,
    };
  }
  return null;
}

async function postToCompta(buffer, meta, fromPhone, docType, accountingMonth) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('location_slug', LOCATION_SLUG);
  form.append('doc_type', docType);
  form.append('from_phone', fromPhone || '');
  if (accountingMonth) form.append('accounting_month', accountingMonth);
  form.append('file', buffer, { filename: meta.fileName, contentType: meta.mimetype });

  const url = `${WEBHOOK_URL}/api/webhook/whatsapp`;
  const res = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      'x-webhook-secret': WEBHOOK_SECRET,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 120000,
  });
  return res.data;
}

async function handleMediaMessage(msg) {
  if (!isAllowed(msg)) {
    await sock.sendMessage(msg.key.remoteJid, {
      text: '⛔ Numéro non autorisé pour la compta.',
    });
    return;
  }

  const meta = mediaMeta(msg);
  if (!meta) return;

  const caption = (
    msg.message.imageMessage?.caption ||
    msg.message.documentMessage?.caption ||
    ''
  ).trim().toLowerCase();

  let docType = 'invoice';
  let accountingMonth = null;
  if (caption.startsWith('releve') || caption.startsWith('relevé')) {
    docType = 'statement';
    const m = caption.match(/(\d{4}-\d{2})/);
    accountingMonth = m ? m[1] : null;
  }

  await sock.sendMessage(msg.key.remoteJid, {
    text: `📥 Réception — ${LOCATION_NAME} — traitement…`,
  });

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger, reuploadRequest: sock.updateMediaMessage }
    );

    const fromPhone = phoneFromJid(msg.key.remoteJid);
    const result = await postToCompta(buffer, meta, fromPhone, docType, accountingMonth);

    if (docType === 'statement') {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `✅ Relevé enregistré — ${LOCATION_NAME}\n${result.transactions || 0} dépense(s) importée(s).`,
      });
    } else {
      const inv = result.invoice || {};
      await sock.sendMessage(msg.key.remoteJid, {
        text: [
          `✅ Facture enregistrée — ${LOCATION_NAME}`,
          inv.invoice_date ? `📅 ${inv.invoice_date}` : null,
          inv.amount_ttc != null ? `💶 ${Number(inv.amount_ttc).toFixed(2)} €` : null,
          inv.vendor_name ? `🏢 ${inv.vendor_name}` : null,
          `📁 Mois : ${inv.accounting_month || '—'}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
  } catch (err) {
    logger.error({ err }, 'upload failed');
    await sock.sendMessage(msg.key.remoteJid, {
      text: `❌ Erreur : ${err.response?.data?.error || err.message}`,
    });
  }
}

async function handleIncomingMessages(m) {
  if (m.type && m.type !== 'notify') return;
  for (const msg of m.messages || []) {
    try {
      if (!msg.message || msg.key.fromMe) continue;
      const meta = mediaMeta(msg);
      if (meta) await handleMediaMessage(msg);
    } catch (err) {
      logger.error({ err }, 'message error');
    }
  }
}

async function startSocket() {
  ensureConfig();
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', handleIncomingMessages);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentQrBase64 = await qrcode.toDataURL(qr);
      logger.info('QR code généré — GET /api/qr');
    }
    if (connection === 'open') {
      isConnected = true;
      currentQrBase64 = null;
      logger.info({ LOCATION_SLUG }, 'WhatsApp connecté');
    }
    if (connection === 'close') {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const restart = code !== DisconnectReason.loggedOut;
      logger.warn({ code }, 'connexion fermée');
      if (restart) setTimeout(startSocket, 3000);
    }
  });
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    connected: isConnected,
    location: LOCATION_SLUG,
    name: LOCATION_NAME,
  });
});

app.get('/api/qr', (req, res) => {
  if (isConnected) return res.json({ connected: true });
  if (!currentQrBase64) return res.status(404).json({ error: 'QR non disponible' });
  res.json({ qr: currentQrBase64 });
});

app.listen(PORT, () => {
  logger.info({ PORT, LOCATION_SLUG }, 'compta-boxing-bot démarré');
  startSocket().catch((err) => logger.error({ err }, 'socket start failed'));
});
