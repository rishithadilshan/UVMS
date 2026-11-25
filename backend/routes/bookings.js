const express = require('express');
const { body } = require('express-validator');
const { q, tx, asyncRoute, httpError, validate, idParam, isUuid, audit, auditTx, paging, getSetting, BOOKING_ROLES } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { validateWindow, stamp, expandRecurrence, colomboNow } = require('../lib/time');
const { loadVenue, checkVenue, assertOk, cleanFacilities } = require('../lib/availability');
const { BOOKING_SELECT, mapBooking, getBooking, createBookings, decideBooking, cancelBooking, changeBooking, addHistory, when } = require('../lib/bookings');
const { notify, notifyAdmins } = require('../lib/notify');

const router = express.Router();
const modRouter = express.Router();
const STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'];
const isAdmin = (u) => u.role === 'ADMIN';

async function maxHours() { return Number(await getSetting('max_booking_hours', 12)) || 12; }

// =============== LIST ===============
router.get('/', auth, asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query);
  const vals = [], cond = [];
  const add = (sql, v) => { vals.push(v); cond.push(sql.replace('?', `$${vals.length}`)); };
  const all = isAdmin(req.user) && req.query.scope === 'all';
  if (!all) add('b.owner_id = ?', req.user.id);
  if (req.query.status && STATUSES.includes(String(req.query.status).toUpperCase())) add('b.status = ?', String(req.query.status).toUpperCase());
  if (req.query.time === 'upcoming') cond.push('b.ends_at >= LOCALTIMESTAMP');
  if (req.query.time === 'past') cond.push('b.ends_at < LOCALTIMESTAMP');
  if (req.query.venueId && isUuid(req.query.venueId)) add('b.venue_id = ?', req.query.venueId);
  if (req.query.categoryId && isUuid(req.query.categoryId)) add('b.category_id = ?', req.query.categoryId);
  if (req.query.ownerRole) add('ou.role = ?', req.query.ownerRole);
  if (req.query.building) add('v.building = ?', req.query.building);
  if (req.query.seriesId && isUuid(req.query.seriesId)) add('b.series_id = ?', req.query.seriesId);
  if (req.query.from) add('b.starts_at >= ?::date', req.query.from);            // same rows as starts_at::date >= from, but index-friendly
  if (req.query.to) add('b.starts_at < (?::date + 1)', req.query.to);         // same rows as starts_at::date <= to
  if (req.query.q) { vals.push(`%${String(req.query.q).toLowerCase()}%`); const n = vals.length; cond.push(`(lower(b.purpose) LIKE $${n} OR lower(v.name) LIKE $${n} OR lower(COALESCE(ou.name,'')) LIKE $${n})`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const order = req.query.sort === 'priority' ? 'bc.priority_level NULLS LAST, b.created_at' : (req.query.time === 'upcoming' || req.query.status === 'PENDING' ? 'b.starts_at ASC' : 'b.starts_at DESC');
  const [totalRes, r] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN users ou ON ou.id=b.owner_id ${where}`, vals),
    q(`${BOOKING_SELECT} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, vals),
  ]);
  res.json({ items: r.rows.map(mapBooking), total: totalRes.rows[0].n, page, pageSize });
}));

