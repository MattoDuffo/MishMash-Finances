import type { Session } from '../db/store';
import { newId, type Account, type Transaction } from '../domain/types';
import { addDays, addMonths, monthOf, toIso } from '../domain/dates';
import { getSettings, updateSettings } from '../domain/settings';

/** Adds four months of clearly labelled example data so every screen has something to show. */
export async function addExampleData(s: Session): Promise<void> {
  const now = new Date().toISOString();
  const today = toIso(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())));
  const acct = (name: string, kind: Account['kind'], openingBalance: number, extra: Partial<Account> = {}): Account => ({
    id: newId(), name, kind, currency: getSettings(s).baseCurrency, openingBalance, archived: false, createdAt: now, ...extra,
  });
  const checking = acct('Example checking', 'checking', 210000);
  const savings = acct('Example savings', 'savings', 1500000);
  const card = acct('Example credit card', 'credit', -45000, { apr: 22.9, minPayment: 3500 });
  const carLoan = acct('Example car loan', 'loan', -1240000, { apr: 6.4, minPayment: 32000 });
  const invest = acct('Example CPF & investments', 'investment', 0);
  const home = acct('Example HDB flat', 'property', 0);
  const mortgage = acct('Example HDB loan', 'liability', 0, { apr: 2.6, minPayment: 145000 });
  await s.putMany('accounts', [checking, savings, card, carLoan, invest, home, mortgage]);

  const cat = (name: string) => s.list('categories').find((c) => c.name === name)?.id ?? null;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const txns: Transaction[] = [];
  const add = (date: string, amount: number, payee: string, category: string | null, account: Account) => {
    if (date > today) return;
    txns.push({ id: newId(), accountId: account.id, date, amount, payee, categoryId: category ? cat(category) : null, notes: '', source: 'manual', importId: null, createdAt: now, reviewed: true, transferId: null });
  };

  const thisMonth = monthOf(today);
  for (let i = -4; i <= 0; i++) {
    const m = addMonths(thisMonth, i);
    add(`${m}-25`, 720000, 'Salary (example employer)', 'Salary', checking);
    add(`${m}-02`, -145000, 'HDB mortgage (example)', 'Rent / mortgage', checking);
    add(`${m}-03`, -7200, 'Town Council S&CC (example)', 'Town council', checking);
    add(`${m}-08`, -Math.round(9000 + rand() * 5000), 'Power & Water Co.', 'Utilities', checking);
    add(`${m}-12`, -4500, 'Mobile Plus Telco', 'Phone & internet', checking);
    add(`${m}-18`, -12400, 'Shield Insurance (example)', 'Insurance', checking);
    add(`${m}-05`, i < 0 ? -1598 : -1798, 'Streamflix', 'Subscriptions', card);
    add(`${m}-09`, -1099, 'Tunebox Music', 'Subscriptions', card);
    add(`${m}-14`, -8900, 'Peak Fitness', 'Subscriptions', card);
    add(`${m}-20`, -32000, 'Example car loan payment', 'Transfer', checking);
    add(`${m}-20`, 32000, 'Payment from checking', 'Transfer', carLoan);
    add(`${m}-26`, -100000, 'Transfer to savings', 'Transfer', checking);
    add(`${m}-26`, 100000, 'Transfer from checking', 'Transfer', savings);
    add(`${m}-27`, -90000, 'Card payment', 'Transfer', checking);
    add(`${m}-27`, 90000, 'Payment received', 'Transfer', card);
    for (let w = 0; w < 4; w++) {
      const d = `${m}-${String(3 + w * 7).padStart(2, '0')}`;
      add(d, -Math.round(6000 + rand() * 6000), w % 2 ? 'Neighbourhood Mart' : 'Fresh Grocer', 'Groceries', card);
      add(addDays(d, 1), -Math.round(450 + rand() * 600), ['Ah Seng Chicken Rice', 'Kopi Corner', 'Laksa Stall', 'Mixed Rice Stall'][w], 'Hawker & food court', card);
      add(addDays(d, 2), -Math.round(3500 + rand() * 6000), ['Noodle House', 'Pizza Palace', 'Dim Sum Garden', 'Sushi Bar'][w], 'Eating out', card);
      add(addDays(d, 1), -1200, 'MRT & bus fares', 'Public transport', card);
    }
    add(`${m}-16`, -Math.round(1500 + rand() * 2500), 'Ride-hailing (example)', 'Grab & taxi', card);
    if (i % 2 === 0) add(`${m}-22`, -Math.round(5000 + rand() * 9000), 'Orchard Shoes (example)', 'Shopping', card);
    if (i === -1) add(`${m}-11`, -68000, 'Example Airways', 'Travel', card);
  }
  await s.putMany('transactions', txns);

  const v = (account: Account, monthsAgo: number, value: number) => ({ id: newId(), accountId: account.id, date: `${addMonths(thisMonth, -monthsAgo)}-01`, value });
  await s.putMany('valuations', [
    v(invest, 4, 4250000), v(invest, 2, 4410000), v(invest, 0, 4580000),
    v(home, 4, 58000000), v(home, 0, 59000000),
    v(mortgage, 4, -28200000), v(mortgage, 0, -27750000),
  ]);
  await s.put('goals', { id: newId(), name: 'Emergency fund (example)', target: 1800000, targetDate: `${addMonths(thisMonth, 10)}-01`, accountId: savings.id, saved: 0, createdAt: now });
  const assigned: Record<string, number> = {};
  for (const [name, amt] of [['Rent / mortgage', 145000], ['Town council', 7200], ['Utilities', 13000], ['Phone & internet', 4500], ['Insurance', 12400], ['Subscriptions', 12000], ['Groceries', 40000], ['Hawker & food court', 3500], ['Public transport', 5000], ['Grab & taxi', 3000], ['Eating out', 25000], ['Shopping', 8000], ['Emergency fund', 100000], ['Investments', 200000], ['CPF & SRS top-ups', 50000], ['Health', 2000], ['Household', 3000]] as const) {
    const id = cat(name);
    if (id) assigned[id] = amt;
  }
  for (let i = -4; i <= 0; i++) await s.put('budgets', { id: addMonths(thisMonth, i), assigned });
  const travel = s.list('categories').find((c) => c.name === 'Travel');
  if (travel) await s.put('categories', { ...travel, target: { type: 'by-date', amount: 150000, date: `${addMonths(thisMonth, 7)}-15` } });
  await updateSettings(s, { retirement: { ...getSettings(s).retirement, currentAge: 38 } });
}
