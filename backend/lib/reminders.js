const { pool, getSetting } = require('./core');
const { reminderTime } = require('./time');
const { notify } = require('./notify');

const fmt12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Creates or recalculates the reminder for a CONFIRMED future booking (call after create / approve / reschedule).
 * - normal booking: remind_at = start - 24h
 * - booking created less than 24h before start: short-notice reminder, due immediately
 * - if start time changed the reminder is reset to PENDING so the new time is reminded exactly once
 */
async function upsertReminder(c, booking, leadHours) {
  if (!booking || booking.status !== 'CONFIRMED' || !booking.owner_id) return null;
  const lead = leadHours || Number(await getSetting('reminder_lead_hours', 24, c)) || 24; // callers creating many occurrences pass it in
  const startsAt = String(booking.starts_at).slice(0, 19);
  let remindAt = reminderTime(startsAt, lead);
  let shortNotice = false;
  if (remindAt.getTime() <= Date.now()) { remindAt = new Date(); shortNotice = true; }
  const r = await c.query(
    `INSERT INTO booking_reminders(booking_id,user_id,remind_at,for_starts_at,short_notice,status) VALUES($1,$2,$3,$4,$5,'PENDING')
     ON CONFLICT (booking_id) DO UPDATE SET user_id=EXCLUDED.user_id, remind_at=EXCLUDED.remind_at, short_notice=EXCLUDED.short_notice,
       status = CASE WHEN booking_reminders.for_starts_at IS DISTINCT FROM EXCLUDED.for_starts_at OR booking_reminders.status IN ('CANCELLED','SKIPPED') THEN 'PENDING' ELSE booking_reminders.status END,
       sent_at = CASE WHEN booking_reminders.for_starts_at IS DISTINCT FROM EXCLUDED.for_starts_at OR booking_reminders.status IN ('CANCELLED','SKIPPED') THEN NULL ELSE booking_reminders.sent_at END,
       for_starts_at = EXCLUDED.for_starts_at, updated_at = now()
     RETURNING *`, [booking.id, booking.owner_id, remindAt, startsAt, shortNotice]);
  return r.rows[0];
}

/** Prevents a pending reminder from being sent (booking cancelled / rejected / expired). */
const cancelReminder = (c, bookingId) => c.query("UPDATE booking_reminders SET status='CANCELLED', updated_at=now() WHERE booking_id=$1 AND status='PENDING'", [bookingId]);

/** Delivers every due reminder exactly once. Safe to run concurrently (FOR UPDATE SKIP LOCKED) and after restarts. */
async function processDueReminders(limit = 100) {
  const c = await pool.connect();
  c._after = [];
  let sent = 0;
  try {
    await c.query('BEGIN');
    const due = await c.query(
      `SELECT r.id AS reminder_id, r.short_notice, r.for_starts_at, b.id AS booking_id, b.status, b.owner_id, b.purpose, b.starts_at, b.ends_at,
              v.name AS venue_name, v.building, to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS st, to_char(b.ends_at,'HH24:MI') AS et,
              (b.starts_at <= LOCALTIMESTAMP) AS started
       FROM booking_reminders r JOIN bookings b ON b.id=r.booking_id JOIN venues v ON v.id=b.venue_id
       WHERE r.status='PENDING' AND r.remind_at <= now() ORDER BY r.remind_at LIMIT $1 FOR UPDATE OF r SKIP LOCKED`, [limit]);
    for (const d of due.rows) {
      if (d.status !== 'CONFIRMED') { await c.query("UPDATE booking_reminders SET status='CANCELLED', updated_at=now() WHERE id=$1", [d.reminder_id]); continue; }
      if (d.started || String(d.starts_at) !== String(d.for_starts_at).replace('T', ' ').slice(0, 19)) {
        await c.query("UPDATE booking_reminders SET status='SKIPPED', updated_at=now(), last_error=$2 WHERE id=$1", [d.reminder_id, d.started ? 'booking already started' : 'start time changed']);
        continue;
      }
      const lines = [`Venue: ${d.venue_name}`, `Building: ${d.building || '-'}`, `Booking Date: ${fmtDate(d.date)}`, `Start Time: ${fmt12(d.st)}`, `End Time: ${fmt12(d.et)}`, `Booking Purpose: ${d.purpose}`].join('\n');
      const n = await notify(c, d.owner_id, {
        title: d.short_notice ? 'Your Venue Booking Is Coming Up Soon!' : 'Your Venue Booking Is Tomorrow!',
        message: `${d.short_notice ? 'Hello! This is a short-notice reminder that you have a confirmed venue booking starting soon.' : 'Hello! This is a reminder that you have a confirmed venue booking tomorrow.'}\n${lines}`,
        type: 'BOOKING_REMINDER', link: `/bookings/${d.booking_id}`, entityType: 'BOOKING', entityId: d.booking_id,
        dedupeKey: `reminder:${d.booking_id}:${String(d.starts_at).slice(0, 16)}` });
      await c.query("UPDATE booking_reminders SET status='SENT', sent_at=now(), notification_id=$2, updated_at=now(), last_error=NULL WHERE id=$1", [d.reminder_id, n?.id || null]);
      sent++;
    }
    await c.query('COMMIT');
    for (const cb of c._after || []) cb();
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[reminders] processing failed:', e.message);
  } finally { c._after = null; c.release(); }
  return sent;
}

/** Startup recovery: make sure every confirmed future booking has a reminder row (idempotent). */
async function backfillReminders() {
  const lead = Number(await getSetting('reminder_lead_hours', 24)) || 24;
  const r = await pool.query("SELECT id,owner_id,status,starts_at FROM bookings b WHERE status='CONFIRMED' AND owner_id IS NOT NULL AND starts_at > LOCALTIMESTAMP AND NOT EXISTS (SELECT 1 FROM booking_reminders r WHERE r.booking_id=b.id)");
  if (!r.rowCount) return 0;
  const c = await pool.connect(); // one connection for the whole batch instead of one per booking
  try {
    for (const b of r.rows) { try { await upsertReminder(c, b, lead); } catch (e) { console.error('[reminders] backfill failed:', e.message); } }
  } finally { c.release(); }
  return r.rowCount;
}

module.exports = { upsertReminder, cancelReminder, processDueReminders, backfillReminders, fmt12, fmtDate };
