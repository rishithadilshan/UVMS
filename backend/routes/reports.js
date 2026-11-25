const express = require('express');
const { q, asyncRoute, getSetting, httpError } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { colomboNow, isDate, addDays, dayOfWeek, toMinutes } = require('../lib/time');
const { buildXlsx, toCsv } = require('../lib/xlsx');

const router = express.Router();
router.use(auth, roles('ADMIN'));

function resolveRange(query) {
  const today = colomboNow().date;
  const anchor = isDate(query.date) ? query.date : today;
  const period = ['daily', 'weekly', 'monthly', 'custom'].includes(query.period) ? query.period : 'monthly';
  if (period === 'daily') return { period, from: anchor, to: anchor };
  if (period === 'weekly') { const mon = addDays(anchor, -((dayOfWeek(anchor) + 6) % 7)); return { period, from: mon, to: addDays(mon, 6) }; }
  if (period === 'monthly') { const [y, m] = anchor.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { period, from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }; }
  if (!isDate(query.from) || !isDate(query.to) || query.to < query.from) throw httpError(400, 'A valid custom date range is required');
  if (addDays(query.from, 731) < query.to) throw httpError(400, 'The custom range cannot exceed two years');
  return { period, from: query.from, to: query.to };
}

async function buildReport(query) {
  const { period, from, to } = resolveRange(query);
  const p = [from, to];
  // Range on the raw column (same rows as starts_at::date BETWEEN from AND to) so the starts_at index can be used.
  const inRange = 'b.starts_at >= $1::date AND b.starts_at < ($2::date + 1)';
  const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;

  // The seven sections are independent: run them concurrently instead of one after another.
  const [op, statusRows, venueCount, byVenueRows, byBuilding, byCategory, maintenance, noShows] = await Promise.all([
    getSetting('operating_hours', { start: '08:00', end: '18:00' }),
    q(`SELECT b.status, count(*)::int AS n FROM bookings b WHERE ${inRange} GROUP BY b.status`, p),
    q('SELECT count(*)::int AS n FROM venues WHERE active'),
    q(`SELECT v.id, v.name, v.building, v.capacity,
      count(b.id) FILTER (WHERE b.status='CONFIRMED')::int AS bookings,
      COALESCE(sum(EXTRACT(EPOCH FROM (b.ends_at - b.starts_at))/60) FILTER (WHERE b.status='CONFIRMED'),0)::int AS booked_minutes
    FROM venues v LEFT JOIN bookings b ON b.venue_id=v.id AND b.status='CONFIRMED' AND ${inRange} WHERE v.active GROUP BY v.id ORDER BY bookings DESC, v.name`, p),
    q(`SELECT COALESCE(NULLIF(v.building,''),'(none)') AS building, count(*)::int AS bookings FROM bookings b JOIN venues v ON v.id=b.venue_id WHERE b.status='CONFIRMED' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC`, p),
    q(`SELECT COALESCE(c.name,'(uncategorised)') AS category, count(*)::int AS bookings FROM bookings b LEFT JOIN booking_categories c ON c.id=b.category_id WHERE b.status='CONFIRMED' AND ${inRange} GROUP BY 1 ORDER BY 2 DESC`, p),
    q(`SELECT v.name AS venue, m.status, m.reason, to_char(m.starts_at,'YYYY-MM-DD HH24:MI') AS starts_at, to_char(m.ends_at,'YYYY-MM-DD HH24:MI') AS ends_at, (m.restored_at IS NOT NULL) AS restored
      FROM venue_maintenance m JOIN venues v ON v.id=m.venue_id WHERE m.starts_at < ($2::date + 1) AND COALESCE(m.ends_at,'infinity'::timestamp) >= $1::date ORDER BY m.starts_at`, p),
    q(`SELECT b.id, v.name AS venue, u.name AS booked_by, to_char(b.starts_at,'YYYY-MM-DD') AS date, to_char(b.starts_at,'HH24:MI') AS start_time, to_char(b.ends_at,'HH24:MI') AS end_time, b.purpose
      FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN users u ON u.id=b.owner_id
      WHERE b.status='CONFIRMED' AND b.ends_at < LOCALTIMESTAMP AND ${inRange} AND NOT EXISTS (SELECT 1 FROM check_ins ci WHERE ci.booking_id=b.id) ORDER BY b.starts_at DESC LIMIT 500`, p),
  ]);
  const opMinutes = Math.max(60, toMinutes(op.end) - toMinutes(op.start));
  const status = Object.fromEntries(statusRows.rows.map((r) => [r.status, r.n]));
  const totalVenues = venueCount.rows[0].n;
  const byVenue = byVenueRows.rows.map((v) => ({ ...v, utilization: Math.min(100, Math.round((v.booked_minutes / (days * opMinutes)) * 1000) / 10) }));
  const total = Object.values(status).reduce((a, b) => a + b, 0);
  return {
    period, from, to, operatingHours: op,
    totals: { venues: totalVenues, bookings: total, confirmed: status.CONFIRMED || 0, pending: status.PENDING || 0, rejected: status.REJECTED || 0, cancelled: status.CANCELLED || 0, expired: status.EXPIRED || 0, noShows: noShows.rowCount },
    utilization: byVenue, mostBooked: byVenue.slice(0, 5), leastBooked: [...byVenue].sort((a, b) => a.bookings - b.bookings || a.name.localeCompare(b.name)).slice(0, 5),
    byBuilding: byBuilding.rows, byCategory: byCategory.rows, maintenance: maintenance.rows, noShows: noShows.rows,
  };
}

router.get('/summary', asyncRoute(async (req, res) => res.json(await buildReport(req.query))));

router.get('/export', asyncRoute(async (req, res) => {
  const r = await buildReport(req.query);
  const t = r.totals;
  const sheets = [
    { name: 'Summary', rows: [['UVMS report', `${r.from} to ${r.to}`], [], ['Metric', 'Value'], ['Total venues', t.venues], ['Total bookings', t.bookings], ['Confirmed', t.confirmed], ['Pending student requests', t.pending], ['Rejected', t.rejected], ['Cancelled', t.cancelled], ['Expired', t.expired], ['No-shows', t.noShows]] },
    { name: 'Venue utilization', rows: [['Venue', 'Building', 'Capacity', 'Confirmed bookings', 'Booked minutes', 'Utilization %'], ...r.utilization.map((v) => [v.name, v.building, v.capacity, v.bookings, v.booked_minutes, v.utilization])] },
    { name: 'By building', rows: [['Building', 'Bookings'], ...r.byBuilding.map((x) => [x.building, x.bookings])] },
    { name: 'By category', rows: [['Category', 'Bookings'], ...r.byCategory.map((x) => [x.category, x.bookings])] },
    { name: 'Maintenance', rows: [['Venue', 'Status', 'Reason', 'Starts', 'Expected reopening', 'Restored'], ...r.maintenance.map((m) => [m.venue, m.status, m.reason, m.starts_at, m.ends_at || '', m.restored ? 'Yes' : 'No'])] },
    { name: 'No-shows', rows: [['Venue', 'Booked by', 'Date', 'Start', 'End', 'Purpose'], ...r.noShows.map((n) => [n.venue, n.booked_by, n.date, n.start_time, n.end_time, n.purpose])] },
  ];
  const name = `uvms-report-${r.from}_${r.to}`;
  if (req.query.format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` });
    return res.send('\ufeff' + sheets.map((s) => `${s.name}\r\n${toCsv(s.rows)}`).join('\r\n\r\n'));
  }
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` });
  res.send(buildXlsx(sheets));
}));

module.exports = router;
