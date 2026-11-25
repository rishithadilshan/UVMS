const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { q, tx, asyncRoute, validate, idParam, audit, auditTx, paging } = require('../lib/core');
const { auth, roles } = require('../lib/auth');
const { notify, email } = require('../lib/notify');

const router = express.Router();
const ALL_ROLES = ['ADMIN', 'LECTURER', 'INSTRUCTOR', 'STUDENT', 'LAB_ASSISTANT'];
const COLS = 'id,name,email,role,department_id,active,status,registration_number,rejection_reason,reviewed_at,created_at';
const norm = (r) => ({ ...r, _id: r.id, approved: r.status === 'APPROVED' });

router.use(auth, roles('ADMIN'));

// ----- Registration approval queue -----
router.get('/registrations', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query);
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'PENDING';
  const total = (await q('SELECT count(*)::int AS n FROM users WHERE status=$1', [status])).rows[0].n;
  const r = await q(`SELECT ${COLS} FROM users WHERE status=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [status, limit, offset]);
  res.json({ items: r.rows.map(norm), total, page, pageSize });
}));

router.post('/registrations/:id/approve', idParam, asyncRoute(async (req, res) => {
  const out = await tx(async (c, after) => {
    const u = (await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
    if (!u) return { status: 404, message: 'User not found' };
    if (u.status !== 'PENDING') return { status: 409, message: `This registration is already ${u.status.toLowerCase()}` };
    await c.query("UPDATE users SET status='APPROVED', reviewed_by=$2, reviewed_at=now(), rejection_reason='', approval_notice_pending=true, updated_at=now() WHERE id=$1", [u.id, req.user.id]);
    await notify(c, u.id, { title: 'Registration approved', message: 'Your account has been approved. You can now use the venue management system.', type: 'REGISTRATION_APPROVED', link: '/', entityType: 'USER', entityId: u.id });
    email(c, u.email, 'Your UVMS registration was approved', `Hello ${u.name},\n\nYour University Venue Management System account has been approved. You can now sign in.\n`);
    await auditTx(c, req.user.id, 'APPROVE_REGISTRATION', 'USER', u.id, { role: u.role });
    return { status: 200, message: 'Registration approved' };
  });
  res.status(out.status).json({ message: out.message });
}));

router.post('/registrations/:id/reject', idParam, validate(body('reason').optional().isString().isLength({ max: 500 })), asyncRoute(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  const out = await tx(async (c, after) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!u) return { status: 404, message: 'User not found' };
    if (u.status !== 'PENDING') return { status: 409, message: `This registration is already ${u.status.toLowerCase()}` };
    await c.query("UPDATE users SET status='REJECTED', reviewed_by=$2, reviewed_at=now(), rejection_reason=$3, updated_at=now() WHERE id=$1", [u.id, req.user.id, reason]);
    await notify(c, u.id, { title: 'Registration rejected', message: `Your registration was rejected.${reason ? ` Reason: ${reason}` : ''}`, type: 'REGISTRATION_REJECTED', entityType: 'USER', entityId: u.id });
    email(c, u.email, 'Your UVMS registration was not approved', `Hello ${u.name},\n\nYour registration was not approved.${reason ? `\nReason: ${reason}` : ''}\n`);
    await auditTx(c, req.user.id, 'REJECT_REGISTRATION', 'USER', u.id, { reason });
    return { status: 200, message: 'Registration rejected' };
  });
  res.status(out.status).json({ message: out.message });
}));

// ----- User management -----
router.get('/', asyncRoute(async (req, res) => {
  const vals = [], cond = [];
  if (req.query.role) { vals.push(req.query.role); cond.push(`role=$${vals.length}`); }
  if (req.query.status) { vals.push(req.query.status); cond.push(`status=$${vals.length}`); }
  if (req.query.q) { vals.push(`%${String(req.query.q).toLowerCase()}%`); cond.push(`(lower(name) LIKE $${vals.length} OR lower(email) LIKE $${vals.length} OR lower(COALESCE(registration_number,'')) LIKE $${vals.length})`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  if (!req.query.page) { // legacy callers expect a plain array
    const r = await q(`SELECT ${COLS} FROM users ${where} ORDER BY name`, vals);
    return res.json(r.rows.map(norm));
  }
  const { page, pageSize, limit, offset } = paging(req.query);
  const total = (await q(`SELECT count(*)::int AS n FROM users ${where}`, vals)).rows[0].n;
  const r = await q(`SELECT ${COLS} FROM users ${where} ORDER BY name LIMIT ${limit} OFFSET ${offset}`, vals);
  res.json({ items: r.rows.map(norm), total, page, pageSize });
}));

// Secure administrative creation of any account (the only HTTP route that can create an ADMIN).
router.post('/', validate(
  body('name').trim().isLength({ min: 2, max: 160 }), body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 12, max: 72 }).withMessage('Admin-created accounts need a password of at least 12 characters').custom((v) => Buffer.byteLength(v, 'utf8') <= 72),
  body('role').isIn(ALL_ROLES),
), asyncRoute(async (req, res) => {
  const { name, email, password, role, department_id, registrationNumber } = req.body;
  if (role === 'STUDENT' && !registrationNumber) return res.status(400).json({ message: 'A registration number is required for students' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const r = await q(`INSERT INTO users(name,email,password_hash,role,department_id,status,registration_number) VALUES($1,$2,$3,$4,$5,'APPROVED',$6) RETURNING ${COLS}`, [name, email, hash, role, department_id || null, role === 'STUDENT' ? registrationNumber : null]);
    await audit(req, 'CREATE', 'USER', r.rows[0].id, { role });
    res.status(201).json(norm(r.rows[0]));
  } catch (e) { if (e.code === '23505') return res.status(409).json({ message: 'Email or registration number already registered' }); throw e; }
}));

async function lastAdminGuard(id) {
  const count = (await q("SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND active=true AND status='APPROVED'")).rows[0].n;
  return count <= 1;
}

router.put('/:id', idParam, asyncRoute(async (req, res) => {
  const { name, role, active, department_id } = req.body;
  if (role && !ALL_ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (req.params.id === req.user.id && ((role && role !== 'ADMIN') || active === false)) return res.status(400).json({ message: 'You cannot demote or deactivate your own administrator account' });
  const cur = (await q('SELECT role FROM users WHERE id=$1', [req.params.id])).rows[0];
  if (!cur) return res.status(404).json({ message: 'User not found' });
  if (cur.role === 'ADMIN' && ((role && role !== 'ADMIN') || active === false) && (await lastAdminGuard())) return res.status(409).json({ message: 'At least one active administrator must remain' });
  const r = await q(`UPDATE users SET name=COALESCE($2,name), role=COALESCE($3,role), active=COALESCE($4,active), department_id=COALESCE($5,department_id), updated_at=now() WHERE id=$1 RETURNING ${COLS}`, [req.params.id, name, role, active, department_id]);
  await audit(req, 'UPDATE', 'USER', req.params.id, { role, active });
  res.json(norm(r.rows[0]));
}));

router.delete('/:id', idParam, asyncRoute(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot delete your own account' });
  const target = (await q('SELECT role FROM users WHERE id=$1', [req.params.id])).rows[0];
  if (!target) return res.status(404).json({ message: 'User not found' });
  if (target.role === 'ADMIN' && (await lastAdminGuard())) return res.status(409).json({ message: 'At least one active administrator must remain' });
  await q('UPDATE users SET active=false, updated_at=now() WHERE id=$1', [req.params.id]);
  await audit(req, 'DEACTIVATE', 'USER', req.params.id);
  res.json({ message: 'User deactivated' });
}));

module.exports = router;
