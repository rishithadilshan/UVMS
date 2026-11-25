const { pool } = require('./core');
const { loadVenue, checkVenue } = require('./availability');
const { notify } = require('./notify');
const { fmt12, fmtDate } = require('./reminders');

/**
 * Notifies WAITING users whose requested venue/time is now free. Never creates a booking: the user must submit
 * a normal booking request. Optionally limited to one venue (called after cancellations, maintenance restore...).
 */
async function processWaitlist(venueId = null) {
  const c = await pool.connect();
  let notified = 0;
  try {
    await c.query("UPDATE waitlist_entries SET status='EXPIRED' WHERE status='WAITING' AND requested_starts_at <= LOCALTIMESTAMP");
    const r = await c.query(
      `SELECT w.*, to_char(w.requested_starts_at,'YYYY-MM-DD') AS date, to_char(w.requested_starts_at,'HH24:MI') AS st, to_char(w.requested_ends_at,'HH24:MI') AS et, v.name AS venue_name
       FROM waitlist_entries w JOIN venues v ON v.id=w.venue_id WHERE w.status='WAITING' ${venueId ? 'AND w.venue_id=$1' : ''} ORDER BY w.created_at LIMIT 200`, venueId ? [venueId] : []);
    const venues = new Map(); // one venue lookup per venue instead of one per waitlist entry
    for (const w of r.rows) {
      if (!venues.has(w.venue_id)) venues.set(w.venue_id, await loadVenue(c, w.venue_id));
      const venue = venues.get(w.venue_id);
      const res = await checkVenue(c, venue, { startsAt: w.requested_starts_at, endsAt: w.requested_ends_at, participants: w.expected_participants, facilities: w.required_facilities });
      if (!res.ok) continue;
      const upd = await c.query("UPDATE waitlist_entries SET status='NOTIFIED', notified_at=now() WHERE id=$1 AND status='WAITING' RETURNING id", [w.id]);
      if (!upd.rowCount) continue;
      await notify(c, w.user_id, {
        title: 'A venue you were waiting for is now available',
        message: `${w.venue_name} is now free on ${fmtDate(w.date)} from ${fmt12(w.st)} to ${fmt12(w.et)}. This does not reserve the venue: please submit a booking request before someone else does.`,
        type: 'WAITLIST_AVAILABLE', link: `/find-venue?date=${w.date}&startTime=${w.st}&endTime=${w.et}&participants=${w.expected_participants}`,
        entityType: 'WAITLIST', entityId: w.id, dedupeKey: `waitlist:${w.id}` });
      notified++;
    }
  } catch (e) { console.error('[waitlist] processing failed:', e.message); } finally { c.release(); }
  return notified;
}

module.exports = { processWaitlist };
