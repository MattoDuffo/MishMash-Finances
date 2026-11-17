# MishMash Finances

A private personal finance web app. You import CSV files from your bank; everything is stored
encrypted on your own device. No bank connections, no server, no account, no tracking.

See [docs/PLAN.md](docs/PLAN.md) for the full product plan and roadmap.

## Features

**Import**: CSV, OFX/QFX and QIF files from any bank. Columns, date formats and amount layouts are
detected automatically and remembered per bank. Re-importing an overlapping statement skips what's
already there. Every import can be undone. On Android the installed app accepts files from the share sheet.

**Track**: Review inbox for new imports, rules, readable payee names, categories learned from your
corrections, transfer detection, split transactions, search, filters and CSV export.

**Budget**: Pick a method and switch at any time without losing data: zero-based, envelopes,
50/30/20 or just tracking. Leftovers roll over, overspending can be covered from other categories,
and targets (monthly or save-by-date) suggest how much to set aside.

**Plan**: Bills, subscriptions and pay are found in your history, with price-rise alerts, a bill
calendar, a cash-flow forecast, savings goals and an avalanche vs snowball debt payoff planner.

**Wealth**: Accounts, plus assets and debts you value by hand (home, car, pension). Net worth over
time, multiple currencies with your own exchange rates, and a Monte Carlo retirement projection.

**Home**: Monthly recap, spending by category, six-month trend, upcoming bills and reminders.

**Security**: Passphrase-encrypted storage (AES-256-GCM), optional Face ID / fingerprint unlock,
auto-lock, screen blur in the app switcher, encrypted backups, no network requests (enforced by a
Content Security Policy). Works offline and installs to the home screen.

Keyboard shortcuts: press `?` in the app.

## Development

```bash
npm install
npm run dev       # start the dev server
npm test          # run unit tests
npm run build     # type-check and build static files into dist/
npm run preview   # serve the production build locally
```

## Deploying

The app is deployed to **GitHub Pages** by `.github/workflows/deploy.yml` on every push to `main`
(tests run first; a failing test stops the deploy). It's served at
`https://<owner>.github.io/<repo>/`, for this repository
**https://mattoduffo.github.io/MishMash-Finances/**.

One-time setup in the repository's **Settings → Pages**: set **Source** to **GitHub Actions**.
GitHub Pages needs a public repository on a free account (or GitHub Pro/Team for a private one).

The build reads `BASE_PATH` (set automatically by the workflow) so it works from a sub-folder.
To host it elsewhere, run `npm run build` and upload `dist/` to any static HTTPS host; ideally also
send the header `Content-Security-Policy: frame-ancestors 'none'` (GitHub Pages can't set headers).

Other branches and pull requests run tests and a build via `.github/workflows/test.yml`.

## Project layout

```
src/crypto/   passphrase and biometric encryption (WebCrypto, WebAuthn)
src/db/       encrypted IndexedDB storage, backups
src/import/   CSV/OFX/QIF parsing, column detection, import pipeline
src/domain/   data model and all finance logic (budgets, recurring, forecast, debt, wealth, retirement)
src/ui/       React screens and SVG charts
public/       manifest, icon, service worker
docs/         product plan
```