// =============== CREATE ===============
router.post('/', auth, roles(...BOOKING_ROLES, 'ADMIN'), validate(
  body('venueId').isUUID().withMessage('Select a venue'),
  body('participants').isInt({ min: 1, max: 10000 }).withMessage('Expected participants must be a positive whole number'),
  body('categoryId').isUUID().withMessage('Select a booking category'),
  body('purpose').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Booking purpose is required (3-500 characters)'),
), asyncRoute(async (req, res) => {
  const { venueId, date, startTime, endTime, categoryId, purpose } = req.body;
  const participants = Number(req.body.participants);
  const facilities = cleanFacilities(req.body.facilities);
  const justification = String(req.body.justification || '').trim();
  const errs = validateWindow({ date, startTime, endTime }, { maxHours: await maxHours() });
  if (errs.length) return res.status(400).json({ message: errs[0], errors: errs });

  const out = await tx(async (c, after) => {
    // The booking owner is always derived on the server. Only an admin may book on behalf of someone else.
    let owner = req.user;
    if (req.body.ownerId && isAdmin(req.user)) {
      const o = (await c.query("SELECT id,name,email,role FROM users WHERE id=$1 AND active AND status='APPROVED' AND role <> 'ADMIN'", [req.body.ownerId])).rows[0];
      if (!o) throw httpError(400, 'Selected booking owner was not found');
      owner = o;
    } else if (isAdmin(req.user)) throw httpError(400, 'Select the user this booking is for');
    if (owner.role === 'STUDENT' && justification.length < 10) throw httpError(400, 'Students must provide the academic purpose and justification (at least 10 characters)');
    const cat = (await c.query('SELECT id FROM booking_categories WHERE id=$1 AND active', [categoryId])).rows[0];
    if (!cat) throw httpError(400, 'Selected booking category is not available');
    let dates = [date];
    let recurrenceRule = null;
    if (req.body.recurrence && req.body.recurrence.enabled !== false) {
      recurrenceRule = { frequency: req.body.recurrence.frequency || 'WEEKLY', startDate: date, endDate: req.body.recurrence.endDate, daysOfWeek: (req.body.recurrence.daysOfWeek || []).map(Number) };
      dates = expandRecurrence(recurrenceRule);
    }
    return createBookings(c, after, { actor: req.user, owner, venueId, dates, startTime, endTime, participants, categoryId, purpose, justification, facilities, recurrenceRule });
  });
  const items = out.created.map(mapBooking);
  res.status(201).json({
    message: out.status === 'PENDING' ? 'Booking request submitted for administrator approval. The venue is reserved while it is reviewed.' : 'Booking confirmed.',
    status: out.status, bookings: items, booking: items[0], conflicts: out.conflicts, seriesId: out.seriesId, requested: out.created.length + out.conflicts.length });
}));

// =============== CHECK-IN BY TOKEN (QR) ===============
router.post('/check-in/token', auth, validate(body('token').isString().isLength({ min: 10, max: 40 })), asyncRoute(async (req, res) => {
  const b = (await q('SELECT id, owner_id FROM bookings WHERE checkin_token=$1', [req.body.token])).rows[0];
  if (!b) return res.status(404).json({ message: 'Unknown check-in code' });
  if (!(isAdmin(req.user) || req.user.role === 'LAB_ASSISTANT' || b.owner_id === req.user.id)) return res.status(403).json({ message: 'Only the booking owner, a lab assistant or an administrator can check in this booking' });
  req.params.id = b.id;
  return doCheckIn(req, res, 'QR');
}));

