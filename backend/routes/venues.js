const express = require('express');
const { body } = require('express-validator');
const { q, tx, asyncRoute, httpError, validate, idParam, audit, paging } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { EFFECTIVE_STATUS_SQL, cleanFacilities, norm } = require('../lib/availability');
const { validateWindow, stamp, colomboNow } = require('../lib/time');
const { rank } = require('../lib/recommend');
const { partialAvailability } = require('../lib/availability');
const { createMaintenance, restoreVenue } = require('../lib/maintenance');
const { cached, invalidate } = require('../lib/cache');
const META_KEY = 'venues:meta';

const router = express.Router();
const DEFAULT_BUILDINGS = ['Main Building', 'Department of Interdisciplinary Studies', 'Department of Electrical Engineering','Department of Mechanical Engineering','Department of Civil Engineering','Mechanical Workshop', 'Admin Block', 'Library'];
const DEFAULT_TYPES = ['Lecture Hall', 'Laboratory', 'Computer Lab', 'Seminar Room', 'Conference Room', 'Auditorium', 'Workshop'];

const VENUE_SQL = `SELECT v.*, (${EFFECTIVE_STATUS_SQL}) AS effective_status,
  (SELECT row_to_json(m) FROM (SELECT mm.id, mm.status, mm.reason, mm.description, mm.starts_at, mm.ends_at FROM venue_maintenance mm WHERE mm.venue_id=v.id AND mm.restored_at IS NULL
     AND COALESCE(mm.ends_at,'infinity'::timestamp) > LOCALTIMESTAMP ORDER BY mm.starts_at LIMIT 1) m) AS next_maintenance,
  ARRAY(SELECT vm.user_id FROM venue_managers vm WHERE vm.venue_id=v.id) AS managed_by FROM venues v`;
const mapVenue = (v) => ({ ...v, _id: v.id, status: v.effective_status, baseStatus: v.status, maintenanceNote: v.maintenance_note, createdAt: v.created_at, managedBy: v.managed_by, nextMaintenance: v.next_maintenance || null });

// ---------- lookups for dropdowns ----------
router.get('/meta', auth, asyncRoute(async (req, res) => {
  // Dropdown lookups only (never availability). Cached for 60 s and cleared by every venue / facility write below.
  res.json(await cached(META_KEY, 60000, async () => {
    const [b, t, f] = await Promise.all([
      q("SELECT DISTINCT building FROM venues WHERE active AND building <> '' ORDER BY building"),
      q('SELECT DISTINCT type FROM venues WHERE active ORDER BY type'),
      q('SELECT id,name,active FROM facilities ORDER BY name'),
    ]);
    return {
      buildings: [...new Set([...b.rows.map((x) => x.building), ...DEFAULT_BUILDINGS])].sort(),
      types: [...new Set([...t.rows.map((x) => x.type), ...DEFAULT_TYPES])].sort(),
      facilities: f.rows.filter((x) => x.active).map((x) => x.name), facilityRecords: f.rows,
    };
  }));
}));
router.post('/facilities', auth, roles('ADMIN'), validate(body('name').trim().isLength({ min: 2, max: 80 })), asyncRoute(async (req, res) => {
  const r = await q('INSERT INTO facilities(name) VALUES($1) ON CONFLICT DO NOTHING RETURNING *', [req.body.name]);
  if (!r.rowCount) return res.status(409).json({ message: 'That facility already exists' });
  invalidate(META_KEY);
  await audit(req, 'CREATE', 'FACILITY', r.rows[0].id, { name: req.body.name });
  res.status(201).json(r.rows[0]);
}));
router.patch('/facilities/:id', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const r = await q('UPDATE facilities SET active=COALESCE($2,active), name=COALESCE($3,name) WHERE id=$1 RETURNING *', [req.params.id, typeof req.body.active === 'boolean' ? req.body.active : null, req.body.name || null]);
  if (!r.rowCount) return res.status(404).json({ message: 'Facility not found' });
  invalidate(META_KEY);
  res.json(r.rows[0]);
}));

