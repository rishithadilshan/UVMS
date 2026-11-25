// Read-only: runs EXPLAIN (ANALYZE, BUFFERS) on the application's heaviest queries and prints plan + timings,
// plus table / index sizes and indexes that have never been scanned. Use it BEFORE and AFTER `npm run db:migrate`:
//   node scripts/perf-explain.js > explain-before.txt     (then migrate)     node scripts/perf-explain.js > explain-after.txt
// EXPLAIN ANALYZE executes the statements; they are all SELECTs. Run it against a copy / staging database with realistic data.
require('dotenv').config();
const pool = require('../db/pool');

const QUERIES = {
  'admin overview counters': require('../routes/admin').OVERVIEW_SQL,
  'admin bookings list (all, newest first)': `SELECT b.id FROM bookings b JOIN venues v ON v.id=b.venue_id LEFT JOIN booking_categories bc ON bc.id=b.category_id LEFT JOIN users ou ON ou.id=b.owner_id ORDER BY b.starts_at DESC LIMIT 20`,
  'report range (month)': `SELECT b.status, count(*) FROM bookings b WHERE b.starts_at >= date_trunc('month', LOCALTIMESTAMP) AND b.starts_at < date_trunc('month', LOCALTIMESTAMP) + interval '1 month' GROUP BY b.status`,
  'categories with booking count': `SELECT c.*, (SELECT count(*)::int FROM bookings b WHERE b.category_id=c.id) AS booking_count FROM booking_categories c WHERE c.active ORDER BY c.priority_level, c.name`,
  'venue conflict check': `SELECT b.id FROM bookings b WHERE b.venue_id=(SELECT id FROM venues LIMIT 1) AND b.status IN ('PENDING','CONFIRMED') AND b.starts_at < LOCALTIMESTAMP + interval '2 hours' AND b.ends_at > LOCALTIMESTAMP`,
  'notification feed (busiest user)': `SELECT * FROM notifications WHERE user_id=(SELECT user_id FROM notifications GROUP BY user_id ORDER BY count(*) DESC LIMIT 1) ORDER BY created_at DESC LIMIT 10`,
  'venue list with effective status': `SELECT v.id, CASE WHEN v.status <> 'AVAILABLE' THEN v.status ELSE COALESCE((SELECT m.status FROM venue_maintenance m WHERE m.venue_id=v.id AND m.restored_at IS NULL AND m.starts_at <= LOCALTIMESTAMP AND COALESCE(m.ends_at,'infinity'::timestamp) > LOCALTIMESTAMP ORDER BY m.starts_at DESC LIMIT 1),'AVAILABLE') END FROM venues v WHERE v.active ORDER BY v.name`,
};

(async () => {
  try {
    for (const [name, sql] of Object.entries(QUERIES)) {
      console.log(`\n=== ${name} ===`);
      try { const r = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`); console.log(r.rows.map((x) => x['QUERY PLAN']).join('\n')); }
      catch (e) { console.log(`(skipped: ${e.message})`); }
    }
    console.log('\n=== table and index sizes ===');
    const sz = await pool.query(`SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS est_rows, pg_size_pretty(pg_relation_size(c.oid)) AS size FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','i') ORDER BY pg_relation_size(c.oid) DESC LIMIT 60`);
    console.table(sz.rows);
    console.log('\n=== indexes never scanned since statistics reset (candidates to review, never drop blindly) ===');
    const un = await pool.query(`SELECT relname AS table, indexrelname AS index, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC`);
    console.table(un.rows);
  } finally { await pool.end(); }
})();
