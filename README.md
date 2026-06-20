# Compta Boxing — 4 salles

Collecte de factures d'achat via WhatsApp (4 bots), rapprochement bancaire et export mensuel pour le comptable.

## Stack

- **Next.js 14** + **Supabase** (PostgreSQL + Storage)
- **Baileys** (4 bots sur Bothosting)
- **OCR gratuit** : `pdf-parse` + `tesseract.js`
- **Export** : `pdf-lib` + `pdfkit` + ZIP

## Salles

| Slug | Nom | Bot |
|------|-----|-----|
| `minimes` | Minimes | port 3011 |
| `etats_unis` | États-Unis | port 3012 |
| `st_cyprien` | Saint-Cyprien | port 3013 |
| `ramonville` | Ramonville | port 3014 |

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
2. Créer les buckets Storage (voir [`002_storage_buckets.md`](supabase/migrations/002_storage_buckets.md)) :
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

## Bots WhatsApp (Bothosting)

Une **instance Bothosting par salle** (4 numéros permanents) :

```bash
cd compta-boxing/bots
npm install
cp env/minimes.env.example .env
npm start
```

- Scanner le QR : `GET http://<bothosting-host>:<port>/api/health`
- Envoyer une **photo ou PDF** → facture classée par mois
- Légende `releve 2026-01` sur un PDF → import relevé bancaire du mois

Fichiers d'exemple : [`bots/env/`](bots/env/)

## Déploiement Vercel

1. Importer le projet `compta-boxing` sur Vercel
2. Variables d'environnement (voir ci-dessus)
3. `COMPTA_WEBHOOK_URL` des bots = URL Vercel de production

## Usage client

1. Enregistrer 4 contacts WhatsApp (un par salle)
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
