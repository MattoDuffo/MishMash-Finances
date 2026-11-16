# MishMash Finances

A private personal finance web app. You import CSV files from your bank; everything is stored
encrypted on your own device. No bank connections, no server, no account, no tracking.

See [docs/PLAN.md](docs/PLAN.md) for the full product plan and roadmap.

## Status: Phase 0 prototype

- Create a vault protected by a passphrase (AES-256-GCM, PBKDF2-derived key)
- Lock screen, auto-lock after inactivity, screen blur when the app is in the background
- Accounts with opening balances and net worth
- Add, edit, search and delete transactions with categories
- Encrypted backup download and restore
- Erase all data from the device
- Installable PWA that works offline; strict Content Security Policy

CSV import is the next phase.

## Development

```bash
npm install
npm run dev       # start the dev server
npm test          # run unit tests
npm run build     # type-check and build static files into dist/
npm run preview   # serve the production build locally
```

## Deploying

`dist/` is a static site that can go on any static host. Serve it over HTTPS (required for
WebCrypto and service workers), and add the header `Content-Security-Policy: frame-ancestors 'none'`.

## Project layout

```
src/crypto/   passphrase-based encryption (WebCrypto)
src/db/       encrypted IndexedDB storage, backups
src/domain/   data model, money parsing and formatting, default categories
src/ui/       React screens
public/       manifest, icon, service worker
docs/         product plan
```
