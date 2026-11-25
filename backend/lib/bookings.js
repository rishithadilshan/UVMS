const crypto = require('crypto');
const { pool, httpError, getSetting, auditTx } = require('./core');
const { loadVenue, checkVenue, assertOk } = require('./availability');
const { stamp, validateWindow, colomboNow } = require('./time');
const { notify, notifyAdmins } = require('./notify');
const { upsertReminder, cancelReminder, fmt12, fmtDate } = require('./reminders');
const { processWaitlist } = require('./waitlist');

const BOOKING_SELECT = `SELECT b.id, b.id AS _id, b.venue_id, v.name AS venue_name, v.building AS venue_building, v.type AS venue_type, v.capacity AS venue_capacity,
  to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS start_time, to_char(b.ends_at,'HH24:MI') AS end_time, b.starts_at, b.ends_at,
  b.expected_students AS participants, b.status, b.title, b.purpose, b.justification, b.required_facilities, b.category_id, bc.name AS category_name, bc.priority_level,
  b.owner_id, ou.name AS owner_name, ou.email AS owner_email, ou.role AS owner_role, b.series_id, b.expires_at, b.rejection_reason, b.cancel_reason, b.decided_at,
  b.created_at, b.updated_at, b.type, b.notes, (b.starts_at <= LOCALTIMESTAMP) AS started, (b.ends_at <= LOCALTIMESTAMP) AS ended,
  EXISTS(SELECT 1 FROM check_ins ci WHERE ci.booking_id=b.id) AS checked_in
  FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN booking_categories bc ON bc.id=b.category_id LEFT JOIN users ou ON ou.id=b.owner_id`;

/** camelCase API shape (full detail; callers only use it for the owner or an admin). */
const mapBooking = (r) => r && ({
  id: r.id, _id: r.id, status: r.status, date: r.date, startTime: r.start_time, endTime: r.end_time, participants: r.participants,
  purpose: r.purpose, title: r.title, justification: r.justification, requiredFacilities: r.required_facilities, notes: r.notes,
  venue: { id: r.venue_id, _id: r.venue_id, name: r.venue_name, building: r.venue_building, type: r.venue_type, capacity: r.venue_capacity },
  category: r.category_id ? { id: r.category_id, name: r.category_name, priorityLevel: r.priority_level } : null,
  owner: r.owner_id ? { id: r.owner_id, name: r.owner_name, email: r.owner_email, role: r.owner_role } : null,
  seriesId: r.series_id, expiresAt: r.expires_at, rejectionReason: r.rejection_reason, cancelReason: r.cancel_reason, decidedAt: r.decided_at,
  createdAt: r.created_at, updatedAt: r.updated_at, started: r.started, ended: r.ended, checkedIn: r.checked_in,
  startsAt: r.starts_at, endsAt: r.ends_at,
});

const when = (b) => `${b.venue_name || 'the venue'} on ${fmtDate(b.date)}, ${fmt12(b.start_time)} – ${fmt12(b.end_time)}`;

async function addHistory(c, bookingId, action, actorId, from, to, details = {}) {
  await c.query('INSERT INTO booking_history(booking_id,action,actor_id,from_status,to_status,details) VALUES($1,$2,$3,$4,$5,$6)', [bookingId, action, actorId || null, from || null, to || null, JSON.stringify(details)]);
}

async function getBooking(c, id, { lock = false } = {}) {
  if (lock) {
    const l = await c.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE', [id]);
    if (!l.rowCount) return null;
  }
  const r = await c.query(`${BOOKING_SELECT} WHERE b.id=$1`, [id]);
  return r.rows[0] || null;
}

