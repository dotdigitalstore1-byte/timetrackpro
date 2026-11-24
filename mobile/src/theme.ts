// Colours from the web app's Tailwind classes (indigo, violet, slate), so the app looks like the website.
export const colors = {
  white: '#FFFFFF',
  indigo50: '#EEF2FF',
  indigo100: '#E0E7FF',
  indigo200: '#C7D2FE',
  indigo600: '#4F46E5',
  indigo700: '#4338CA',
  indigo800: '#3730A3',
  violet200: '#DDD6FE',
  violet600: '#7C3AED',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate900: '#0F172A',
  rose50: '#FFF1F2',
  rose700: '#BE123C',
  rose600: '#E11D48',
  green700: '#15803D',
  amber700: '#B45309',
  red700: '#B91C1C',
  blue700: '#1D4ED8',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** Text colour for a status word from the server (present, late, half_day, approved, ...). */
export function statusColor(status: string): string {
  switch (status) {
    case 'present':
    case 'approved':
    case 'finalized':
    case 'paid':
    case 'active':
    case 'completed':
      return colors.green700;
    case 'late':
    case 'half_day':
    case 'pending':
    case 'requested':
    case 'draft':
      return colors.amber700;
    case 'absent':
    case 'rejected':
    case 'withdrawn':
      return colors.red700;
    case 'on_leave':
    case 'leave':
      return colors.blue700;
    default:
      return colors.slate500;
  }
}
