const express = require('express');
const { body } = require('express-validator');
const { q, tx, asyncRoute, httpError, validate, idParam, auditTx, paging, getSetting, BOOKING_ROLES } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { validateWindow, stamp, overlaps } = require('../lib/time');
const { loadVenue, checkVenue, assertOk, cleanFacilities } = require('../lib/availability');
const { getBooking, createBookings, changeBooking, addHistory, when } = require('../lib/bookings');
const { notify, notifyAdmins } = require('../lib/notify');
const { rank } = require('../lib/recommend');
const { fmt12, fmtDate } = require('../lib/reminders');

const router = express.Router();
router.use(auth);
const isAdmin = (u) => u.role === 'ADMIN';

const LIST_SQL = `SELECT r.id, r.status, r.reason, r.message, r.decision_message AS "decisionMessage", r.created_at AS "createdAt", r.decided_at AS "decidedAt", r.handled_by_admin AS "handledByAdmin",
  r.target_booking_id AS "targetBookingId", r.requester_id AS "requesterId", r.owner_id AS "ownerId", r.participants, r.purpose, r.required_facilities AS "requiredFacilities",
  to_char(r.requested_starts_at,'YYYY-MM-DD') AS date, to_char(r.requested_starts_at,'HH24:MI') AS "startTime", to_char(r.requested_ends_at,'HH24:MI') AS "endTime",
  v.id AS "venueId", v.name AS "venueName", v.building AS "venueBuilding", ru.name AS "requesterName", ru.email AS "requesterEmail", ru.role AS "requesterRole", ou.name AS "ownerName", ou.email AS "ownerEmail", ou.role AS "ownerRole",
  rc.name AS "requestedCategory", rc.priority_level AS "requestedPriority", tc.name AS "currentCategory", tc.priority_level AS "currentPriority",
  to_char(tb.starts_at,'YYYY-MM-DD') AS "currentDate", to_char(tb.starts_at,'HH24:MI') AS "currentStart", to_char(tb.ends_at,'HH24:MI') AS "currentEnd", tb.status AS "currentStatus",
  r.admin_ruling AS "adminRuling", r.admin_note AS "adminNote", r.admin_ruled_at AS "adminRuledAt", r.resulting_booking_id AS "resultingBookingId",
  av.name AS "alternativeVenueName", to_char(r.alternative_starts_at,'YYYY-MM-DD') AS "alternativeDate", to_char(r.alternative_starts_at,'HH24:MI') AS "alternativeStart", to_char(r.alternative_ends_at,'HH24:MI') AS "alternativeEnd"
  FROM venue_change_requests r JOIN venues v ON v.id=r.venue_id JOIN users ru ON ru.id=r.requester_id LEFT JOIN users ou ON ou.id=r.owner_id
  JOIN bookings tb ON tb.id=r.target_booking_id LEFT JOIN booking_categories rc ON rc.id=r.category_id LEFT JOIN booking_categories tc ON tc.id=tb.category_id LEFT JOIN venues av ON av.id=r.alternative_venue_id`;

/** Hide owner contact/private data from the requester and requester data not needed by others. */
function shape(row, user) {
  const out = { ...row };
  const isRequester = row.requesterId === user.id;
  if (isRequester) { delete out.ownerEmail; delete out.currentCategory; delete out.currentPriority; delete out.currentDate; delete out.currentStart; delete out.currentEnd; }
  if (!isRequester && !isAdmin(user)) {} // owners see their own booking details
  out.canRespond = row.status === 'PENDING' && ((row.ownerId === user.id && !row.handledByAdmin) || (isAdmin(user) && row.handledByAdmin));
  out.canCancel = row.status === 'PENDING' && isRequester;
  return out;
}

