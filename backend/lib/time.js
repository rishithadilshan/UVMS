// Time helpers. The university time zone is Asia/Colombo (UTC+05:30, no DST).
const TZ = 'Asia/Colombo';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isDate = (s) => {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const isTime = (s) => TIME_RE.test(String(s || ''));
const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const fromMinutes = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** Current wall-clock time in Asia/Colombo: { date:'YYYY-MM-DD', time:'HH:MM', stamp:'YYYY-MM-DD HH:MM' }. */
function colomboNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { date, time, stamp: `${date} ${time}` };
}

/** Combines a date and HH:MM into the naive timestamp string stored in the database. */
const stamp = (date, hhmm) => `${date} ${hhmm}:00`;
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOfWeek = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/**
 * Validates a booking window. Returns an array of error strings (empty when valid).
 * Rules: valid date/time formats, end after start, same-day, and not in the past (Asia/Colombo).
 */
function validateWindow({ date, startTime, endTime }, { allowPast = false, now = colomboNow(), maxHours = 24 } = {}) {
  const errors = [];
  if (!isDate(date)) errors.push('A valid booking date (YYYY-MM-DD) is required');
  if (!isTime(startTime)) errors.push('A valid start time (HH:MM) is required');
  if (!isTime(endTime)) errors.push('A valid end time (HH:MM) is required');
  if (errors.length) return errors;
  if (toMinutes(endTime) <= toMinutes(startTime)) errors.push('End time must be later than start time');
  else if ((toMinutes(endTime) - toMinutes(startTime)) > maxHours * 60) errors.push(`A booking cannot be longer than ${maxHours} hours`);
  if (!allowPast && `${date} ${startTime}` <= now.stamp) errors.push('Bookings cannot be made in the past');
  return errors;
}

/** Overlap rule used everywhere: newStart < existingEnd AND newEnd > existingStart. */
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

/**
 * Expands a recurrence rule into concrete dates.
 * rule: { frequency:'WEEKLY'|'BIWEEKLY', startDate, endDate, daysOfWeek:[0..6] }
 */
function expandRecurrence(rule, { maxOccurrences = 60 } = {}) {
  const { frequency = 'WEEKLY', startDate, endDate, daysOfWeek } = rule || {};
  if (!['WEEKLY', 'BIWEEKLY'].includes(frequency)) throw Object.assign(new Error('frequency must be WEEKLY or BIWEEKLY'), { status: 400 });
  if (!isDate(startDate) || !isDate(endDate) || endDate < startDate) throw Object.assign(new Error('A valid recurrence start and end date are required'), { status: 400 });
  if (!Array.isArray(daysOfWeek) || !daysOfWeek.length || daysOfWeek.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw Object.assign(new Error('Select at least one day of the week'), { status: 400 });
  const days = new Set(daysOfWeek);
  const step = frequency === 'BIWEEKLY' ? 2 : 1;
  const dates = [];
  // week index is measured from the week that contains startDate (weeks start on Sunday)
  const startWeekAnchor = addDays(startDate, -dayOfWeek(startDate));
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    const weekIndex = Math.floor((new Date(`${d}T00:00:00Z`) - new Date(`${startWeekAnchor}T00:00:00Z`)) / (7 * 86400000));
    if (weekIndex % step === 0 && days.has(dayOfWeek(d))) {
      dates.push(d);
      if (dates.length > maxOccurrences) throw Object.assign(new Error(`A recurring booking cannot exceed ${maxOccurrences} occurrences`), { status: 400 });
    }
  }
  if (!dates.length) throw Object.assign(new Error('The recurrence rule produces no dates'), { status: 400 });
  return dates;
}

/** Subtracts busy intervals from [start,end) (minutes) and returns the free sub-intervals. */
function freeIntervals(start, end, busy) {
  const merged = busy.map(([s, e]) => [Math.max(s, start), Math.min(e, end)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const free = []; let cursor = start;
  for (const [s, e] of merged) { if (s > cursor) free.push([cursor, s]); cursor = Math.max(cursor, e); }
  if (cursor < end) free.push([cursor, end]);
  return free;
}

/** Reminder time = start (Asia/Colombo) minus the lead hours, expressed as a UTC Date. */
function reminderTime(startsAtLocal, leadHours = 24) {
  const [d, t] = startsAtLocal.split(/[ T]/);
  const utc = new Date(`${d}T${t.slice(0, 8)}+05:30`); // Colombo is a fixed UTC+05:30 offset
  return new Date(utc.getTime() - leadHours * 3600 * 1000);
}

module.exports = { TZ, isDate, isTime, toMinutes, fromMinutes, colomboNow, stamp, addDays, dayOfWeek, validateWindow, overlaps, expandRecurrence, freeIntervals, reminderTime };
