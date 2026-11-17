# MishMash Finances — Product Plan

## Vision

A private personal finance web app that gathers the best ideas from YNAB, Monarch, Copilot,
Goodbudget, Empower, Kubera, Rocket Money, Actual Budget, Firefly III and Tiller, with one firm rule:

**It never connects to live financial data.** You import CSV files you export from your bank.
Everything is stored encrypted on your own device. There is no server, no account and no tracking.

## Region

Built for Singapore first: SGD is the default currency, dates are read day-first, default categories
include Town council, Hawker & food court, Public transport, Grab & taxi, Income tax and CPF & SRS
top-ups, and the importer skips the account-details block that local bank CSV exports put above
the transaction table. Other currencies work with manual exchange rates.

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
- **Biometric unlock** uses a passkey with the WebAuthn PRF extension. It needs Chrome/Edge/Android or Safari 18+; elsewhere the passphrase is the only option.
- **Shared files** (Android share target) wait unencrypted in the service worker cache until the app is unlocked, then are deleted.
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
| **0. Foundation** | Vite/React PWA, encrypted vault, passphrase setup and lock screen, auto-lock, data model, accounts, manual transactions, encrypted backup/restore, erase device | Done |
| **1. Import** | CSV import with delimiter, header, column and date-format detection; signed or money-in/money-out amounts; saved bank layouts; duplicate detection on re-import; preview; undo an import; Android share target | Done |
| **2. Track** | Rules engine, review inbox, payee cleanup, learned categorization, transfer detection and linking, split transactions, search and filters, spending charts | Done |
| **3. Budget** | Zero-based and envelope budgeting with rollover, move money between categories, monthly and save-by-date targets, 50/30/20, tracking-only mode | Done |
| **4. Plan** | Recurring bill, subscription and income detection (weekly to yearly, twice-monthly pay), price-rise alerts, bill calendar, goals, avalanche vs snowball debt planner, cash-flow forecast | Done |
| **5. Wealth** | Assets and debts valued by hand (property, vehicles, investments), net worth history, manual exchange rates, Monte Carlo retirement projection | Done |
| **6. Polish** | Monthly recap, biometric unlock (WebAuthn PRF passkey), OFX/QFX and QIF import, CSV export, keyboard shortcuts, backup reminders | Done |

### Ideas for later
- Device-to-device sync over the local network (no server)
- Reports builder with saved reports
- Investment holdings import from brokerage CSVs
- Receipt photos attached to transactions (stored encrypted)
- Localisation (languages, number and date formats)

## Trade-offs accepted

- Users export CSVs from their bank regularly, so importing must be fast (templates, share target).
- No automatic investment prices or property valuations.
- Without a backup, losing the device or clearing browser data loses the data.
