import type { SlipDetail } from '../api/types';
import { formatDateKey, formatDays, formatMoney, humanize, num } from '../format';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

const DAY_KEY = /day|count/i;

/** The salary slip as a plain HTML page, which expo-print turns into a PDF on the device. */
export function buildSlipHtml(slip: SlipDetail, currency: string, title: string): string {
  const company = typeof slip.company?.name === 'string' ? slip.company.name : 'Dotinout';
  const rows = Object.entries(slip.breakdown)
    .filter(([, v]) => v !== null && v !== '' && Number.isFinite(num(v)))
    .map(([k, v]) => {
      const label = humanize(k.replace(/([A-Z])/g, ' $1').toLowerCase());
      const value = DAY_KEY.test(k) ? formatDays(num(v)) : formatMoney(num(v), currency);
      return `<tr><td>${escapeHtml(label)}</td><td style="text-align:right">${escapeHtml(value)}</td></tr>`;
    })
    .join('');
  const status = slip.provisional ? 'Provisional (cycle still running)' : humanize(slip.status);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, Roboto, Arial, sans-serif; color: #0F172A; padding: 24px; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #64748B; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 4px; border-bottom: 1px solid #E2E8F0; font-size: 14px; }
  </style></head><body>
    <h1>${escapeHtml(company)}</h1>
    <div class="muted">${escapeHtml(title)}</div>
    <p><strong>${escapeHtml(slip.employee.name)}</strong>${slip.employee.designation ? ` · ${escapeHtml(slip.employee.designation)}` : ''}${slip.employee.code ? ` · ID ${escapeHtml(slip.employee.code)}` : ''}</p>
    <p class="muted">Period ${escapeHtml(formatDateKey(slip.period.start))} – ${escapeHtml(formatDateKey(slip.period.end))} · Pay date ${escapeHtml(formatDateKey(slip.disbursementDate ?? slip.salaryDate ?? null))} · ${escapeHtml(status)}</p>
    <table>${rows}</table>
  </body></html>`;
}
