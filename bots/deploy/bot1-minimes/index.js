/**
 * BOT 1 — Minimes / États-Unis
 * Bothosting : copier ce fichier comme index.js à la racine + .env à côté
 */
process.env.LOCATION_SLUG = process.env.LOCATION_SLUG || 'minimes';
process.env.LOCATION_NAME = process.env.LOCATION_NAME || 'Minimes / États-Unis';
process.env.PORT = process.env.PORT || process.env.SERVER_PORT || '3011';

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
  'PORT', 'SERVER_PORT', 'LOCATION_SLUG', 'LOCATION_NAME',
  'COMPTA_WEBHOOK_URL', 'WHATSAPP_WEBHOOK_SECRET', 'ALLOWED_PHONES', 'LOG_LEVEL',
];

console.log('=== COMPTA BOXING — BOT 1 : Minimes / États-Unis ===');

function runCommand(cmd, cwd = __dirname) {
  console.log(`> ${cmd}`);
  try { execSync(cmd, { cwd, stdio: 'inherit' }); return true; }
  catch (e) { console.error(e.message); return false; }
}

function buildEnv() {
  const lines = ['# Compta Boxing bot'];
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

async function bootstrap() {
  if (!fs.existsSync(APP_DIR)) {
    if (!runCommand(`git clone ${GITHUB_REPO_URL} ${APP_DIR_NAME}`)) process.exit(1);
  } else {
    runCommand('git pull', APP_DIR);
  }
  const rootEnv = path.join(__dirname, '.env');
  const botEnv = path.join(BOTS_DIR, '.env');
  if (fs.existsSync(rootEnv)) fs.copyFileSync(rootEnv, botEnv);
  else { fs.mkdirSync(BOTS_DIR, { recursive: true }); fs.writeFileSync(botEnv, buildEnv()); }
  if (!runCommand('npm install --omit=dev', BOTS_DIR)) process.exit(1);
  process.chdir(BOTS_DIR);
  require(path.join(BOTS_DIR, 'index.js'));
}

bootstrap();