// ---------- search with recommendations ----------
router.get('/search', auth, asyncRoute(async (req, res) => {
  const { date, startTime, endTime, building = '', type = '' } = req.query;
  const participants = parseInt(req.query.participants, 10);
  const facilities = cleanFacilities(String(req.query.facilities || '').split(','));
  const errs = validateWindow({ date, startTime, endTime });
  if (errs.length) return res.status(400).json({ message: errs[0], errors: errs });
  if (!Number.isInteger(participants) || participants < 1 || participants > 10000) return res.status(400).json({ message: 'Expected number of participants must be a positive whole number' });
  const startsAt = stamp(date, startTime), endsAt = stamp(date, endTime);

  // Mandatory requirements: capacity + facilities. Venues failing them are never returned.
  const cand = await q(`SELECT v.* FROM venues v WHERE v.active AND v.capacity >= $1 AND COALESCE((SELECT array_agg(lower(trim(f))) FROM unnest(v.facilities) f),'{}'::text[]) @> $2::text[] ORDER BY v.name`, [participants, facilities.map(norm)]);
  const ids = cand.rows.map((v) => v.id);
  const conflicts = ids.length ? (await q(
    `SELECT b.id, b.venue_id, b.status, b.starts_at, b.ends_at, b.owner_id, u.name AS owner_name, u.email AS owner_email,
            to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS start_time, to_char(b.ends_at,'HH24:MI') AS end_time
     FROM bookings b LEFT JOIN users u ON u.id=b.owner_id WHERE b.venue_id = ANY($1) AND b.status IN ('PENDING','CONFIRMED') AND b.starts_at < $3 AND b.ends_at > $2 ORDER BY b.starts_at`, [ids, startsAt, endsAt])).rows : [];
  const blocks = ids.length ? (await q(
    `SELECT m.venue_id, m.status, m.reason, m.starts_at, m.ends_at FROM venue_maintenance m WHERE m.venue_id = ANY($1) AND m.restored_at IS NULL
     AND m.starts_at < $3 AND COALESCE(m.ends_at,'infinity'::timestamp) > $2`, [ids, startsAt, endsAt])).rows : [];

  const showEmail = req.user.role !== 'STUDENT' || process.env.EXPOSE_BOOKER_EMAIL_TO_STUDENTS === 'true';
  const base = (v) => ({ id: v.id, _id: v.id, name: v.name, building: v.building, type: v.type, capacity: v.capacity, facilities: v.facilities, date, startTime, endTime });
  const availableRaw = [], booked = [], unavailable = [];
  for (const v of cand.rows) {
    const vc = conflicts.filter((x) => x.venue_id === v.id);
    const vb = blocks.filter((x) => x.venue_id === v.id);
    const baseBlocked = v.status !== 'AVAILABLE';
    if (!vc.length && !vb.length && !baseBlocked) { availableRaw.push(v); continue; }
    const partial = baseBlocked ? [] : partialAvailability(date, startTime, endTime, vc, vb);
    const reasons = [];
    if (baseBlocked) reasons.push(`Venue is ${v.status.replace(/_/g, ' ').toLowerCase()}${v.maintenance_note ? ` (${v.maintenance_note})` : ''}`);
    for (const m of vb) reasons.push(`${m.status.replace(/_/g, ' ').toLowerCase()} – ${m.reason}${m.ends_at ? `, expected reopening ${String(m.ends_at).slice(0, 16).replace(' ', ' at ')}` : ''}`);
    if (vc.length) reasons.push(`Already booked ${vc.length === 1 ? 'during this time' : `${vc.length} times during this time`}`);
    const card = {
      ...base(v), availability: vc.length ? 'BOOKED' : 'UNAVAILABLE', unavailableReasons: reasons, partiallyAvailable: partial,
      existingBookings: vc.map((x) => ({ bookingId: x.id, date: x.date, startTime: x.start_time, endTime: x.end_time, status: x.status,
        ownerName: x.owner_name || 'Unknown', ownerEmail: showEmail ? x.owner_email : undefined, isMine: x.owner_id === req.user.id,
        canRequestChange: req.user.role !== 'ADMIN' && x.owner_id !== req.user.id })),
      maintenance: vb.map((m) => ({ status: m.status, reason: m.reason, startsAt: m.starts_at, expectedReopening: m.ends_at })),
    };
    (vc.length ? booked : unavailable).push(card);
  }
  const ranked = rank(availableRaw, { participants, facilities, building, type });
  const available = ranked.map((r, i) => ({ ...base(r.venue), availability: 'AVAILABLE', score: r.score, bestMatch: i === 0, explanation: r.explanation,
    matchesPreferredBuilding: r.buildingMatch, matchesPreferredType: r.typeMatch }));
  res.json({ criteria: { date, startTime, endTime, participants, facilities, building, type }, available, booked, unavailable });
}));

