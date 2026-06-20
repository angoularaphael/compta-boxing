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

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0') && digits.length === 10) return `33${digits.slice(1)}`;
  if (digits.startsWith('33') && digits.length >= 11) return digits;
  return digits;
}

function isValidPhoneDigits(digits) {
  return digits.length >= 9 && digits.length <= 15;
}

const PORT = Number(process.env.PORT || 3011);
const LOCATION_SLUG = String(process.env.LOCATION_SLUG || '').trim();
const LOCATION_NAME = process.env.LOCATION_NAME || LOCATION_SLUG;
const WEBHOOK_URL = String(process.env.COMPTA_WEBHOOK_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || '';
const BOT_ADMIN_PHONE = normalizePhone(
  process.env.BOT_ADMIN_PHONE || process.env.MANDATORY_ADMIN_PHONE || '33762641473'
);
const ENV_ALLOWED_PHONES = String(process.env.ALLOWED_PHONES || '')
  .split(/[,;\s]+/)
  .map(normalizePhone)
  .filter(isValidPhoneDigits);

const DATA_DIR = path.join(
  process.env.BOT_DATA_DIR || path.join(__dirname, 'data'),
  LOCATION_SLUG || 'default'
);
const AUTH_DIR = path.join(DATA_DIR, 'wa-session');
const SUDO_CONFIG_FILE = path.join(DATA_DIR, 'sudo-phones.json');
const LEGACY_AUTH_DIR = path.join(__dirname, 'auth', LOCATION_SLUG || 'default');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let sock = null;
let currentQrBase64 = null;
let isConnected = false;
let isLinking = false;
let qrError = null;
let linkRequested = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 6;
const socketLogger = pino({ level: 'silent' });
const lidPhoneCache = new Map();

const app = express();
app.use(cors());
app.use(express.json());

function ensureConfig() {
  if (!LOCATION_SLUG) throw new Error('LOCATION_SLUG requis');
  if (!WEBHOOK_URL) throw new Error('COMPTA_WEBHOOK_URL requis');
}

function phoneFromJid(jid) {
  return normalizePhone(String(jid || '').split('@')[0]);
}

function isPnJid(jid) {
  const s = String(jid || '');
  return s.includes('@s.whatsapp.net') || s.endsWith('@c.us');
}

function isLidJid(jid) {
  return String(jid || '').includes('@lid');
}

function storeLidMapping(lid, pn) {
  const lidKey = normalizePhone(lid);
  const phone = normalizePhone(pn);
  if (lidKey && phone && isValidPhoneDigits(phone)) {
    lidPhoneCache.set(lidKey, phone);
  }
}

function cacheLidFromMessage(key) {
  if (!key) return;
  const primary = key.participant || key.remoteJid;
  const alt = key.participantAlt || key.remoteJidAlt;
  if (primary && alt && (isLidJid(primary) || !isPnJid(primary)) && isPnJid(alt)) {
    storeLidMapping(primary, alt);
  }
}

function resolveSenderPhone(msg) {
  const key = msg.key || {};
  if (msg.key?.fromMe) {
    return sock?.user?.id ? normalizePhone(sock.user.id) : '';
  }
  for (const altJid of [key.participantAlt, key.remoteJidAlt]) {
    if (altJid && isPnJid(altJid)) {
      const phone = normalizePhone(altJid);
      if (isValidPhoneDigits(phone)) return phone;
    }
  }
  const primary = key.participant || key.remoteJid || '';
  if (primary && isPnJid(primary)) {
    const phone = normalizePhone(primary);
    if (isValidPhoneDigits(phone)) return phone;
  }
  const lidKey = normalizePhone(primary);
  if (lidKey && lidPhoneCache.has(lidKey)) {
    return lidPhoneCache.get(lidKey);
  }
  if (sock?.signalRepository?.lidMapping?.getPNForLID) {
    try {
      const lidJid = isLidJid(primary) ? primary : `${lidKey}@lid`;
      const pn = sock.signalRepository.lidMapping.getPNForLID(lidJid);
      if (pn) {
        const phone = normalizePhone(pn);
        if (isValidPhoneDigits(phone)) {
          storeLidMapping(lidKey, phone);
          return phone;
        }
      }
    } catch (err) {
      logger.warn({ err }, 'getPNForLID');
    }
  }
  if (isValidPhoneDigits(lidKey) && !isLidJid(primary)) {
    return lidKey;
  }
  return '';
}

let sudoConfig = { sudoPhones: [] };

function saveSudoConfig() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUDO_CONFIG_FILE, JSON.stringify(sudoConfig, null, 2));
}

