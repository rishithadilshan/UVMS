const { q, pool } = require('./core');
const realtime = require('./realtime');
const mailer = require('./mailer');

/**
 * Creates one persistent in-app notification. `db` may be the pool or a transaction client; when it is a
 * transaction client the live push is deferred until after COMMIT. `dedupeKey` makes the call idempotent
 * (a second call with the same key is ignored), which prevents duplicate reminders/notifications.
 */
async function notify(db, userId, { title, message, type = 'GENERAL', link = '', entityType = null, entityId = null, dedupeKey = null }) {
  if (!userId) return null;
  const r = await db.query(
    `INSERT INTO notifications(user_id,title,message,type,link,entity_type,entity_id,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *, created_at AS "createdAt", id AS _id`,
    [userId, title, message, type, link, entityType, entityId ? String(entityId) : null, dedupeKey]);
  const row = r.rows[0];
  if (!row) return null;
  const emit = () => realtime.push(userId, 'notification', row);
  if (db._after) db._after.push(emit); else emit();
  return row;
}

async function notifyAdmins(db, { title, message, type = 'GENERAL', link = '', entityType = null, entityId = null }) {
  const r = await db.query(
    `INSERT INTO notifications(user_id,title,message,type,link,entity_type,entity_id)
     SELECT id,$1,$2,$3,$4,$5,$6 FROM users WHERE role='ADMIN' AND active=true AND status='APPROVED'
     RETURNING *, created_at AS "createdAt", id AS _id`,
    [title, message, type, link, entityType, entityId ? String(entityId) : null]);
  for (const row of r.rows) {
    const emit = () => realtime.push(row.user_id, 'notification', row);
    if (db._after) db._after.push(emit); else emit();
  }
  return r.rows;
}

/** Sends an email (or logs it when SMTP is not configured). Always recorded in email_log. */
function email(db, to, subject, body) {
  const send = () => mailer.send(to, subject, body);
  if (db && db._after) db._after.push(send); else send().catch(() => {});
}

module.exports = { notify, notifyAdmins, email, pool, q };
