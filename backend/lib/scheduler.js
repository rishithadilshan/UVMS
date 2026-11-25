const { processDueReminders, backfillReminders } = require('./reminders');
const { expirePending } = require('./bookings');
const { processWaitlist } = require('./waitlist');
const pool = require('../db/pool');

// Backend scheduler (independent of any browser). All jobs are idempotent and persisted in the database, so a restart,
// a missed tick or several API instances running at once cannot produce duplicate notifications.
let timer = null, running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const expired = await expirePending();
    await pool.query("UPDATE venue_change_requests SET status='CANCELLED', updated_at=now() WHERE status='PENDING' AND requested_starts_at <= LOCALTIMESTAMP");
    const reminders = await processDueReminders();
    const waitlisted = await processWaitlist();
    if (expired || reminders || waitlisted) console.log(`[scheduler] expired=${expired} reminders=${reminders} waitlist=${waitlisted}`);
  } catch (e) { console.error('[scheduler] tick failed:', e.message); } finally { running = false; }
}

async function start() {
  if (process.env.DISABLE_SCHEDULER === 'true') { console.log('[scheduler] disabled by DISABLE_SCHEDULER'); return; }
  try { const n = await backfillReminders(); if (n) console.log(`[scheduler] recovered ${n} missing reminder record(s)`); } catch (e) { console.error('[scheduler] backfill failed:', e.message); }
  await tick();
  timer = setInterval(tick, Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60)) * 1000);
  timer.unref();
  console.log('[scheduler] started');
}
const stop = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = { start, stop, tick };