function loadSudoConfig() {
  if (!fs.existsSync(SUDO_CONFIG_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(SUDO_CONFIG_FILE, 'utf8'));
    sudoConfig.sudoPhones = Array.isArray(parsed.sudoPhones)
      ? parsed.sudoPhones.map(normalizePhone).filter(isValidPhoneDigits)
      : [];
    saveSudoConfig();
  } catch (err) {
    logger.warn({ err }, 'lecture sudo-phones.json');
  }
}

loadSudoConfig();

function copyAuthFiles(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return false;
  const srcResolved = path.resolve(srcDir);
  const destResolved = path.resolve(destDir);
  if (srcResolved === destResolved) return false;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  if (destResolved.startsWith(`${srcResolved}${path.sep}`)) {
    let copied = false;
    for (const name of fs.readdirSync(srcDir)) {
      if (name === 'wa-session' || name === 'sudo-phones.json') continue;
      const srcPath = path.join(srcDir, name);
      if (!fs.statSync(srcPath).isFile()) continue;
      const destPath = path.join(destDir, name);
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
        copied = true;
      }
    }
    return copied;
  }

  fs.cpSync(srcDir, destDir, { recursive: true, force: true });
  return true;
}

function migrateLegacyData() {
  const newCreds = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(newCreds)) {
    const legacyCreds = path.join(LEGACY_AUTH_DIR, 'creds.json');
    const nestedLegacyCreds = path.join(LEGACY_AUTH_DIR, 'wa-session', 'creds.json');
    const srcDir = fs.existsSync(legacyCreds)
      ? LEGACY_AUTH_DIR
      : fs.existsSync(nestedLegacyCreds)
        ? path.join(LEGACY_AUTH_DIR, 'wa-session')
        : null;
    if (srcDir && copyAuthFiles(srcDir, AUTH_DIR)) {
      logger.info({ from: srcDir, to: AUTH_DIR }, 'session WhatsApp migrée');
    }
  }

  const legacySudo = path.join(LEGACY_AUTH_DIR, 'sudo-phones.json');
  if (fs.existsSync(legacySudo) && !fs.existsSync(SUDO_CONFIG_FILE)) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(legacySudo, SUDO_CONFIG_FILE);
    loadSudoConfig();
    logger.info({ DATA_DIR }, 'sudo-phones migré');
  }
}

migrateLegacyData();

function getAllAllowedPhones() {
  const admin = BOT_ADMIN_PHONE;
  const extra = (sudoConfig.sudoPhones || [])
    .map(normalizePhone)
    .filter((p) => p && p !== admin);
  return [...new Set([admin, ...ENV_ALLOWED_PHONES, ...extra].filter(isValidPhoneDigits))];
}

function phoneMatches(phone, allowed) {
  const p = normalizePhone(phone);
  const a = normalizePhone(allowed);
  if (!p || !a) return false;
  return p === a || p.endsWith(a) || a.endsWith(p);
}

function isAllowedPhone(phone) {
  const list = getAllAllowedPhones();
  if (!list.length) return true;
  return list.some((p) => phoneMatches(phone, p));
}

function isAllowed(msg) {
  cacheLidFromMessage(msg.key);
  const phone = resolveSenderPhone(msg);
  if (!phone) {
    logger.warn(
      { jid: msg.key?.remoteJid, alt: msg.key?.remoteJidAlt },
      'numéro expéditeur non résolu (LID)'
    );
    return false;
  }
  return isAllowedPhone(phone);
}

function isSudoAdmin(phone) {
  return phoneMatches(phone, BOT_ADMIN_PHONE);
}

