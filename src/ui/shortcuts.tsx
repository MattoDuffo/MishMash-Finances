import { useEffect, useRef } from 'react';
import type { Tab } from './App';

export const SHORTCUTS: [string, string][] = [
  ['g h', 'Go to Home'],
  ['g t', 'Go to Transactions'],
  ['g b', 'Go to Budget'],
  ['g p', 'Go to Plan'],
  ['g w', 'Go to Wealth'],
  ['g s', 'Go to Settings'],
  ['n', 'New transaction'],
  ['i', 'Import a file'],
  ['r', 'Review inbox'],
  ['/', 'Search transactions'],
  ['l', 'Lock now'],
  ['?', 'Show or hide this list'],
];

const GO: Record<string, Tab> = { h: 'home', t: 'transactions', b: 'budget', p: 'plan', w: 'wealth', s: 'settings' };

export function useShortcuts(active: boolean, a: { go: (t: Tab, sub?: string) => void; lock: () => void; help: () => void }) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable) return;
      if (pending.current === 'g' && GO[e.key]) {
        a.go(GO[e.key]);
        pending.current = null;
        return;
      }
      pending.current = e.key === 'g' ? 'g' : null;
      if (e.key === 'n') a.go('transactions', 'new');
      else if (e.key === 'i') a.go('transactions', 'import');
      else if (e.key === 'r') a.go('transactions', 'inbox');
      else if (e.key === 'l') a.lock();
      else if (e.key === '?') a.help();
      else if (e.key === '/') {
        e.preventDefault();
        a.go('transactions');
        setTimeout(() => document.getElementById('txn-search')?.focus(), 50);
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, a]);
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className="panel narrow" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([k, d]) => (
              <tr key={k}>
                <td>{k.split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
