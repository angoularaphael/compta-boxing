# Compta Boxing — 3 salles

Collecte de factures d'achat via WhatsApp (4 bots), rapprochement bancaire et export mensuel pour le comptable.

## Stack

- **Next.js 14** + **Supabase** (PostgreSQL + Storage)
- **Baileys** (4 bots sur Bothosting)
- **OCR gratuit** : `pdf-parse` + `tesseract.js`
- **Export** : `pdf-lib` + `pdfkit` + ZIP

## Salles

| Slug | Nom | Bot |
|------|-----|-----|
| `minimes` | Minimes / États-Unis | port 3011 |
| `st_cyprien` | Saint-Cyprien | port 3012 |
| `ramonville` | Ramonville | port 3013 |

## Installation locale

```bash
cd compta-boxing
npm install
cp .env.example .env.local
# Renseigner Supabase + SUPER_ADMIN_EMAIL/PASSWORD
npm run dev
```

App : http://localhost:3020

## Supabase

1. Exécuter [`supabase/migrations/001_compta.sql`](supabase/migrations/001_compta.sql)
2. Si la base existait déjà avec 4 salles : exécuter [`003_three_locations.sql`](supabase/migrations/003_three_locations.sql)
3. Créer les buckets Storage (voir [`002_storage_buckets.md`](supabase/migrations/002_storage_buckets.md)) :
   - `compta-invoices`
   - `compta-statements`
   - `compta-exports`

## Variables Vercel (`.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SESSION_SECRET=
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=
WHATSAPP_WEBHOOK_SECRET=
```

## Bots WhatsApp (Bothosting) — configuration

**3 instances séparées** (1 numéro WhatsApp = 1 salle = 1 serveur Bothosting).

### Étape 1 — Vercel en production

Une fois l'app déployée, note l'URL : `https://compta-boxing.vercel.app`

Sur Vercel, variable obligatoire :
```
WHATSAPP_WEBHOOK_SECRET=3Giffareno237
```
(même valeur sur chaque bot)

### Étape 2 — Créer 4 serveurs Bothosting

| Salle | Port suggéré | Fichier modèle |
|-------|--------------|----------------|
| Minimes / États-Unis | 3011 | `bots/env/minimes.env.example` |
| Saint-Cyprien | 3012 | `bots/env/st_cyprien.env.example` |
| Ramonville | 3013 | `bots/env/ramonville.env.example` |

Sur chaque serveur :
```bash
cd bots
npm install
cp env/minimes.env.example .env   # adapter par salle
npm start
```

### Étape 3 — Remplir le `.env` de chaque bot

```env
LOCATION_SLUG=minimes
LOCATION_NAME=Minimes / États-Unis
PORT=3011

COMPTA_WEBHOOK_URL=https://compta-boxing.vercel.app
WHATSAPP_WEBHOOK_SECRET=3Giffareno237

# Numéro du client autorisé (chiffres uniquement, sans +)
ALLOWED_PHONES=33612345678
```

### Étape 4 — Scanner le QR WhatsApp

Ouvrir dans le navigateur :
```
http://<ip-bothosting>:3011/api/qr
```
Scanner avec le téléphone de la salle concernée. Répéter pour les 3 ports.

Vérifier : `http://<ip>:3011/api/health` → `"connected": true`

### Étape 5 — Usage client

| Action | Comment |
|--------|---------|
| Envoyer une facture | Photo ou PDF directement, ou répondre au fichier avec `.upload` |
| Envoyer un relevé | PDF + légende `releve 2026-03`, ou `.upload releve 2026-03` en réponse |
| Autoriser un numéro | Admin : `.setsudo 33612345678` |
| Aide | `.menu` sur WhatsApp |
| Choisir la salle | Envoyer sur le **bon numéro** WhatsApp |

Le bot répond automatiquement : facture reçue, date, montant, mois comptable.

### Commandes WhatsApp

- `.menu` — aide
- `.upload` — répondre à une photo/PDF pour l'envoyer au site
- `.upload releve 2026-03` — relevé bancaire (réponse au PDF)
- `.setsudo NUMERO` — admin : autoriser un numéro (ex. `.setsudo 33612345678`)
- `.unsudo NUMERO` — retirer un numéro
- `.sudo` — liste des numéros autorisés
- `.ping` — test de connexion

### Dépannage

- **Secret invalide** → vérifier `WHATSAPP_WEBHOOK_SECRET` identique Vercel + bot
- **Numéro non autorisé** → admin envoie `.setsudo VOTRE_NUMERO` ou ajouter dans `ALLOWED_PHONES`
- **Bucket error** → créer les buckets Supabase Storage
- **OCR vide** → normal sur photo floue ; corriger dans le back-office

## Déploiement Vercel

1. Importer le projet `compta-boxing` sur Vercel
2. Variables d'environnement (voir ci-dessus)
3. `COMPTA_WEBHOOK_URL` des bots = URL Vercel de production

## Usage client

1. Enregistrer 3 contacts WhatsApp (un par salle)
2. Photographier / envoyer chaque facture sur le bon numéro
3. Back-office : importer le relevé, lancer **Auto-rapprocher**, corriger manuellement si besoin
4. **Exporter le mois** → ZIP pour le comptable

## API principale

| Route | Rôle |
|-------|------|
| `POST /api/webhook/whatsapp` | Bot → facture / relevé |
| `GET /api/invoices` | Liste factures |
| `POST /api/statements` | Import relevé |
| `GET/POST/PUT /api/match` | Rapprochement |
| `GET /api/export` | ZIP mensuel |