function addSudoPhone(phone) {
  const p = normalizePhone(phone);
  if (!isValidPhoneDigits(p)) {
    return { ok: false, message: '❌ Numéro invalide.' };
  }
  if (phoneMatches(p, BOT_ADMIN_PHONE)) {
    return { ok: true, message: 'ℹ️ Ce numéro est déjà admin principal.' };
  }
  if (!sudoConfig.sudoPhones.some((x) => phoneMatches(x, p))) {
    sudoConfig.sudoPhones.push(p);
    saveSudoConfig();
  }
  return { ok: true, message: `✅ ${p} autorisé pour ${LOCATION_NAME}.` };
}

function removeSudoPhone(phone) {
  const p = normalizePhone(phone);
  if (phoneMatches(p, BOT_ADMIN_PHONE)) {
    return { ok: false, message: '⛔ Admin principal, non supprimable.' };
  }
  sudoConfig.sudoPhones = sudoConfig.sudoPhones.filter((x) => !phoneMatches(x, p));
  saveSudoConfig();
  return { ok: true, message: `✅ ${p} retiré.` };
}

function extractText(msg) {
  if (!msg?.message) return '';
  const contentType = getContentType(msg.message);
  if (contentType === 'conversation') return msg.message.conversation || '';
  if (contentType === 'extendedTextMessage') return msg.message.extendedTextMessage?.text || '';
  if (contentType === 'imageMessage') return msg.message.imageMessage?.caption || '';
  if (contentType === 'documentMessage') return msg.message.documentMessage?.caption || '';
  return '';
}

function getQuotedContext(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    null
  );
}

function parseCommandPhone(text, commandBase) {
  const trimmed = text.trim();
  const bases = [commandBase];
  if (commandBase === 'setsudo') bases.push('setsudo');
  if (commandBase === 'unsudo') bases.push('unsudo');
  for (const base of bases) {
    const patterns = [
      new RegExp(`^\\.${base}\\s*\\((\\d{9,15})\\)`, 'i'),
      new RegExp(`^\\.${base}\\s+(\\d{9,15})`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) return normalizePhone(match[1]);
    }
  }
  return null;
}

function parseUploadOptions(text) {
  const lower = text.trim().toLowerCase();
  let docType = 'invoice';
  let accountingMonth = null;
  if (lower.includes('releve') || lower.includes('relevé')) {
    docType = 'statement';
    const m = lower.match(/(\d{4}-\d{2})/);
    accountingMonth = m ? m[1] : null;
  }
  return { docType, accountingMonth };
}

async function reactToCommand(msg) {
  if (!sock || !msg?.key?.remoteJid) return;
  try {
    await sock.sendMessage(msg.key.remoteJid, { react: { text: '⏳', key: msg.key } });
  } catch {
    /* ignore */
  }
}

async function sendUnauthorized(msg) {
  const phone = resolveSenderPhone(msg) || phoneFromJid(msg.key?.remoteJid);
  await sock.sendMessage(msg.key.remoteJid, {
    text: [
      `⛔ Numéro non autorisé — ${LOCATION_NAME}`,
      phone ? `Identifiant détecté : ${phone}` : 'Numéro non identifié (LID WhatsApp)',
      '',
      'Demandez à l\'admin d\'exécuter :',
      '`.setsudo VOTRE_NUMERO`',
      '(ex. `.setsudo 33612345678`)',
    ].join('\n'),
  });
}

