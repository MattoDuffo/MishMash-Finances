import { useSession } from './session';
import { GROUP_LABELS } from '../domain/defaults';
import type { CategoryGroup } from '../domain/types';

export function CategorySelect({ id, value, onChange, allowNone = true, label }: { id: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; label?: string }) {
  const s = useSession();
  const cats = s.list('categories').filter((c) => !c.archived || c.id === value);
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
      {allowNone && <option value="">Uncategorized</option>}
      {(Object.keys(GROUP_LABELS) as CategoryGroup[]).map((g) => (
        <optgroup key={g} label={GROUP_LABELS[g]}>
          {cats
            .filter((c) => c.group === g)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