// ---------- CRUD ----------
router.get('/', auth, asyncRoute(async (req, res) => {
  const vals = [], cond = [];
  if (!(req.user.role === 'ADMIN' && req.query.includeInactive === 'true')) cond.push('v.active');
  for (const key of ['type', 'building']) if (req.query[key]) { vals.push(req.query[key]); cond.push(`v.${key}=$${vals.length}`); }
  if (req.query.q) { vals.push(`%${String(req.query.q).toLowerCase()}%`); cond.push(`(lower(v.name) LIKE $${vals.length} OR lower(v.building) LIKE $${vals.length})`); }
  let rows = (await q(`${VENUE_SQL} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY v.name`, vals)).rows;
  if (req.query.status) { const s = String(req.query.status).toUpperCase(); rows = rows.filter((v) => v.effective_status === s); }
  res.json(rows.map(mapVenue));
}));
router.get('/:id', auth, idParam, asyncRoute(async (req, res) => {
  const r = await q(`${VENUE_SQL} WHERE v.id=$1`, [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Venue not found' });
  res.json(mapVenue(r.rows[0]));
}));

const venueRules = [body('name').trim().isLength({ min: 2, max: 160 }).withMessage('Venue name is required'),
  body('capacity').isInt({ min: 1, max: 10000 }).withMessage('Capacity must be a whole number between 1 and 10000'),
  body('type').trim().isLength({ min: 2, max: 50 }).withMessage('Venue type is required')];

async function syncFacilityCatalog(c, facilities) {
  for (const f of facilities) await c.query('INSERT INTO facilities(name) VALUES($1) ON CONFLICT DO NOTHING', [f]);
}

router.post('/', auth, roles('ADMIN'), validate(...venueRules), asyncRoute(async (req, res) => {
  const { name, capacity, type, building = '', managedBy = [] } = req.body;
  if (!Array.isArray(req.body.facilities ?? []) || !Array.isArray(managedBy)) return res.status(400).json({ message: 'Facilities and managedBy must be arrays' });
  const facilities = cleanFacilities(req.body.facilities);
  const dup = await q('SELECT 1 FROM venues WHERE lower(name)=lower($1)', [name]);
  if (dup.rowCount) return res.status(409).json({ message: 'A venue with this name already exists' });
  const v = await tx(async (c) => {
    const r = await c.query('INSERT INTO venues(name,capacity,type,building,facilities) VALUES($1,$2,$3,$4,$5) RETURNING *', [name, capacity, type, building, facilities]);
    await syncFacilityCatalog(c, facilities);
    for (const uid of managedBy) await c.query("INSERT INTO venue_managers(venue_id,user_id) SELECT $1,id FROM users WHERE id=$2 AND role='LAB_ASSISTANT' ON CONFLICT DO NOTHING", [r.rows[0].id, uid]);
    return r.rows[0];
  });
  invalidate(META_KEY);
  await audit(req, 'CREATE', 'VENUE', v.id, { name });
  res.status(201).json({ ...v, _id: v.id });
}));

router.put('/:id', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const { name, capacity, type, building, managedBy } = req.body;
  if (capacity !== undefined && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || Number(capacity) > 10000)) return res.status(400).json({ message: 'Capacity must be a whole number between 1 and 10000' });
  if (name !== undefined && String(name).trim().length < 2) return res.status(400).json({ message: 'Venue name is required' });
  if (req.body.facilities !== undefined && !Array.isArray(req.body.facilities)) return res.status(400).json({ message: 'Facilities must be an array of strings' });
  if (managedBy !== undefined && !Array.isArray(managedBy)) return res.status(400).json({ message: 'managedBy must be an array' });
  const facilities = req.body.facilities === undefined ? null : cleanFacilities(req.body.facilities);
  if (name) { const dup = await q('SELECT 1 FROM venues WHERE lower(name)=lower($1) AND id<>$2', [name, req.params.id]); if (dup.rowCount) return res.status(409).json({ message: 'A venue with this name already exists' }); }
  const v = await tx(async (c) => {
    if (capacity !== undefined) {
      const over = await c.query("SELECT count(*)::int AS n, max(expected_students)::int AS biggest FROM bookings WHERE venue_id=$1 AND status IN ('PENDING','CONFIRMED') AND ends_at > LOCALTIMESTAMP AND expected_students > $2", [req.params.id, Number(capacity)]);
      if (over.rows[0].n) throw httpError(409, `${over.rows[0].n} upcoming booking(s) have more participants than the new capacity (largest: ${over.rows[0].biggest})`);
    }
    const r = await c.query('UPDATE venues SET name=COALESCE($2,name), capacity=COALESCE($3,capacity), type=COALESCE($4,type), building=COALESCE($5,building), facilities=COALESCE($6,facilities), updated_at=now() WHERE id=$1 RETURNING *',
      [req.params.id, name ? String(name).trim() : null, capacity ?? null, type ?? null, building ?? null, facilities]);
    if (!r.rowCount) return null;
    if (facilities) await syncFacilityCatalog(c, facilities);
    if (Array.isArray(managedBy)) {
      await c.query('DELETE FROM venue_managers WHERE venue_id=$1', [req.params.id]);
      for (const uid of managedBy) await c.query("INSERT INTO venue_managers(venue_id,user_id) SELECT $1,id FROM users WHERE id=$2 AND role='LAB_ASSISTANT' ON CONFLICT DO NOTHING", [req.params.id, uid]);
    }
    return r.rows[0];
  });
  if (!v) return res.status(404).json({ message: 'Venue not found' });
  invalidate(META_KEY);
  await audit(req, 'UPDATE', 'VENUE', req.params.id);
  res.json({ ...v, _id: v.id });
}));