async function sendMenu(jid) {
  await sock.sendMessage(jid, {
    text: [
      `📋 *Compta — ${LOCATION_NAME}*`,
      '',
      '*Factures*',
      '• Envoyez une photo ou PDF directement',
      '• Ou répondez à un fichier avec `.upload`',
      '',
      '*Relevé bancaire*',
      '• PDF + légende `releve 2026-06`',
      '• Ou réponse : `.upload releve 2026-06`',
      '',
      '*Admin*',
      '• `.setsudo NUMERO` — autoriser un numéro',
      '• `.unsudo NUMERO` — retirer un numéro',
      '• `.sudo` — liste des numéros autorisés',
      '',
      `Site : ${WEBHOOK_URL}`,
    ].join('\n'),
  });
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

async function handleMediaMessage(msg, options = {}) {
  const fromPhone = resolveSenderPhone(msg) || phoneFromJid(msg.key.remoteJid);

  if (!isAllowed(msg)) {
    await sendUnauthorized(msg);
    return;
  }

  const meta = mediaMeta(msg);
  if (!meta) {
    await sock.sendMessage(msg.key.remoteJid, {
      text: '❌ Format non supporté. Envoyez une image (JPG/PNG) ou un PDF.',
    });
    return;
  }

  let docType = options.docType || 'invoice';
  let accountingMonth = options.accountingMonth || null;

  if (!options.docType) {
    const caption = (
      msg.message.imageMessage?.caption ||
      msg.message.documentMessage?.caption ||
      ''
    ).trim().toLowerCase();
    if (caption.startsWith('releve') || caption.startsWith('relevé')) {
      docType = 'statement';
      const m = caption.match(/(\d{4}-\d{2})/);
      accountingMonth = m ? m[1] : null;
    }
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
    logger.error({ err, fromPhone, docType }, 'upload failed');
    const detail = err.response?.data?.error || err.message;
    await sock.sendMessage(msg.key.remoteJid, {
      text: `❌ Erreur envoi vers le site : ${detail}`,
    });
  }
}

function buildQuotedMediaMessage(msg) {
  const ctx = getQuotedContext(msg);
  if (!ctx?.quotedMessage) return null;
  const quotedType = getContentType(ctx.quotedMessage);
  if (quotedType !== 'imageMessage' && quotedType !== 'documentMessage') return null;
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      fromMe: ctx.participant ? String(ctx.participant).includes('@s.whatsapp.net') : false,
      id: ctx.stanzaId,
      participant: ctx.participant || undefined,
    },
    message: ctx.quotedMessage,
  };
}

async function handleUploadCommand(msg, text) {
  const quotedMsg = buildQuotedMediaMessage(msg);
  if (!quotedMsg) {
    await sock.sendMessage(msg.key.remoteJid, {
      text: [
        '❌ Répondez à une photo, PDF ou document avec `.upload`',
        '',
        'Exemple : maintenez le fichier → Répondre → tapez `.upload`',
        'Relevé : `.upload releve 2026-06`',
      ].join('\n'),
    });
    return;
  }
  const { docType, accountingMonth } = parseUploadOptions(text);
  await handleMediaMessage(quotedMsg, { docType, accountingMonth });
}

async function handleCommand(msg, text) {
  const sender = msg.key.remoteJid;
  const senderPhone = resolveSenderPhone(msg) || phoneFromJid(sender);
  const cleanText = text.trim().toLowerCase();
  const cmd = cleanText.split(/\s+/)[0].split('(')[0];

  const known = [
    '.menu', '.aide', '.help', '.guide',
    '.ping', '.upload', '.setsudo', '.unsudo', '.sudo',
  ];
  if (!known.some((k) => cmd === k || cleanText.startsWith(`${k} `))) return;

  if (!isAllowed(msg) && !['.menu', '.aide', '.help', '.guide', '.ping'].includes(cmd)) {
    await sendUnauthorized(msg);
    return;
  }

  await reactToCommand(msg);

  if (cmd === '.menu' || cmd === '.aide' || cmd === '.help' || cmd === '.guide') {
    await sendMenu(sender);
    return;
  }

  if (cmd === '.ping') {
    await sock.sendMessage(sender, {
      text: `🏓 Pong — Compta ${LOCATION_NAME}\n${WEBHOOK_URL}`,
    });
    return;
  }

  if (cmd === '.upload') {
    await handleUploadCommand(msg, text);
    return;
  }

  if (cmd === '.sudo') {
    const phones = getAllAllowedPhones();
    await sock.sendMessage(sender, {
      text: [
        `👥 Numéros autorisés — ${LOCATION_NAME}`,
        `Admin : ${BOT_ADMIN_PHONE || '—'}`,
        ...phones.map((p) => `• ${p}`),
      ].join('\n'),
    });
    return;
  }

  if (cmd === '.setsudo') {
    if (!isSudoAdmin(senderPhone)) {
      await sock.sendMessage(sender, {
        text: '⛔ Seul l\'admin principal peut utiliser `.setsudo`.',
      });
      return;
    }
    const phone = parseCommandPhone(text, 'setsudo');
    if (!phone) {
      await sock.sendMessage(sender, { text: '❌ Format : `.setsudo NUMERO` (ex. `.setsudo 33612345678`)' });
      return;
    }
    const result = addSudoPhone(phone);
    await sock.sendMessage(sender, { text: result.message });
    return;
  }

  if (cmd === '.unsudo') {
    if (!isSudoAdmin(senderPhone)) {
      await sock.sendMessage(sender, {
        text: '⛔ Seul l\'admin principal peut utiliser `.unsudo`.',
      });
      return;
    }
    const phone = parseCommandPhone(text, 'unsudo');
    if (!phone) {
      await sock.sendMessage(sender, { text: '❌ Format : `.unsudo NUMERO`' });
      return;
    }
    const result = removeSudoPhone(phone);
    await sock.sendMessage(sender, { text: result.message });
  }
}