async function doCheckIn(req, res, method) {
  const out = await tx(async (c) => {
    const r = (await c.query(`SELECT b.id, b.status, b.owner_id, (LOCALTIMESTAMP >= b.starts_at - interval '15 minutes' AND LOCALTIMESTAMP < b.ends_at) AS open FROM bookings b WHERE b.id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!r) return { status: 404, message: 'Booking not found' };
    if (r.status !== 'CONFIRMED') return { status: 409, message: 'Only confirmed bookings can be checked in' };
    if (!r.open) return { status: 409, message: 'Check-in opens 15 minutes before the booking starts and closes when it ends' };
    const ins = await c.query('INSERT INTO check_ins(booking_id,user_id,method) VALUES($1,$2,$3) ON CONFLICT (booking_id) DO NOTHING RETURNING id', [r.id, req.user.id, method]);
    if (ins.rowCount) await addHistory(c, r.id, 'CHECKED_IN', req.user.id, r.status, r.status, { method });
    return { status: 200, message: ins.rowCount ? 'Checked in' : 'Already checked in', bookingId: r.id };
  });
  res.status(out.status).json(out);
}

// =============== DETAIL ===============
router.get('/:id', auth, idParam, asyncRoute(async (req, res) => {
  const row = await getBooking({ query: q }, req.params.id);
  if (!row) return res.status(404).json({ message: 'Booking not found' });
  const owner = row.owner_id === req.user.id;
  if (!owner && !isAdmin(req.user)) return res.status(403).json({ message: 'You can only view your own bookings' });
  const [historyRes, modsRes, reminderRes, tokenRes] = await Promise.all([q('SELECT h.id, h.action, h.from_status AS "fromStatus", h.to_status AS "toStatus", h.details, h.created_at AS "createdAt", u.name AS "actorName" FROM booking_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.booking_id=$1 ORDER BY h.created_at, h.id', [row.id]),
  q('SELECT id, kind, changes, reason, status, decision_note AS "decisionNote", created_at AS "createdAt" FROM booking_modification_requests WHERE booking_id=$1 ORDER BY created_at DESC', [row.id]),
  q('SELECT status, remind_at AS "remindAt", sent_at AS "sentAt", short_notice AS "shortNotice" FROM booking_reminders WHERE booking_id=$1', [row.id]),
  row.status === 'CONFIRMED' ? q('SELECT checkin_token FROM bookings WHERE id=$1', [row.id]) : null]);
  const history = historyRes.rows, mods = modsRes.rows, reminder = reminderRes.rows[0] || null;
  const active = ['PENDING', 'CONFIRMED'].includes(row.status);
  const b = mapBooking(row);
  res.json({ ...b, history, modificationRequests: mods, reminder,
    checkinToken: tokenRes ? tokenRes.rows[0].checkin_token : null,
    permissions: { canCancel: active && (!row.started || isAdmin(req.user)), canModify: active && !row.started && (owner || isAdmin(req.user)), canCheckIn: row.status === 'CONFIRMED' && !row.ended && !row.checked_in && (owner || isAdmin(req.user)) } });
}));

// =============== ADMIN DECISION (student requests) ===============
router.post('/:id/decision', auth, roles('ADMIN'), idParam, validate(body('decision').isIn(['APPROVE', 'REJECT'])), asyncRoute(async (req, res) => {
  const { decision } = req.body; const reason = String(req.body.reason || '').trim();
  if (decision === 'REJECT' && !reason) return res.status(400).json({ message: 'A rejection reason is required' });
  const out = await tx(async (c, after) => {
    if (req.body.scope === 'series') {
      const first = await getBooking(c, req.params.id);
      if (!first?.series_id) throw httpError(400, 'This booking is not part of a recurring series');
      const ids = (await c.query("SELECT id FROM bookings WHERE series_id=$1 AND status='PENDING' ORDER BY starts_at", [first.series_id])).rows.map((x) => x.id);
      const results = [];
      for (const id of ids) {
        await c.query('SAVEPOINT occ');
        try { results.push({ id, status: await decideBooking(c, after, id, req.user, decision, reason) }); await c.query('RELEASE SAVEPOINT occ'); }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT occ'); if (!e.status) throw e; results.push({ id, error: e.message }); }
      }
      return { series: true, results };
    }
    return { status: await decideBooking(c, after, req.params.id, req.user, decision, reason) };
  });
  res.json(out);
}));

// =============== CANCEL ===============
router.post('/:id/cancel', auth, idParam, asyncRoute(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ message: 'Please provide a reason for the cancellation' });
  const out = await tx(async (c, after) => {
    const b = await getBooking(c, req.params.id, { lock: true });
    if (!b) throw httpError(404, 'Booking not found');
    if (!(isAdmin(req.user) || b.owner_id === req.user.id)) throw httpError(403, 'You can only cancel your own bookings');
    if (!['PENDING', 'CONFIRMED'].includes(b.status)) throw httpError(409, `A ${b.status.toLowerCase()} booking cannot be cancelled`);
    if (b.started && !isAdmin(req.user)) throw httpError(409, 'A booking that has already started cannot be cancelled');
    const studentConfirmed = req.user.role === 'STUDENT' && b.status === 'CONFIRMED';
    if (studentConfirmed) {
      // Students request the cancellation of a confirmed booking; the administrator decides.
      if (req.body.scope === 'series') throw httpError(400, 'Cancellation requests for confirmed bookings must be submitted one occurrence at a time');
      const ins = await c.query("INSERT INTO booking_modification_requests(booking_id,requester_id,kind,reason) VALUES($1,$2,'CANCEL',$3) ON CONFLICT DO NOTHING RETURNING id", [b.id, req.user.id, reason]);
      if (!ins.rowCount) throw httpError(409, 'A cancellation request for this booking is already pending');
      await addHistory(c, b.id, 'CANCELLATION_REQUESTED', req.user.id, b.status, b.status, { reason });
      await notifyAdmins(c, { title: 'Cancellation request', message: `${req.user.name} asks to cancel ${when(b)}. Reason: ${reason}`, type: 'ADMIN_CANCEL_REQUEST', link: '/admin/bookings?tab=requests', entityType: 'BOOKING', entityId: b.id });
      await notify(c, req.user.id, { title: 'Cancellation request sent', message: `Your cancellation request for ${when(b)} was sent to the administrator.`, type: 'BOOKING_CANCEL_REQUESTED', link: `/bookings/${b.id}`, entityType: 'BOOKING', entityId: b.id });
      return { status: 202, message: 'Cancellation request submitted for administrator approval', requested: true };
    }
    const ids = [b.id];
    if (req.body.scope === 'series' && b.series_id) {
      const more = await c.query("SELECT id FROM bookings WHERE series_id=$1 AND id<>$2 AND status IN ('PENDING','CONFIRMED') AND starts_at > LOCALTIMESTAMP AND (owner_id=$3 OR $4) ORDER BY starts_at", [b.series_id, b.id, req.user.id, isAdmin(req.user)]);
      ids.push(...more.rows.map((x) => x.id));
    }
    for (const id of ids) await cancelBooking(c, after, id, req.user, reason);
    return { status: 200, message: ids.length > 1 ? `${ids.length} bookings cancelled` : 'Booking cancelled', cancelled: ids.length };
  });
  res.status(out.status).json(out);
}));

// =============== MODIFY ===============
router.post('/:id/modify', auth, idParam, asyncRoute(async (req, res) => {
  const out = await tx(async (c, after) => {
    const b = await getBooking(c, req.params.id, { lock: true });
    if (!b) throw httpError(404, 'Booking not found');
    if (b.owner_id !== req.user.id) throw httpError(403, 'You can only modify your own bookings (administrators use the re-schedule action)');
    if (!['PENDING', 'CONFIRMED'].includes(b.status)) throw httpError(409, 'Only pending or confirmed bookings can be modified');
    if (b.started) throw httpError(409, 'A booking that has already started cannot be modified');
    const changes = {};
    if (req.body.date !== undefined && req.body.date !== b.date) changes.date = req.body.date;
    if (req.body.startTime !== undefined && req.body.startTime !== b.start_time) changes.startTime = req.body.startTime;
    if (req.body.endTime !== undefined && req.body.endTime !== b.end_time) changes.endTime = req.body.endTime;
    if (req.body.participants !== undefined && Number(req.body.participants) !== b.participants) {
      if (!Number.isInteger(Number(req.body.participants)) || Number(req.body.participants) < 1) throw httpError(400, 'Participants must be a positive whole number');
      changes.participants = Number(req.body.participants);
    }
    if (req.body.facilities !== undefined) { const f = cleanFacilities(req.body.facilities); if (JSON.stringify([...f].sort()) !== JSON.stringify([...b.required_facilities].sort())) changes.facilities = f; }
    if (req.body.purpose !== undefined && String(req.body.purpose).trim() !== b.purpose) {
      if (String(req.body.purpose).trim().length < 3) throw httpError(400, 'Booking purpose is required');
      changes.purpose = String(req.body.purpose).trim();
    }
    if (!Object.keys(changes).length) throw httpError(400, 'Nothing was changed');
    const material = ['date', 'startTime', 'endTime', 'participants', 'facilities'].some((k) => k in changes);
    const reason = String(req.body.reason || '').trim();
    const full = { date: b.date, startTime: b.start_time, endTime: b.end_time, ...changes };
    if (material) { const errs = validateWindow(full, { maxHours: await maxHours() }); if (errs.length) throw httpError(400, errs[0]); }

    if (req.user.role === 'STUDENT' && b.status === 'CONFIRMED' && material) {
      // Validate now so the student gets immediate feedback; it is validated again when the administrator approves.
      const venue = await loadVenue(c, b.venue_id);
      assertOk(await checkVenue(c, venue, { startsAt: stamp(full.date, full.startTime), endsAt: stamp(full.date, full.endTime), participants: changes.participants ?? b.participants, facilities: changes.facilities ?? b.required_facilities, excludeIds: [b.id] }));
      const ins = await c.query("INSERT INTO booking_modification_requests(booking_id,requester_id,kind,changes,reason) VALUES($1,$2,'MODIFY',$3,$4) ON CONFLICT DO NOTHING RETURNING id", [b.id, req.user.id, JSON.stringify(changes), reason]);
      if (!ins.rowCount) throw httpError(409, 'A modification request for this booking is already pending');
      await addHistory(c, b.id, 'MODIFICATION_REQUESTED', req.user.id, b.status, b.status, { changes, reason });
      await notifyAdmins(c, { title: 'Booking modification request', message: `${req.user.name} requests changes to ${when(b)}.`, type: 'ADMIN_MODIFY_REQUEST', link: '/admin/bookings?tab=requests', entityType: 'BOOKING', entityId: b.id });
      return { status: 202, message: 'Modification request submitted for administrator approval. Your current booking stays unchanged until it is approved.', requested: true };
    }
    const result = await changeBooking(c, after, b.id, changes, req.user, { reason });
    return { status: 200, message: 'Booking updated', booking: mapBooking(result.booking) };
  });
  res.status(out.status).json(out);
}));

// =============== ADMIN RE-SCHEDULE / MOVE ===============
router.patch('/:id/admin-update', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const { venueId, date, startTime, endTime } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Please give a reason; the booking owner will be notified' });
  const out = await tx(async (c, after) => {
    const r = await changeBooking(c, after, req.params.id, { venueId, date, startTime, endTime }, req.user, { reason, action: 'ADMIN_RESCHEDULED' });
    await auditTx(c, req.user.id, 'RESCHEDULE', 'BOOKING', req.params.id, { before: r.before, reason });
    return r;
  });
  res.json({ message: 'Booking updated', booking: mapBooking(out.booking) });
}));

router.post('/:id/check-in', auth, idParam, asyncRoute(async (req, res) => {
  const b = (await q('SELECT owner_id FROM bookings WHERE id=$1', [req.params.id])).rows[0];
  if (!b) return res.status(404).json({ message: 'Booking not found' });
  if (!(b.owner_id === req.user.id || isAdmin(req.user))) return res.status(403).json({ message: 'Only the booking owner can check in' });
  return doCheckIn(req, res, 'MANUAL');
}));

// =============== MODIFICATION / CANCELLATION REQUESTS ===============
modRouter.get('/', auth, asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query);
  const vals = [], cond = [];
  if (!isAdmin(req.user)) { vals.push(req.user.id); cond.push(`r.requester_id=$${vals.length}`); }
  if (req.query.status) { vals.push(String(req.query.status).toUpperCase()); cond.push(`r.status=$${vals.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (await q(`SELECT count(*)::int AS n FROM booking_modification_requests r ${where}`, vals)).rows[0].n;
  const r = await q(`SELECT r.id, r.kind, r.changes, r.reason, r.status, r.decision_note AS "decisionNote", r.created_at AS "createdAt", r.booking_id AS "bookingId", u.name AS "requesterName", u.role AS "requesterRole",
      v.name AS "venueName", to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS "startTime", to_char(b.ends_at,'HH24:MI') AS "endTime", b.purpose, b.expected_students AS participants
    FROM booking_modification_requests r JOIN users u ON u.id=r.requester_id JOIN bookings b ON b.id=r.booking_id JOIN venues v ON v.id=b.venue_id ${where} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows, total, page, pageSize });
}));

modRouter.post('/:id/decision', auth, roles('ADMIN'), idParam, validate(body('decision').isIn(['APPROVE', 'REJECT'])), asyncRoute(async (req, res) => {
  const note = String(req.body.note || '').trim();
  if (req.body.decision === 'REJECT' && !note) return res.status(400).json({ message: 'Please give a reason for the rejection' });
  const out = await tx(async (c, after) => {
    const r = (await c.query("SELECT * FROM booking_modification_requests WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
    if (!r) throw httpError(404, 'Request not found');
    if (r.status !== 'PENDING') throw httpError(409, `This request is already ${r.status.toLowerCase()}`);
    const b = await getBooking(c, r.booking_id, { lock: true });
    const label = r.kind === 'CANCEL' ? 'cancellation' : 'modification';
    if (req.body.decision === 'APPROVE') {
      if (!b || !['PENDING', 'CONFIRMED'].includes(b.status)) throw httpError(409, 'The booking is no longer active');
      if (r.kind === 'CANCEL') await cancelBooking(c, after, b.id, req.user, r.reason || 'Cancellation approved', { silentOwner: true });
      else await changeBooking(c, after, b.id, r.changes, req.user, { reason: note, notifyOwner: false });
    }
    const status = req.body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await c.query('UPDATE booking_modification_requests SET status=$2, decided_by=$3, decision_note=$4, decided_at=now(), updated_at=now() WHERE id=$1', [r.id, status, req.user.id, note]);
    await auditTx(c, req.user.id, `${status}_${r.kind}`, 'BOOKING', r.booking_id, { note });
    if (b) await addHistory(c, b.id, `${r.kind}_${status}`, req.user.id, b.status, b.status, { note });
    await notify(c, r.requester_id, { title: `Booking ${label} ${status.toLowerCase()}`, message: `Your ${label} request${b ? ` for ${when(b)}` : ''} was ${status.toLowerCase()}.${note ? ` Note: ${note}` : ''}`, type: 'BOOKING_MODIFIED', link: `/bookings/${r.booking_id}`, entityType: 'BOOKING', entityId: r.booking_id });
    return { status };
  });
  res.json(out);
}));

module.exports = router;
module.exports.modRouter = modRouter;
