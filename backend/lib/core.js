const { validationResult } = require('express-validator');
const pool = require('../db/pool');
const { timedQuery } = require('./perf');

const q = (text, values = []) => pool.query(text, values);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Runs fn inside a transaction. fn(client, after) — `after(cb)` queues a callback that runs only after COMMIT. */
async function tx(fn) {
  const c = await pool.connect();
  const afterCommit = [];
  c._after = afterCommit;
  c.query = timedQuery(c.constructor.prototype.query.bind(c)); // timing for this checkout only; removed in finally
  try {
    await c.query('BEGIN');
    const out = await fn(c, (cb) => afterCommit.push(cb));
    await c.query('COMMIT');
    for (const cb of afterCommit) { try { await cb(); } catch (e) { console.error('[after-commit]', e.message); } }
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c._after = null;
    delete c.query;
    c.release();
  }
}

const validate = (...rules) => [...rules, (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg === 'Invalid value' ? `Invalid ${errors.array()[0].path}` : errors.array()[0].msg, errors: errors.array() });
  next();
}];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID_RE.test(String(v || ''));
const idParam = (req, res, next) => (isUuid(req.params.id) ? next() : res.status(400).json({ message: 'Invalid identifier' }));

const audit = (req, action, type, id, metadata = {}) =>
  q('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,ip) VALUES($1,$2,$3,$4,$5,$6)',
    [req?.user?.id || null, action, type, id || null, JSON.stringify(metadata), req?.ip || null]).catch((e) => console.error('audit write failed', e.message));
/** Audit write that participates in a transaction (used for administrative decisions). */
const auditTx = (c, actorId, action, type, id, metadata = {}) =>
  c.query('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)', [actorId || null, action, type, id || null, JSON.stringify(metadata)]);

/** Pagination helper: ?page=1&pageSize=20 (max 100). */
function paging(query, defaultSize = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

async function getSetting(key, fallback, c = pool) {
  const r = await c.query('SELECT value FROM app_settings WHERE key=$1', [key]);
  return r.rowCount ? r.rows[0].value : fallback;
}

const ROLE_LABEL = { ADMIN: 'Admin', LECTURER: 'Lecturer', INSTRUCTOR: 'Instructor', STUDENT: 'Student', LAB_ASSISTANT: 'Lab Assistant' };
/** Roles that book directly (no admin approval). */
const DIRECT_BOOKING_ROLES = ['LECTURER', 'INSTRUCTOR', 'LAB_ASSISTANT'];
const BOOKING_ROLES = [...DIRECT_BOOKING_ROLES, 'STUDENT'];

module.exports = { pool, q, tx, asyncRoute, httpError, validate, isUuid, idParam, audit, auditTx, paging, getSetting, ROLE_LABEL, DIRECT_BOOKING_ROLES, BOOKING_ROLES };