router.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query);
  const vals = [], cond = [];
  const box = req.query.box || 'incoming';
  if (box === 'all') { if (!isAdmin(req.user)) return res.status(403).json({ message: 'Insufficient permissions' }); }
  else if (box === 'outgoing') { vals.push(req.user.id); cond.push(`r.requester_id=$${vals.length}`); }
  else if (isAdmin(req.user)) cond.push('r.handled_by_admin');
  else { vals.push(req.user.id); cond.push(`r.owner_id=$${vals.length} AND NOT r.handled_by_admin`); }
  if (req.query.status) { vals.push(String(req.query.status).toUpperCase()); cond.push(`r.status=$${vals.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (await q(`SELECT count(*)::int AS n FROM venue_change_requests r ${where}`, vals)).rows[0].n;
  const r = await q(`${LIST_SQL} ${where} ORDER BY (r.status='PENDING') DESC, r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows.map((x) => shape(x, req.user)), total, page, pageSize });
}));

// ---------- submit ----------
router.post('/', roles(...BOOKING_ROLES), validate(
  body('targetBookingId').isUUID(), body('participants').isInt({ min: 1, max: 10000 }), body('categoryId').isUUID(),
  body('purpose').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Booking purpose is required'),
  body('reason').isString().trim().isLength({ min: 3, max: 2000 }).withMessage('Please explain why you need this venue'),
), asyncRoute(async (req, res) => {
  const { targetBookingId, date, startTime, endTime, categoryId, purpose } = req.body;
  const participants = Number(req.body.participants), facilities = cleanFacilities(req.body.facilities);
  const message = String(req.body.message || '').trim().slice(0, 2000);
  const errs = validateWindow({ date, startTime, endTime }, { maxHours: Number(await getSetting('max_booking_hours', 12)) || 12 });
  if (errs.length) return res.status(400).json({ message: errs[0], errors: errs });
  if (req.user.role === 'STUDENT' && String(req.body.justification || '').trim().length < 10 && !req.body.reason) throw httpError(400, 'Justification required');
  const out = await tx(async (c, after) => {
    const t = await getBooking(c, targetBookingId, { lock: true });
    if (!t || !['PENDING', 'CONFIRMED'].includes(t.status) || t.ended) throw httpError(404, 'That booking is not available for a change request');
    if (t.owner_id === req.user.id) throw httpError(400, 'This is your own booking');
    if (!overlaps(stamp(date, startTime), stamp(date, endTime), t.starts_at, t.ends_at)) throw httpError(400, 'The requested time does not overlap the selected booking');
    const cat = (await c.query('SELECT id FROM booking_categories WHERE id=$1 AND active', [categoryId])).rows[0];
    if (!cat) throw httpError(400, 'Selected booking category is not available');
    const venue = await loadVenue(c, t.venue_id);
    // everything except the selected booking must already allow the requested slot (capacity, facilities, maintenance, other bookings)
    assertOk(await checkVenue(c, venue, { startsAt: stamp(date, startTime), endsAt: stamp(date, endTime), participants, facilities, excludeIds: [t.id] }));
    const dup = await c.query("SELECT 1 FROM venue_change_requests WHERE requester_id=$1 AND target_booking_id=$2 AND status='PENDING'", [req.user.id, t.id]);
    if (dup.rowCount) throw httpError(409, 'You already have a pending change request for this booking');
    const byAdmin = !t.owner_id || t.owner_role === 'STUDENT';
    const ins = (await c.query(`INSERT INTO venue_change_requests(requester_id,target_booking_id,owner_id,handled_by_admin,venue_id,requested_starts_at,requested_ends_at,participants,category_id,purpose,required_facilities,reason,message)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [req.user.id, t.id, t.owner_id, byAdmin, t.venue_id, stamp(date, startTime), stamp(date, endTime), participants, categoryId, purpose, facilities, req.body.reason.trim(), message])).rows[0];
    await addHistory(c, t.id, 'CHANGE_REQUESTED', req.user.id, t.status, t.status, { requestId: ins.id });
    const slot = `${t.venue_name} on ${fmtDate(date)}, ${fmt12(startTime)} – ${fmt12(endTime)}`;
    if (!byAdmin) await notify(c, t.owner_id, { title: 'Venue change request', message: `${req.user.name} asks you to move your booking so they can use ${slot}. Reason: ${req.body.reason.trim()}`, type: 'VENUE_CHANGE_REQUEST', link: '/venue-changes', entityType: 'VENUE_CHANGE', entityId: ins.id });
    await notifyAdmins(c, { title: byAdmin ? 'Venue change request needs a decision' : 'New venue change request', message: `${req.user.name} requested ${slot}${byAdmin ? ' (the current booking belongs to a student, so an administrator decides)' : ''}.`, type: 'ADMIN_VENUE_CHANGE', link: byAdmin ? '/admin/venue-changes?box=incoming' : '/admin/venue-changes', entityType: 'VENUE_CHANGE', entityId: ins.id });
    await notify(c, req.user.id, { title: 'Venue change request sent', message: `Your request for ${slot} was sent to the current booking owner.`, type: 'VENUE_CHANGE_SENT', link: '/venue-changes?box=outgoing', entityType: 'VENUE_CHANGE', entityId: ins.id });
    return ins.id;
  });
  res.status(201).json({ id: out, message: 'Venue change request submitted' });
}));

// ---------- helpers for the handler ----------
async function loadHandled(c, id, user, { lock = false } = {}) {
  const r = (await c.query(`SELECT * FROM venue_change_requests WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!r) throw httpError(404, 'Request not found');
  const allowed = (r.owner_id === user.id && !r.handled_by_admin) || (isAdmin(user) && r.handled_by_admin);
  if (!allowed) throw httpError(403, 'You cannot act on this request');
  return r;
}

/** Validates the proposed alternative for the ORIGINAL booking (capacity, facilities, availability, no clash with the new request). */
async function validateAlternative(c, r, target, alt) {
  const reasons = [];
  if (!alt || !alt.venueId || !alt.date || !alt.startTime || !alt.endTime) return { ok: false, reasons: [{ code: 'INPUT', message: 'Choose an alternative venue, date and times' }] };
  const errs = validateWindow(alt, { maxHours: 24 });
  if (errs.length) return { ok: false, reasons: errs.map((m) => ({ code: 'WINDOW', message: m })) };
  const venue = await loadVenue(c, alt.venueId);
  if (!venue) return { ok: false, reasons: [{ code: 'VENUE', message: 'Alternative venue not found' }] };
  const startsAt = stamp(alt.date, alt.startTime), endsAt = stamp(alt.date, alt.endTime);
  if (alt.venueId === target.venue_id && startsAt === String(target.starts_at).slice(0, 19) && endsAt === String(target.ends_at).slice(0, 19)) reasons.push({ code: 'SAME', message: 'The alternative must be different from the current booking' });
  if (alt.venueId === r.venue_id && overlaps(startsAt, endsAt, r.requested_starts_at, r.requested_ends_at)) reasons.push({ code: 'CLASH_REQUEST', message: 'The alternative overlaps the time that was requested by the other user' });
  const res = await checkVenue(c, venue, { startsAt, endsAt, participants: target.participants, facilities: target.required_facilities, excludeIds: [target.id] });
  reasons.push(...res.reasons);
  return { ok: reasons.length === 0, reasons, venue };
}

router.get('/:id/alternatives', idParam, asyncRoute(async (req, res) => {
  const c = { query: q };
  const r = await loadHandled(c, req.params.id, req.user);
  const t = await getBooking(c, r.target_booking_id);
  const date = req.query.date || t.date, startTime = req.query.startTime || t.start_time, endTime = req.query.endTime || t.end_time;
  const errs = validateWindow({ date, startTime, endTime });
  if (errs.length) return res.status(400).json({ message: errs[0] });
  const startsAt = stamp(date, startTime), endsAt = stamp(date, endTime);
  const venues = (await q("SELECT v.* FROM venues v WHERE v.active AND v.status='AVAILABLE' AND v.capacity >= $1 AND v.id <> $2 ORDER BY v.name", [t.participants, t.venue_id])).rows;
  const ok = [];
  for (const v of venues) {
    const v2 = await validateAlternative(c, r, t, { venueId: v.id, date, startTime, endTime });
    if (v2.ok) ok.push(v);
  }
  const ranked = rank(ok, { participants: t.participants, facilities: t.required_facilities }).slice(0, 10);
  res.json({ window: { date, startTime, endTime }, alternatives: ranked.map((x) => ({ id: x.venue.id, name: x.venue.name, building: x.venue.building, type: x.venue.type, capacity: x.venue.capacity, facilities: x.venue.facilities, explanation: x.explanation, score: x.score })) });
}));

router.post('/:id/validate', idParam, asyncRoute(async (req, res) => {
  const c = { query: q };
  const r = await loadHandled(c, req.params.id, req.user);
  const t = await getBooking(c, r.target_booking_id);
  const v = await validateAlternative(c, r, t, req.body.alternative || req.body);
  res.json({ ok: v.ok, reasons: v.reasons });
}));

// ---------- decision ----------
router.post('/:id/respond', idParam, validate(body('decision').isIn(['ACCEPT', 'REJECT'])), asyncRoute(async (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 2000);
  const out = await tx(async (c, after) => {
    const r = await loadHandled(c, req.params.id, req.user, { lock: true });
    if (r.status !== 'PENDING') throw httpError(409, `This request is already ${r.status.toLowerCase()}`);
    const requester = (await c.query('SELECT id,name,email,role FROM users WHERE id=$1', [r.requester_id])).rows[0];
    const slot = (await c.query("SELECT v.name, to_char($2::timestamp,'YYYY-MM-DD') AS d, to_char($2::timestamp,'HH24:MI') AS s, to_char($3::timestamp,'HH24:MI') AS e FROM venues v WHERE v.id=$1", [r.venue_id, r.requested_starts_at, r.requested_ends_at])).rows[0];
    const slotText = `${slot.name} on ${fmtDate(slot.d)}, ${fmt12(slot.s)} – ${fmt12(slot.e)}`;

    if (req.body.decision === 'REJECT') {
      await c.query("UPDATE venue_change_requests SET status='REJECTED', decided_by=$2, decision_message=$3, decided_at=now(), updated_at=now() WHERE id=$1", [r.id, req.user.id, message]);
      await notify(c, r.requester_id, { title: 'Venue change request rejected', message: `Your request for ${slotText} was rejected.${message ? ` Message: ${message}` : ''}`, type: 'VENUE_CHANGE_REJECTED', link: '/venue-changes?box=outgoing', entityType: 'VENUE_CHANGE', entityId: r.id });
      await notifyAdmins(c, { title: 'Venue change request rejected', message: `${req.user.name} rejected the request for ${slotText}.`, type: 'ADMIN_VENUE_CHANGE', link: '/admin/venue-changes', entityType: 'VENUE_CHANGE', entityId: r.id });
      await auditTx(c, req.user.id, 'VENUE_CHANGE_REJECT', 'VENUE_CHANGE', r.id, { message });
      return { status: 'REJECTED' };
    }

    // ACCEPT: relocate the ORIGINAL booking to a validated alternative, then give the freed slot to the requester. All-or-nothing.
    const alt = req.body.alternative || {};
    const ids = [...new Set([r.venue_id, alt.venueId].filter(Boolean))].sort();
    for (const vid of ids) await c.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE', [vid]); // deterministic lock order prevents deadlocks
    const t = await getBooking(c, r.target_booking_id, { lock: true });
    if (!t || !['PENDING', 'CONFIRMED'].includes(t.status) || t.started) throw httpError(409, 'The original booking is no longer active, so the request cannot be completed');
    const v = await validateAlternative(c, r, t, alt);
    if (!v.ok) throw httpError(409, v.reasons[0].message, { reasons: v.reasons });
    // the requested slot must be free once the original booking has moved away
    const requestedVenue = await loadVenue(c, r.venue_id);
    assertOk(await checkVenue(c, requestedVenue, { startsAt: r.requested_starts_at, endsAt: r.requested_ends_at, participants: r.participants, facilities: r.required_facilities, excludeIds: [t.id] }));

    await changeBooking(c, after, t.id, { venueId: alt.venueId, date: alt.date, startTime: alt.startTime, endTime: alt.endTime }, req.user, { action: 'RELOCATED', reason: `Moved after venue change request ${r.id}${message ? `: ${message}` : ''}`, notifyOwner: false });
    const created = await createBookings(c, after, {
      actor: requester, owner: requester, venueId: r.venue_id, dates: [slot.d], startTime: slot.s, endTime: slot.e, participants: r.participants,
      categoryId: r.category_id, purpose: r.purpose, justification: `Venue change request: ${r.reason}`, facilities: r.required_facilities, recurrenceRule: null });
    const nb = created.created[0];
    await addHistory(c, nb.id, 'CREATED_FROM_VENUE_CHANGE', req.user.id, null, nb.status, { requestId: r.id, previousOwnerBookingId: t.id });
    await c.query(`UPDATE venue_change_requests SET status='APPROVED', decided_by=$2, decision_message=$3, decided_at=now(), updated_at=now(), alternative_venue_id=$4,
      alternative_starts_at=$5, alternative_ends_at=$6, resulting_booking_id=$7 WHERE id=$1`, [r.id, req.user.id, message, alt.venueId, stamp(alt.date, alt.startTime), stamp(alt.date, alt.endTime), nb.id]);
    const altVenue = v.venue.name;
    await notify(c, r.requester_id, { title: 'Venue change request approved', message: `Your request was approved: ${slotText} is ${created.status === 'PENDING' ? 'reserved for you and waits for administrator approval' : 'now booked for you'}.${message ? ` Message: ${message}` : ''}`, type: 'VENUE_CHANGE_APPROVED', link: `/bookings/${nb.id}`, entityType: 'BOOKING', entityId: nb.id });
    if (t.owner_id) await notify(c, t.owner_id, { title: 'Your booking was moved', message: `Your booking was moved to ${altVenue} on ${fmtDate(alt.date)}, ${fmt12(alt.startTime)} – ${fmt12(alt.endTime)}.`, type: 'BOOKING_MODIFIED', link: `/bookings/${t.id}`, entityType: 'BOOKING', entityId: t.id });
    await notifyAdmins(c, { title: 'Venue change completed', message: `${req.user.name} approved a venue change: ${slotText} now belongs to ${requester.name}; the original booking moved to ${altVenue}.`, type: 'ADMIN_VENUE_CHANGE', link: '/admin/venue-changes', entityType: 'VENUE_CHANGE', entityId: r.id });
    await auditTx(c, req.user.id, 'VENUE_CHANGE_APPROVE', 'VENUE_CHANGE', r.id, { alternative: alt, newBooking: nb.id });
    return { status: 'APPROVED', newBookingId: nb.id, originalBookingId: t.id };
  });
  res.json(out);
}));

router.post('/:id/cancel', idParam, asyncRoute(async (req, res) => {
  const r = (await q("UPDATE venue_change_requests SET status='CANCELLED', updated_at=now() WHERE id=$1 AND requester_id=$2 AND status='PENDING' RETURNING *", [req.params.id, req.user.id])).rows[0];
  if (!r) return res.status(404).json({ message: 'Pending request not found' });
  if (r.owner_id && !r.handled_by_admin) await notify(require('../db/pool'), r.owner_id, { title: 'Venue change request withdrawn', message: `${req.user.name} withdrew the venue change request.`, type: 'VENUE_CHANGE_CANCELLED', link: '/venue-changes', entityType: 'VENUE_CHANGE', entityId: r.id });
  res.json({ message: 'Request cancelled' });
}));

module.exports = router;
