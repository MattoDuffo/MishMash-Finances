import type { Category, CategoryGroup } from './types';
import { newId } from './types';

const DEFAULTS: [CategoryGroup, string[]][] = [
  ['income', ['Salary', 'Other income']],
  ['bills', ['Rent / mortgage', 'Utilities', 'Phone & internet', 'Insurance', 'Subscriptions']],
  ['everyday', ['Groceries', 'Transport', 'Fuel', 'Health', 'Household']],
  ['lifestyle', ['Eating out', 'Entertainment', 'Shopping', 'Travel', 'Gifts']],
  ['savings', ['Emergency fund', 'Investments']],
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