async function handleIncomingMessages(m) {
  if (m.type && m.type !== 'notify') return;
  for (const msg of m.messages || []) {
    try {
      if (!msg.message || msg.key.fromMe) continue;
      cacheLidFromMessage(msg.key);

      const text = extractText(msg);
      if (text.trim().startsWith('.')) {
        await handleCommand(msg, text);
        continue;
      }

      const meta = mediaMeta(msg);
      if (meta) await handleMediaMessage(msg);
    } catch (err) {
      logger.error({ err }, 'message error');
      try {
        await sock.sendMessage(msg.key.remoteJid, {
          text: `❌ Erreur bot : ${err.message}`,
        });
      } catch {
        /* ignore */
      }
    }
  }
}

function hasRegisteredSession() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    return Boolean(creds.registered);
  } catch {
    return false;
  }
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isQrExpiredError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('qr') && (msg.includes('expir') || msg.includes('timeout'));
}

function scheduleReconnect(delayMs, { clearAuth = false } = {}) {
  cancelReconnect();
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    isLinking = false;
    if (linkRequested) {
      qrError = 'Trop de tentatives. Cliquez sur Fermer puis Générer le QR.';
    }
    return;
  }
  reconnectAttempts += 1;
  isLinking = true;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToWhatsApp({
      force: true,
      clearAuth,
      silent: !linkRequested,
    }).catch((err) => logger.error({ err }, 'reconnexion échouée'));
  }, delayMs);
}

function clearAuthSession() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

async function destroySocket() {
  const old = sock;
  sock = null;
  if (!old) return;
  try {
    old.ev.removeAllListeners('connection.update');
    old.ev.removeAllListeners('creds.update');
    old.ev.removeAllListeners('messages.upsert');
    old.ev.removeAllListeners('lid-mapping.update');
    await old.end(undefined);
  } catch (err) {
    logger.warn({ err }, 'fermeture socket');
  }
}

async function connectToWhatsApp({ force = false, clearAuth = false, silent = false } = {}) {
  ensureConfig();
  if (isConnected && sock && !force) return;
  if (isLinking && !force) return;

  if (!silent) linkRequested = true;
  isLinking = true;
  if (force) qrError = null;

  cancelReconnect();
  if (force && clearAuth) reconnectAttempts = 0;

  await destroySocket();
  if (clearAuth) {
    clearAuthSession();
    currentQrBase64 = null;
  }

  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1017578768];
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version;
    } catch {
      logger.warn('Version WA par défaut');
    }

    sock = makeWASocket({
      version,
      auth: state,
      logger: socketLogger,
      printQRInTerminal: false,
      browser: ['Compta Boxing', 'Chrome', '120.0.0.0'],
      qrTimeout: 60000,
      connectTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('lid-mapping.update', (update) => {
      if (!update || typeof update !== 'object') return;
      const entries = Array.isArray(update)
        ? update
        : Object.entries(update).map(([lid, pn]) => ({ lid, pn }));
      for (const entry of entries) {
        const lid = entry.lid || entry[0];
        const pn = entry.pn || entry[1];
        if (lid && pn) storeLidMapping(lid, pn);
      }
    });
    sock.ev.on('messages.upsert', handleIncomingMessages);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        if (!linkRequested) {
          logger.info('QR ignoré — cliquez sur Générer le QR dans l\'app');
          return;
        }
        currentQrBase64 = await qrcode.toDataURL(qr);
        qrError = null;
        reconnectAttempts = 0;
        logger.info('QR code généré — GET /api/status');
      }
      if (connection === 'open') {
        isConnected = true;
        isLinking = false;
        linkRequested = false;
        currentQrBase64 = null;
        qrError = null;
        reconnectAttempts = 0;
        cancelReconnect();
        logger.info({ LOCATION_SLUG }, 'WhatsApp connecté');
      }
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        logger.warn({ code: statusCode }, 'connexion fermée');
        await destroySocket();
        if (loggedOut) {
          isLinking = false;
          linkRequested = false;
          currentQrBase64 = null;
          clearAuthSession();
          return;
        }
        if (linkRequested && isQrExpiredError(lastDisconnect?.error)) {
          currentQrBase64 = null;
          scheduleReconnect(3000, { clearAuth: true });
          return;
        }
        if (linkRequested || hasRegisteredSession()) {
          const delay = statusCode === DisconnectReason.restartRequired ? 1500 : 5000;
          scheduleReconnect(delay, { clearAuth: false });
          return;
        }
        isLinking = false;
        currentQrBase64 = null;
      }
    });
  } catch (err) {
    isLinking = false;
    if (!silent) linkRequested = false;
    qrError = err.message || 'Erreur de connexion.';
    logger.error({ err }, 'connexion WhatsApp échouée');
    await destroySocket();
    throw err;
  }
}

