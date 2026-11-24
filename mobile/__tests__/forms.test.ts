import { isDateKey, newIdempotencyKey } from '../src/util/forms';
import { buildSlipHtml } from '../src/slip/html';

describe('form helpers', () => {
  it('accepts only real calendar dates', () => {
    expect(isDateKey('2026-12-01')).toBe(true);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('01-12-2026')).toBe(false);
    expect(isDateKey('')).toBe(false);
  });

  it('creates UUID-style idempotency keys', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});

describe('salary slip HTML', () => {
  it('escapes names and formats money', () => {
    const html = buildSlipHtml(
      {
        company: { name: 'Acme <b>' },
        employee: { name: 'A & B', code: null, designation: null },
        provisional: false,
        period: { start: '2026-10-26', end: '2026-11-25' },
        status: 'finalized',
        breakdown: { basicSalary: 24000, netPayable: '22650.50' },
      },
      'INR',
      'Slip'
    );
    expect(html).toContain('Acme &lt;b&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('<b>');
    expect(html).toContain('₹22,650.50');
  });
});
