/**
 * Bootstrap Bothosting — clone le repo et lance le bot Compta Boxing.
 * Variables panneau Bothosting → .env du bot.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GITHUB_REPO_URL =
  process.env.BOT_GITHUB_REPO || 'https://github.com/angoularaphael/compta-boxing.git';
const APP_DIR_NAME = process.env.BOT_APP_DIR || 'compta-boxing-app';
const APP_DIR = path.join(__dirname, APP_DIR_NAME);
const BOTS_DIR = path.join(APP_DIR, 'bots');
const BOT_PORT = process.env.SERVER_PORT || process.env.PORT || '3011';

const ENV_KEYS = [
  'PORT',
  'SERVER_PORT',
  'LOCATION_SLUG',
  'LOCATION_NAME',
  'COMPTA_WEBHOOK_URL',
  'WHATSAPP_WEBHOOK_SECRET',
  'ALLOWED_PHONES',
  'LOG_LEVEL',
];

console.log('=== COMPTA BOXING BOT — BOTHOSTING ===');
console.log(`Salle : ${process.env.LOCATION_NAME || process.env.LOCATION_SLUG || '?'}`);

function runCommand(cmd, cwd = __dirname) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error(e.message);
    return false;
  }
}

function buildEnv() {
  const lines = ['# Auto-generated — Compta Boxing bot'];
  lines.push(`PORT=${BOT_PORT}`);
  for (const key of ENV_KEYS) {
    if (key === 'PORT') continue;
    const val = process.env[key];
    if (val != null && val !== '') {
      lines.push(/[\s#]/.test(val) ? `${key}="${String(val).replace(/"/g, '\\"')}"` : `${key}=${val}`);
    }
  }
  if (!lines.some((l) => l.startsWith('COMPTA_WEBHOOK_URL='))) {
    lines.push('COMPTA_WEBHOOK_URL=https://compta-boxing.vercel.app');
  }
  return `${lines.join('\n')}\n`;
}

const ROOT_ENV = path.join(__dirname, '.env');
const BOT_ENV = path.join(BOTS_DIR, '.env');

function syncEnvFile() {
  if (fs.existsSync(ROOT_ENV)) {
    fs.copyFileSync(ROOT_ENV, BOT_ENV);
    console.log('✅ .env copié depuis la racine Bothosting');
    return;
  }
  fs.mkdirSync(BOTS_DIR, { recursive: true });
  fs.writeFileSync(BOT_ENV, buildEnv(), 'utf8');
  console.log('✅ .env généré depuis variables panneau Bothosting');
}

async function bootstrap() {
  if (!fs.existsSync(APP_DIR)) {
    if (!runCommand(`git clone ${GITHUB_REPO_URL} ${APP_DIR_NAME}`)) process.exit(1);
  } else {
    runCommand('git pull', APP_DIR);
  }

  syncEnvFile();

  if (!runCommand('npm install --omit=dev', BOTS_DIR)) process.exit(1);

  console.log(`🚀 Bot démarré — port ${BOT_PORT}`);
  console.log(`📱 QR code : http://<ip-bothosting>:${BOT_PORT}/api/qr`);
  console.log(`💚 Santé   : http://<ip-bothosting>:${BOT_PORT}/api/health`);

  process.chdir(BOTS_DIR);
  require(path.join(BOTS_DIR, 'index.js'));
}

bootstrap();