async function insertBooking(c, d) {
  const r = await c.query(
    `INSERT INTO bookings(venue_id,booking_date,title,expected_students,type,series_id,status,created_by,owner_id,category_id,purpose,justification,required_facilities,expires_at,starts_at,ends_at,created_by_role)
     VALUES($1,$2::timestamp::date,$3,$4,'REGULAR',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [d.venueId, d.startsAt, String(d.purpose).slice(0, 240), d.participants, d.seriesId || null, d.status, d.createdBy, d.ownerId, d.categoryId, d.purpose, d.justification || '', d.facilities || [], d.expiresAt || null, d.startsAt, d.endsAt, d.createdByRole || null]);
  return r.rows[0].id;
}

/**
 * Creates one booking or a recurring set. Everything happens inside the caller's transaction:
 * the venue row is locked (serialising concurrent attempts on that venue), every occurrence is validated
 * independently, and the database exclusion constraint is the final guard.
 * Students -> PENDING (venue temporarily reserved, expires automatically); other roles -> CONFIRMED.
 */
async function createBookings(c, after, p) {
  const { actor, owner, venueId, dates, startTime, endTime, participants, categoryId, purpose, justification, facilities, recurrenceRule } = p;
  const venue = await loadVenue(c, venueId, { lock: true });
  if (!venue) throw httpError(404, 'Venue not found');
  const direct = owner.role !== 'STUDENT';
  const status = direct ? 'CONFIRMED' : 'PENDING';
  const expiryHours = Number(await getSetting('pending_expiry_hours', 24, c)) || 24;
  const expiresAt = direct ? null : new Date(Date.now() + expiryHours * 3600 * 1000);
  const seriesId = dates.length > 1 || recurrenceRule ? crypto.randomUUID() : null;
  if (seriesId) await c.query('INSERT INTO booking_series(id,owner_id,venue_id,rule) VALUES($1,$2,$3,$4)', [seriesId, owner.id, venueId, JSON.stringify({ ...(recurrenceRule || {}), startTime, endTime })]);

  const reminderLead = direct ? (Number(await getSetting('reminder_lead_hours', 24, c)) || 24) : null; // read once, not once per occurrence
  const created = [], conflicts = [];
  for (const date of dates) {
    const startsAt = stamp(date, startTime), endsAt = stamp(date, endTime);
    const res = await checkVenue(c, venue, { startsAt, endsAt, participants, facilities });
    if (!res.ok) { conflicts.push({ date, code: res.reasons[0].code, reasons: res.reasons.map((x) => x.message) }); continue; }
    await c.query('SAVEPOINT occurrence');
    let id;
    try {
      id = await insertBooking(c, { venueId, startsAt, endsAt, participants, categoryId, purpose, justification, facilities, ownerId: owner.id, createdBy: actor.id, status, expiresAt, seriesId, createdByRole: actor.role });
      await c.query('RELEASE SAVEPOINT occurrence');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT occurrence');
      if (e.code === '23P01') { conflicts.push({ date, code: 'BOOKED', reasons: ['The venue was booked by someone else at the same moment'] }); continue; }
      throw e;
    }
    await addHistory(c, id, 'CREATED', actor.id, null, status, { date, startTime, endTime, participants, onBehalfOf: actor.id !== owner.id ? owner.id : undefined });
    const row = await getBooking(c, id);
    if (direct) await upsertReminder(c, { ...row, id }, reminderLead);
    created.push(row);
  }
  if (!created.length) throw httpError(409, conflicts[0]?.reasons?.[0] || 'No occurrence could be booked', { conflicts });

  const first = created[0];
  const many = created.length > 1 ? ` (${created.length} occurrences from ${fmtDate(first.date)})` : '';
  const link = (direct ? '/bookings/' : '/bookings/') + first.id;
  if (direct) {
    await notify(c, owner.id, { title: 'Booking confirmed', message: `Your booking for ${when(first)} is confirmed${many}.`, type: 'BOOKING_CONFIRMED', link, entityType: 'BOOKING', entityId: first.id });
    await notifyAdmins(c, { title: `New ${owner.role.toLowerCase().replace('_', ' ')} booking`, message: `${owner.name} booked ${when(first)}${many}.`, type: 'ADMIN_NEW_BOOKING', link: '/admin/bookings', entityType: 'BOOKING', entityId: first.id });
  } else {
    await notify(c, owner.id, { title: 'Booking request submitted', message: `Your request for ${when(first)}${many} was sent to the administrator. The venue is reserved for you until it is reviewed (it expires after ${expiryHours} hours without a response).`, type: 'BOOKING_PENDING', link, entityType: 'BOOKING', entityId: first.id });
    await notifyAdmins(c, { title: 'New student booking request', message: `${owner.name} requested ${when(first)}${many}.`, type: 'ADMIN_STUDENT_REQUEST', link: '/admin/student-requests', entityType: 'BOOKING', entityId: first.id });
  }
  after(() => require('./reminders').processDueReminders(20));
  return { venue, created, conflicts, seriesId, status };
}

/** Admin decision on a PENDING student request. */
async function decideBooking(c, after, bookingId, actor, decision, reason = '') {
  const b = await getBooking(c, bookingId, { lock: true });
  if (!b) throw httpError(404, 'Booking not found');
  if (b.status !== 'PENDING') throw httpError(409, `Only pending requests can be decided (current status: ${b.status})`);
  if (decision === 'APPROVE') {
    if (b.expires_at && new Date(b.expires_at) <= new Date()) throw httpError(409, 'This request has expired');
    if (b.started) throw httpError(409, 'The requested time has already started');
    const venue = await loadVenue(c, b.venue_id, { lock: true });
    const res = await checkVenue(c, venue, { startsAt: b.starts_at, endsAt: b.ends_at, participants: b.participants, facilities: b.required_facilities, excludeIds: [b.id] });
    assertOk(res, 'The venue is no longer available for this request');
    await c.query("UPDATE bookings SET status='CONFIRMED', decided_by=$2, decided_at=now(), expires_at=NULL, rejection_reason='' WHERE id=$1", [b.id, actor.id]);
    await c.query("INSERT INTO booking_approvals(booking_id,decision,decided_by,reason) VALUES($1,'APPROVED',$2,$3)", [b.id, actor.id, reason]);
    await addHistory(c, b.id, 'APPROVED', actor.id, 'PENDING', 'CONFIRMED', { reason });
    await auditTx(c, actor.id, 'APPROVE', 'BOOKING', b.id, { reason, category: b.category_name, priority: b.priority_level });
    await upsertReminder(c, { ...b, status: 'CONFIRMED' });
    await notify(c, b.owner_id, { title: 'Booking approved', message: `Your booking request for ${when(b)} has been approved.${reason ? ` Note: ${reason}` : ''}`, type: 'BOOKING_APPROVED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
    after(() => require('./reminders').processDueReminders(20));
    return 'CONFIRMED';
  }
  if (!String(reason).trim()) throw httpError(400, 'A rejection reason is required');
  await c.query("UPDATE bookings SET status='REJECTED', decided_by=$2, decided_at=now(), expires_at=NULL, rejection_reason=$3 WHERE id=$1", [b.id, actor.id, reason]);
  await c.query("INSERT INTO booking_approvals(booking_id,decision,decided_by,reason) VALUES($1,'REJECTED',$2,$3)", [b.id, actor.id, reason]);
  await addHistory(c, b.id, 'REJECTED', actor.id, 'PENDING', 'REJECTED', { reason });
  await auditTx(c, actor.id, 'REJECT', 'BOOKING', b.id, { reason });
  await cancelReminder(c, b.id);
  await notify(c, b.owner_id, { title: 'Booking rejected', message: `Your booking request for ${when(b)} was rejected. Reason: ${reason}`, type: 'BOOKING_REJECTED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  after(() => processWaitlist(b.venue_id));
  return 'REJECTED';
}

/** Cancels a PENDING/CONFIRMED booking (history kept, reservation released, people notified). */
async function cancelBooking(c, after, bookingId, actor, reason, { silentOwner = false } = {}) {
  const b = await getBooking(c, bookingId, { lock: true });
  if (!b) throw httpError(404, 'Booking not found');
  if (!['PENDING', 'CONFIRMED'].includes(b.status)) throw httpError(409, `A ${b.status.toLowerCase()} booking cannot be cancelled`);
  if (b.started && actor.role !== 'ADMIN') throw httpError(409, 'A booking that has already started cannot be cancelled');
  await c.query("UPDATE bookings SET status='CANCELLED', cancel_reason=$2, cancelled_by=$3, cancelled_at=now(), expires_at=NULL WHERE id=$1", [b.id, reason, actor.id]);
  await addHistory(c, b.id, 'CANCELLED', actor.id, b.status, 'CANCELLED', { reason });
  await cancelReminder(c, b.id);
  if (actor.role === 'ADMIN') await auditTx(c, actor.id, 'CANCEL', 'BOOKING', b.id, { reason });
  if (silentOwner) { /* the caller notifies the owner itself */ }
  else if (b.owner_id && b.owner_id !== actor.id) await notify(c, b.owner_id, { title: 'Booking cancelled', message: `Your booking for ${when(b)} was cancelled by an administrator. Reason: ${reason}`, type: 'BOOKING_CANCELLED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  else await notify(c, b.owner_id, { title: 'Booking cancelled', message: `You cancelled your booking for ${when(b)}.`, type: 'BOOKING_CANCELLED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  if (actor.role !== 'ADMIN') await notifyAdmins(c, { title: 'Booking cancelled', message: `${actor.name} cancelled ${when(b)}. Reason: ${reason}`, type: 'ADMIN_BOOKING_CANCELLED', link: '/admin/bookings', entityType: 'BOOKING', entityId: b.id });
  after(() => processWaitlist(b.venue_id));
  return b;
}

/**
 * Applies a validated change (date / time / venue / participants / facilities / purpose) to a booking.
 * Used for owner modifications, approved modification requests, admin re-scheduling and maintenance rearrangements.
 */
async function changeBooking(c, after, bookingId, changes, actor, { reason = '', action = 'MODIFIED', notifyOwner = true } = {}) {
  const b = await getBooking(c, bookingId, { lock: true });
  if (!b) throw httpError(404, 'Booking not found');
  if (!['PENDING', 'CONFIRMED'].includes(b.status)) throw httpError(409, 'Only pending or confirmed bookings can be modified');
  const next = {
    venueId: changes.venueId || b.venue_id, date: changes.date || b.date, startTime: changes.startTime || b.start_time, endTime: changes.endTime || b.end_time,
    participants: changes.participants ?? b.participants, facilities: changes.facilities ?? b.required_facilities, purpose: changes.purpose ?? b.purpose,
  };
  const timeChanged = next.date !== b.date || next.startTime !== b.start_time || next.endTime !== b.end_time || next.venueId !== b.venue_id;
  if (timeChanged) {
    const errs = validateWindow(next, { maxHours: Number(await getSetting('max_booking_hours', 12, c)) || 12 });
    if (errs.length) throw httpError(400, errs[0], { errors: errs });
  }
  const venue = await loadVenue(c, next.venueId, { lock: true });
  if (!venue) throw httpError(404, 'Venue not found');
  const startsAt = stamp(next.date, next.startTime), endsAt = stamp(next.date, next.endTime);
  const res = await checkVenue(c, venue, { startsAt, endsAt, participants: next.participants, facilities: next.facilities, excludeIds: [b.id] });
  assertOk(res);
  const before = { venueId: b.venue_id, date: b.date, startTime: b.start_time, endTime: b.end_time, participants: b.participants, facilities: b.required_facilities, purpose: b.purpose };
  await c.query('UPDATE bookings SET venue_id=$2, booking_date=$3::timestamp::date, starts_at=$3, ends_at=$4, expected_students=$5, required_facilities=$6, purpose=$7, title=$8 WHERE id=$1',
    [b.id, next.venueId, startsAt, endsAt, next.participants, next.facilities, next.purpose, String(next.purpose).slice(0, 240)]);
  await addHistory(c, b.id, action, actor.id, b.status, b.status, { before, after: next, reason });
  const fresh = await getBooking(c, b.id);
  if (b.status === 'CONFIRMED') await upsertReminder(c, { ...fresh, id: b.id }); // recalculates the reminder when the start time changed
  const text = `${when(fresh)}`;
  if (notifyOwner && b.owner_id && b.owner_id !== actor.id) await notify(c, b.owner_id, { title: 'Booking updated', message: `Your booking was updated: now ${text}.${reason ? ` Reason: ${reason}` : ''}`, type: 'BOOKING_MODIFIED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  else if (b.owner_id === actor.id) await notify(c, b.owner_id, { title: 'Booking updated', message: `Your booking was updated: now ${text}.`, type: 'BOOKING_MODIFIED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
  if (actor.role !== 'ADMIN') await notifyAdmins(c, { title: 'Booking modified', message: `${actor.name} changed a booking: now ${text}.`, type: 'ADMIN_BOOKING_MODIFIED', link: '/admin/bookings', entityType: 'BOOKING', entityId: b.id });
  after(() => processWaitlist(b.venue_id));
  after(() => require('./reminders').processDueReminders(20));
  return { before, booking: fresh };
}

/** Expires pending student requests whose deadline passed (or whose start time passed). Idempotent. */
async function expirePending() {
  const c = await pool.connect();
  c._after = [];
  let count = 0;
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `WITH x AS (UPDATE bookings SET status='EXPIRED', expires_at=NULL WHERE status='PENDING' AND ((expires_at IS NOT NULL AND expires_at <= now()) OR starts_at <= LOCALTIMESTAMP) RETURNING *)
       SELECT x.id, x.venue_id, x.owner_id, v.name AS venue_name, to_char(x.starts_at,'YYYY-MM-DD') AS date, to_char(x.starts_at,'HH24:MI') AS start_time, to_char(x.ends_at,'HH24:MI') AS end_time
       FROM x JOIN venues v ON v.id=x.venue_id`);
    for (const b of r.rows) {
      await addHistory(c, b.id, 'EXPIRED', null, 'PENDING', 'EXPIRED', { reason: 'No administrator response before the deadline' });
      await c.query("INSERT INTO booking_approvals(booking_id,decision,reason) VALUES($1,'EXPIRED','Automatic expiry')", [b.id]);
      await notify(c, b.owner_id, { title: 'Booking request expired', message: `Your request for ${when(b)} was not reviewed in time and has expired. The venue reservation has been released.`, type: 'BOOKING_EXPIRED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
      await notifyAdmins(c, { title: 'Student request expired', message: `The pending request for ${when(b)} expired without a decision.`, type: 'ADMIN_BOOKING_EXPIRED', link: '/admin/student-requests', entityType: 'BOOKING', entityId: b.id });
      count++;
    }
    await c.query('COMMIT');
    for (const cb of c._after) cb();
    for (const venueId of new Set(r.rows.map((x) => x.venue_id))) processWaitlist(venueId);
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[expiry] failed:', e.message); } finally { c._after = null; c.release(); }
  return count;
}

module.exports = { BOOKING_SELECT, mapBooking, when, addHistory, getBooking, insertBooking, createBookings, decideBooking, cancelBooking, changeBooking, expirePending, colomboNow };
