import { describe, it, expect } from 'vitest';
import { parseAmount, formatMoney } from './money';

describe('parseAmount', () => {
  it.each([
    ['12.34', 1234],
    ['-12.34', -1234],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ['1,234', 123400],
    ['12,5', 1250],
    ['(45.00)', -4500],
    ['45.00-', -4500],
    ['$10', 1000],
    ['+3', 300],
    ['1,234,567', 123456700],
    ['0.005', 1],
    ['.5', 50],
  ])('%s -> %d', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '1-2', '--'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });

  it('respects zero-decimal currencies', () => {
    expect(parseAmount('1,500', 'JPY')).toBe(1500);
  });
});

describe('formatMoney', () => {
  it('formats minor units', () => {
    expect(formatMoney(-123456, 'USD', 'en-US')).toBe('-$1,234.56');
  });
});
