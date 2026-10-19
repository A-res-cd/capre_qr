import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays } from 'date-fns';
import { HttpError } from './errors';
export function rangeFor(params: URLSearchParams, timezone: string) {
  const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const start = params.get('start') || formatInTimeZone(addDays(new Date(), -29), timezone, 'yyyy-MM-dd');
  const end = params.get('end') || today;
  for (const value of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Use valid YYYY-MM-DD dates.');
  }
  const from = fromZonedTime(`${start}T00:00:00`, timezone);
  const nextDay = new Date(`${end}T00:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const to = fromZonedTime(`${nextDay.toISOString().slice(0, 10)}T00:00:00`, timezone);
  if (from >= to || to.getTime() - from.getTime() > 366 * 5 * 86400000) throw new HttpError(400, 'Choose an ordered range up to five years.');
  const grain = params.get('grain') || 'day';
  if (!['day', 'week', 'month'].includes(grain)) throw new HttpError(400, 'Choose day, week, or month.');
  return { start, end, from, to, grain };
}
export function csvCell(value: string | number) {
  const text = String(value);
  return `"${(/^[=+\-@\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
}