async function stopLinking() {
  cancelReconnect();
  reconnectAttempts = 0;
  linkRequested = false;
  isLinking = false;
  currentQrBase64 = null;
  qrError = null;
  await destroySocket();
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    connected: isConnected,
    connecting: linkRequested && isLinking && !isConnected,
    location: LOCATION_SLUG,
    name: LOCATION_NAME,
    allowedPhones: getAllAllowedPhones().length,
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    connecting: (linkRequested || isLinking) && !isConnected,
    linkRequested,
    qr: linkRequested ? currentQrBase64 : null,
    qrError: linkRequested ? qrError : null,
    location: LOCATION_SLUG,
    name: LOCATION_NAME,
  });
});

app.get('/api/qr', (req, res) => {
  if (isConnected) return res.json({ connected: true });
  if (!linkRequested) {
    return res.status(404).json({ error: 'Cliquez sur Générer le QR dans l\'app' });
  }
  if (!currentQrBase64) return res.status(404).json({ error: 'QR en cours de génération…' });
  res.json({ qr: currentQrBase64 });
});

app.post('/api/start', (req, res) => {
  if (isConnected) return res.json({ success: true, message: 'Already connected' });
  cancelReconnect();
  reconnectAttempts = 0;
  linkRequested = true;
  const hasSession = hasRegisteredSession();
  res.json({
    success: true,
    message: hasSession ? 'Reconnexion en cours' : 'Started connection process',
  });
  connectToWhatsApp({
    force: true,
    clearAuth: !hasSession,
  }).catch((err) => {
    isLinking = false;
    linkRequested = false;
    qrError = err.message || 'Erreur de connexion.';
    logger.error({ err }, '/api/start failed');
  });
});

app.post('/api/stop', async (req, res) => {
  await stopLinking();
  res.json({ success: true, message: 'Linking stopped' });
});

app.post('/api/logout', async (req, res) => {
  cancelReconnect();
  reconnectAttempts = 0;
  linkRequested = false;
  isLinking = false;
  const activeSock = sock;
  if (activeSock) {
    try {
      await activeSock.logout();
    } catch (err) {
      logger.warn({ err }, 'logout');
    }
  }
  await destroySocket();
  isConnected = false;
  currentQrBase64 = null;
  qrError = null;
  clearAuthSession();
  res.json({ success: true, message: 'Logged out' });
});

app.listen(PORT, () => {
  logger.info({ PORT, LOCATION_SLUG, dataDir: DATA_DIR }, 'compta-boxing-bot démarré');
  setTimeout(() => {
    if (hasRegisteredSession()) {
      connectToWhatsApp({ silent: true, force: true, clearAuth: false }).catch(
        (err) => logger.error({ err }, 'reconnexion session échouée')
      );
    }
  }, 3000);
});
