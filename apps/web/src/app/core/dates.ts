export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface DateRange {
  from: string;
  to: string;
}

export function lastNDays(n: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - (n - 1) * 864e5);
  return { from: isoDay(from), to: isoDay(to) };
}

export const RANGE_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
];

export const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export const fmtHours = (h: number | null | undefined) => {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