// Venues with booking history are never hard-deleted: they are deactivated (soft delete) when nothing upcoming depends on them.
router.delete('/:id', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const out = await tx(async (c) => {
    const v = (await c.query('SELECT id,active FROM venues WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!v) return { status: 404, message: 'Venue not found' };
    const upcoming = (await c.query("SELECT count(*)::int AS n FROM bookings WHERE venue_id=$1 AND status IN ('PENDING','CONFIRMED') AND ends_at > LOCALTIMESTAMP", [v.id])).rows[0].n;
    if (upcoming) return { status: 409, message: `${upcoming} upcoming booking(s) use this venue; cancel or move them first` };
    const history = (await c.query('SELECT (SELECT count(*) FROM bookings WHERE venue_id=$1) + (SELECT count(*) FROM venue_maintenance WHERE venue_id=$1) + (SELECT count(*) FROM venue_change_requests WHERE venue_id=$1) AS n', [v.id])).rows[0].n;
    if (Number(history) > 0) {
      await c.query('UPDATE venues SET active=false, deleted_at=now(), updated_at=now() WHERE id=$1', [v.id]);
      return { status: 200, message: 'Venue has history, so it was deactivated instead of deleted', soft: true };
    }
    await c.query('DELETE FROM venues WHERE id=$1', [v.id]);
    return { status: 200, message: 'Venue deleted' };
  });
  if (out.status === 200) { invalidate(META_KEY); await audit(req, out.soft ? 'DEACTIVATE' : 'DELETE', 'VENUE', req.params.id); }
  res.status(out.status).json({ message: out.message, soft: !!out.soft });
}));
router.patch('/:id/reactivate', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const r = await q('UPDATE venues SET active=true, deleted_at=NULL, updated_at=now() WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Venue not found' });
  invalidate(META_KEY);
  await audit(req, 'REACTIVATE', 'VENUE', req.params.id);
  res.json({ message: 'Venue reactivated' });
}));

// ---------- history (admin) ----------
router.get('/:id/history', auth, roles('ADMIN'), idParam, asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query, 10);
  const total = (await q('SELECT count(*)::int AS n FROM bookings WHERE venue_id=$1', [req.params.id])).rows[0].n;
  const bookings = await q(`SELECT b.id, b.status, to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS "startTime", to_char(b.ends_at,'HH24:MI') AS "endTime", b.purpose, b.expected_students AS participants, u.name AS "ownerName"
    FROM bookings b LEFT JOIN users u ON u.id=b.owner_id WHERE b.venue_id=$1 ORDER BY b.starts_at DESC LIMIT $2 OFFSET $3`, [req.params.id, limit, offset]);
  const maintenance = await q('SELECT m.*, u.name AS created_by_name FROM venue_maintenance m LEFT JOIN users u ON u.id=m.created_by WHERE m.venue_id=$1 ORDER BY m.starts_at DESC LIMIT 50', [req.params.id]);
  res.json({ bookings: { items: bookings.rows, total, page, pageSize }, maintenance: maintenance.rows });
}));

// ---------- status change (legacy lab-assistant endpoint, now backed by maintenance records) ----------
router.patch('/:id/status', auth, roles('ADMIN', 'LAB_ASSISTANT'), idParam, asyncRoute(async (req, res) => {
  const map = { available: 'AVAILABLE', maintenance: 'UNDER_MAINTENANCE', disabled: 'UNAVAILABLE' };
  const status = map[String(req.body.status || '').toLowerCase()] || String(req.body.status || '').toUpperCase();
  if (!['AVAILABLE', 'UNDER_MAINTENANCE', 'TEMPORARILY_CLOSED', 'UNAVAILABLE'].includes(status)) return res.status(400).json({ message: 'Invalid venue status' });
  if (req.user.role === 'LAB_ASSISTANT') {
    const managed = await q('SELECT 1 FROM venue_managers WHERE venue_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!managed.rowCount) return res.status(403).json({ message: 'You do not manage this venue' });
  }
  const note = String(req.body.maintenanceNote || req.body.reason || '').trim();
  const out = await tx(async (c, after) => {
    if (status === 'AVAILABLE') { await restoreVenue(c, after, { venueId: req.params.id, actor: req.user }); return { restored: true }; }
    return createMaintenance(c, after, { venueId: req.params.id, status, reason: note || `Reported by ${req.user.name}`, description: '', actor: req.user, force: true });
  });
  res.json(out);
}));

module.exports = router;
module.exports.mapVenue = mapVenue;
