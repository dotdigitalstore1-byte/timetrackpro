import {
  formatCycleKey,
  formatDateKey,
  formatDays,
  formatMoney,
  formatShiftClock,
  greetingFor,
  groupIndian,
  humanize,
  shiftMonthKey,
} from '../src/format';

describe('money and numbers', () => {
  it('groups amounts the Indian way with two decimals', () => {
    expect(formatMoney(1234567, 'INR')).toBe('₹12,34,567.00');
    expect(formatMoney(0, 'INR')).toBe('₹0.00');
    expect(formatMoney(-500.5, 'INR')).toBe('-₹500.50');
    expect(formatMoney(18450, 'USD')).toBe('$18,450.00');
  });

  it('groups plain integers the Indian way', () => {
    expect(groupIndian(999)).toBe('999');
    expect(groupIndian(100000)).toBe('1,00,000');
  });

  it('drops the decimal for whole day counts only', () => {
    expect(formatDays(2)).toBe('2');
    expect(formatDays(2.5)).toBe('2.5');
  });
});

describe('dates and cycles', () => {
  it('moves salary-cycle keys by whole months across years', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-11', -3)).toBe('2026-08');
  });

  it('formats calendar keys without time-zone shifts', () => {
    expect(formatDateKey('2026-11-23')).toBe('23 Nov 2026');
    expect(formatDateKey(null)).toBe('—');
    expect(formatCycleKey('2026-11')).toBe('Nov 2026');
  });

  it('formats shift clocks', () => {
    expect(formatShiftClock('09:30')).toBe('9:30 AM');
    expect(formatShiftClock('18:00')).toBe('6:00 PM');
    expect(formatShiftClock('00:15')).toBe('12:15 AM');
    expect(formatShiftClock(null)).toBe('—');
  });
});

describe('text', () => {
  it('turns status words into sentences', () => {
    expect(humanize('half_day')).toBe('Half day');
    expect(humanize('on_leave')).toBe('On leave');
  });

  it('picks the greeting for the hour', () => {
    expect(greetingFor(9)).toBe('Good morning');
    expect(greetingFor(13)).toBe('Good afternoon');
    expect(greetingFor(20)).toBe('Good evening');
  });
});
