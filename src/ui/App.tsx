import { useCallback, useEffect, useRef, useState } from 'react';
import { vaultStatus, type Session } from '../db/store';
import { SessionContext, readPref } from './session';
import { SetupScreen } from './SetupScreen';
import { LockScreen } from './LockScreen';
import { HomeView } from './HomeView';
import { TransactionsView } from './TransactionsView';
import { BudgetView } from './BudgetView';
import { PlanView } from './PlanView';
import { WealthView } from './WealthView';
import { SettingsView } from './SettingsView';
import { ShortcutHelp, useShortcuts } from './shortcuts';
import { takeSharedFile } from './share';

export type Tab = 'home' | 'transactions' | 'budget' | 'plan' | 'wealth' | 'settings';
const TABS: [Tab, string][] = [
  ['home', 'Home'],
  ['transactions', 'Transactions'],
  ['budget', 'Budget'],
  ['plan', 'Plan'],
  ['wealth', 'Wealth'],
];

export interface Nav {
  go: (tab: Tab, sub?: string) => void;
  sub: string | null;
}

type Phase = { kind: 'loading' } | { kind: 'new' } | { kind: 'locked' } | { kind: 'open'; session: Session };

function readHash(): { tab: Tab; sub: string | null } {
  const [tab, sub] = location.hash.replace('#', '').split('-');
  const valid = [...TABS.map(([t]) => t), 'settings'] as string[];
  return { tab: valid.includes(tab) ? (tab as Tab) : 'home', sub: sub ?? null };
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [{ tab, sub }, setRoute] = useState(readHash);
  const [hidden, setHidden] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    vaultStatus()
      .then((s) => setPhase({ kind: s }))
      .catch(() => setPhase({ kind: 'new' }));
    navigator.storage?.persist?.().catch(() => undefined);
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((t: Tab, s?: string) => {
    const hash = s ? `${t}-${s}` : t;
    if (location.hash.replace('#', '') !== hash) location.hash = hash;
    setRoute({ tab: t, sub: s ?? null });
    window.scrollTo(0, 0);
  }, []);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.kind === 'open') p.session.lock();
      return { kind: 'locked' };
    });
  }, []);

  const open = useCallback(
    async (session: Session) => {
      setPhase({ kind: 'open', session });
      // A file shared to the app (Android share sheet) waits until unlock.
      const f = await takeSharedFile();
      if (f) {
        setSharedFile(f);
        go('transactions', 'import');
      }
    },
    [go],
  );

  useAutoLock(phase.kind === 'open', lock);
  useShortcuts(phase.kind === 'open', { go, lock, help: () => setShowHelp((v) => !v) });

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    const onBlur = () => setHidden(true);
    const onFocus = () => setHidden(false);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  let body;
  switch (phase.kind) {
    case 'loading':
      body = <div className="center-screen muted">Opening…</div>;
      break;
    case 'new':
      body = <SetupScreen onReady={open} />;
      break;
    case 'locked':
      body = <LockScreen onUnlock={open} onErased={() => setPhase({ kind: 'new' })} />;
      break;
    case 'open': {
      const nav: Nav = { go, sub };
      body = (
        <SessionContext.Provider value={phase.session}>
          <div className="shell">
            <header className="topbar">
              <button className="brand" onClick={() => go('home')} aria-label="Home">
                <img src="/icon.svg" alt="" width={28} height={28} />
                <span>MishMash</span>
              </button>
              <nav className="topnav" aria-label="Sections">
                {TABS.map(([id, label]) => (
                  <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id} onClick={() => go(id)}>
                    {label}
                  </button>
                ))}
              </nav>
              <div className="row">
                <button className={'btn ghost ' + (tab === 'settings' ? 'active' : '')} onClick={() => go('settings')}>
                  Settings
                </button>
                <button className="btn ghost" onClick={lock}>
                  Lock
                </button>
              </div>
            </header>
            <main className="content">
              {tab === 'home' && <HomeView nav={nav} />}
              {tab === 'transactions' && <TransactionsView nav={nav} sharedFile={sharedFile} clearShared={() => setSharedFile(null)} />}
              {tab === 'budget' && <BudgetView nav={nav} />}
              {tab === 'plan' && <PlanView nav={nav} />}
              {tab === 'wealth' && <WealthView nav={nav} />}
              {tab === 'settings' && <SettingsView onErased={() => setPhase({ kind: 'new' })} onHelp={() => setShowHelp(true)} />}
            </main>
            <nav className="tabbar" aria-label="Sections">
              {TABS.map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id} onClick={() => go(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
          </div>
        </SessionContext.Provider>
      );
    }
  }

  return <div className={hidden && phase.kind === 'open' ? 'privacy-blur' : ''}>{body}</div>;
}

/** Locks after a period with no taps, keys or scrolling. */
function useAutoLock(active: boolean, lock: () => void) {
  const timer = useRef<number>();
  useEffect(() => {
    if (!active) return;
    const minutes = readPref<number>('autoLockMinutes', 5);
    if (minutes <= 0) return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(lock, minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [active, lock]);
}
