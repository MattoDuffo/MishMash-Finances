import type { Category, CategoryGroup } from './types';
import { newId } from './types';

const DEFAULTS: [CategoryGroup, string[]][] = [
  ['income', ['Salary', 'Bonus', 'Other income']],
  ['bills', ['Rent / mortgage', 'Town council', 'Utilities', 'Phone & internet', 'Insurance', 'Subscriptions', 'Income tax']],
  ['everyday', ['Groceries', 'Hawker & food court', 'Public transport', 'Grab & taxi', 'Car', 'Health', 'Household']],
  ['lifestyle', ['Eating out', 'Entertainment', 'Shopping', 'Travel', 'Gifts & ang bao']],
  ['savings', ['Emergency fund', 'Investments', 'CPF & SRS top-ups']],
  ['transfer', ['Transfer']],
];

export function defaultCategories(): Category[] {
  return DEFAULTS.flatMap(([group, names]) => names.map((name) => ({ id: newId(), name, group, archived: false })));
}

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  income: 'Income',
  bills: 'Bills',
  everyday: 'Everyday',
  lifestyle: 'Lifestyle',
  savings: 'Savings',
  transfer: 'Transfers',
};
