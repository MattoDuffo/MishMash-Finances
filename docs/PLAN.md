# MishMash Finances — Product Plan

## Vision

A private personal finance web app that gathers the best ideas from YNAB, Monarch, Copilot,
Goodbudget, Empower, Kubera, Rocket Money, Actual Budget, Firefly III and Tiller, with one firm rule:

**It never connects to live financial data.** You import CSV files you export from your bank.
Everything is stored encrypted on your own device. There is no server, no account and no tracking.

## Principles

1. **CSV only.** No bank linking and no aggregators (Plaid, TrueLayer and so on).
2. **Local-first.** Data lives in the browser's IndexedDB on the user's device, encrypted.
3. **No network.** After the app itself loads, it makes no requests. A strict Content Security Policy enforces this.
4. **Installable web app.** Distributed as a PWA: works offline and can be added to the home screen on iOS, Android and desktop.
5. **No lock-in.** Encrypted backups and plain CSV export at any time.

## Features borrowed from other apps

| From | Feature |
|---|---|
| YNAB | Zero-based budgeting, covering overspending by moving money, age of money |
| Monarch | Household budgets, custom dashboard, rules, goals, monthly recap |
| Copilot | Categorization that learns from corrections, review inbox, recurring detection |
| Goodbudget | Envelope budgeting, fully manual use |
| Empower | Net worth over time, retirement projections |
| Kubera | Any asset type, multi-currency |
| Rocket Money | Subscription detection, price-increase alerts (computed from imported history) |
| Actual Budget | Local-first, encrypted, fast keyboard-driven interface |
| Firefly III | Strong rules engine |
| Tiller | Spreadsheet-friendly export |

## Security model

- **Envelope encryption.** A random AES-256-GCM data key encrypts every record. The data key is
  wrapped with a key derived from the user's passphrase (PBKDF2-SHA-256, 600,000 iterations).
- Only record ids are stored in readable form; everything else is ciphertext.
- The passphrase and unwrapped key live only in memory while unlocked. Locking clears them.
- Changing the passphrase re-wraps the data key; data is not re-encrypted.
- **No recovery.** A forgotten passphrase means the data can't be read. The app says this clearly and offers backups.
- Auto-lock after inactivity, plus a blurred screen when the app is in the background.
- `navigator.storage.persist()` asks the browser not to evict data.
- Strict CSP (`default-src 'self'`, no third-party origins). Hosting should also send
  `frame-ancestors 'none'` as a real HTTP header.

### Web-specific risks
- **Browser storage can be cleared** (by the user, or by Safari after a long period without use when the app isn't installed).
  Mitigation: install as a PWA, persistent storage, backup reminders.
- **Biometric unlock** isn't available in phase 0. Plan: WebAuthn with the PRF extension to unlock with Face ID / fingerprint.
- **Supply chain:** the hosted code could in theory change. Mitigation: open source, few dependencies, and an option to self-host the static build.

## Architecture

- **Vite + React + TypeScript**, built as static files. Any static host works (Cloudflare Pages, Netlify, GitHub Pages, self-hosted).
- **Storage:** IndexedDB (via `idb`), one object store per collection, each record encrypted with WebCrypto.
- **Domain logic:** plain TypeScript modules (money, CSV parsing, ledger, budgets, rules, forecasting), unit-tested with Vitest.
- **Offline:** a small hand-written service worker caches the app shell.
- **Money:** integer minor units (cents) everywhere; dates as `YYYY-MM-DD`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0. Foundation** | Vite/React PWA, encrypted vault, passphrase setup and lock screen, auto-lock, data model, accounts, manual transactions, encrypted backup/restore, erase device | **Done (prototype)** |
| **1. Import** | CSV import: file picker and drag-and-drop, column mapping, saved bank templates, date/amount format detection, duplicate detection, preview, undo an import. Web Share Target so Android can share a CSV straight into the app | Next |
| **2. Track** | Rules engine, review inbox, payee cleanup, spending charts, transfers between accounts, splits | |
| **3. Budget** | Zero-based budgeting first, then envelope and 50/30/20; rollovers and sinking funds | |
| **4. Plan** | Recurring and subscription detection, bill calendar, goals, debt payoff planner, cash-flow forecast | |
| **5. Wealth** | Manual assets and liabilities, net worth history, retirement projections, multi-currency totals | |
| **6. Polish** | Monthly recap, learned categorization, biometric unlock (WebAuthn PRF), OFX/QIF import, CSV export, keyboard shortcuts | |

## Trade-offs accepted

- Users export CSVs from their bank regularly, so importing must be fast (templates, share target).
- No automatic investment prices or property valuations.
- Without a backup, losing the device or clearing browser data loses the data.
