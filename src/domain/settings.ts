import type { Session } from '../db/store';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  budgetMethod: 'zero-based',
  baseCurrency: 'USD',
  exchangeRates: {},
  split503020: { needs: 50, wants: 30, savings: 20 },
  retirement: {
    currentAge: 35,
    retireAge: 65,
    endAge: 95,
    monthlyContribution: 50000,
    annualSpending: 4000000,
    expectedReturn: 6,
    volatility: 15,
    inflation: 2.5,
    startingBalance: null,
  },
  dismissedRecurring: [],
};

export function getSettings(s: Session): Settings {
  const stored = s.get('settings', 'settings');
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    retirement: { ...DEFAULT_SETTINGS.retirement, ...stored?.retirement },
    split503020: { ...DEFAULT_SETTINGS.split503020, ...stored?.split503020 },
  };
}

export async function updateSettings(s: Session, patch: Partial<Settings>): Promise<void> {
  await s.put('settings', { ...getSettings(s), ...patch, id: 'settings' });
}
