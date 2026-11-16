import { useCallback, useEffect, useRef, useState } from 'react';
import { vaultStatus, type Session } from '../db/store';
import { SessionContext, readPref } from './session';
import { SetupScreen } from './SetupScreen';
import { LockScreen } from './LockScreen';
import { TransactionsView } from './TransactionsView';
import { AccountsView } from './AccountsView';
import { SettingsView } from './SettingsView';

type Phase = { kind: 'loading' } | { kind: 'new' } | { kind: 'locked' } | { kind: 'open'; session: Session };
type Tab = 'transactions' | 'accounts' | 'settings';

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('transactions');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    vaultStatus()
      .then((s) => setPhase({ kind: s }))
      .catch(() => setPhase({ kind: 'new' }));
    // Ask the browser not to evict our data under storage pressure.
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.kind === 'open') p.session.lock();
      return { kind: 'locked' };
    });
  }, []);

  const open = useCallback((session: Session) => {
    setPhase({ kind: 'open', session });
  }, []);

  useAutoLock(phase.kind === 'open', lock);

  // Blur the screen when the app goes to the background, so balances
  // don't appear in the app switcher.
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
    case 'open':
      body = (
        <SessionContext.Provider value={phase.session}>
          <div className="shell">
            <header className="topbar">
              <div className="brand">
                <img src="/icon.svg" alt="" width={28} height={28} />
                <span>MishMash</span>
              </div>
              <button className="btn ghost" onClick={lock} aria-label="Lock now">
                Lock
              </button>
            </header>
            <main className="content">
              {tab === 'transactions' && <TransactionsView onGoToAccounts={() => setTab('accounts')} />}
              {tab === 'accounts' && <AccountsView />}
              {tab === 'settings' && <SettingsView onErased={() => setPhase({ kind: 'new' })} />}
            </main>
            <nav className="tabbar" aria-label="Sections">
              {(
                [
                  ['transactions', 'Transactions'],
                  ['accounts', 'Accounts'],
                  ['settings', 'Settings'],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </SessionContext.Provider>
      );
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
