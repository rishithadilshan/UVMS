const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { q, asyncRoute, validate, audit } = require('../lib/core');
const { auth, issueToken, userSafe } = require('../lib/auth');
const { notifyAdmins } = require('../lib/notify');

const router = express.Router();
const PUBLIC_ROLES = ['LECTURER', 'INSTRUCTOR', 'STUDENT']; // Admin can NEVER be created through public registration

router.post('/register', validate(
  body('name').trim().isLength({ min: 2, max: 160 }).withMessage('Full name is required'),
  body('email').isEmail().withMessage('A valid email address is required').normalizeEmail(),
  body('role').isIn(PUBLIC_ROLES).withMessage('Role must be Lecturer, Instructor or Student'),
  body('password').isString().isLength({ min: 8, max: 12 }).withMessage('Password must be 8 to 12 characters long'),
  body('confirmPassword').custom((v, { req }) => v === req.body.password).withMessage('Passwords do not match'),
  body('registrationNumber').if(body('role').equals('STUDENT')).trim().matches(/^[A-Za-z0-9][A-Za-z0-9/._-]{2,39}$/).withMessage('A valid registration number is required for students'),
), asyncRoute(async (req, res) => {
  const { name, email, password, role } = req.body;
  const registrationNumber = role === 'STUDENT' ? String(req.body.registrationNumber).trim() : null; // never stored for other roles
  const domain = email.split('@').pop().toLowerCase();
  const allowed = (process.env.ALLOWED_REGISTRATION_DOMAINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(domain)) return res.status(403).json({ message: 'Registration is restricted to approved university email domains' });
  const dupEmail = await q('SELECT 1 FROM users WHERE email=$1', [email]);
  if (dupEmail.rowCount) return res.status(409).json({ message: 'An account with this email already exists' });
  if (registrationNumber) {
    const dupReg = await q('SELECT 1 FROM users WHERE lower(registration_number)=lower($1)', [registrationNumber]);
    if (dupReg.rowCount) return res.status(409).json({ message: 'This registration number is already registered' });
  }
  const hash = await bcrypt.hash(password, 12);
  let user;
  try {
    // role and status are decided here on the server: the account always starts as PENDING.
    const r = await q("INSERT INTO users(name,email,password_hash,role,status,registration_number) VALUES($1,$2,$3,$4,'PENDING',$5) RETURNING id,name,email,role", [name, email, hash, role, registrationNumber]);
    user = r.rows[0];
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Email or registration number is already registered' });
    throw e;
  }
  await notifyAdmins(require('../db/pool'), { title: 'New registration request', message: `${name} (${role.toLowerCase()}) registered and is waiting for approval.`, type: 'REGISTRATION_REQUEST', link: '/admin/registrations', entityType: 'USER', entityId: user.id });
  await audit({ user: null, ip: req.ip }, 'REGISTER', 'USER', user.id, { role });
  res.status(201).json({ message: 'Registration submitted. You can sign in after an administrator approves your account.' });
}));

router.post('/login', validate(body('email').isString().trim().isLength({ min: 1, max: 254 }), body('password').isString().isLength({ min: 1, max: 128 })), asyncRoute(async (req, res) => {
  const identifier = req.body.email.trim().toLowerCase();
  const r = identifier.includes('@')
    ? await q('SELECT * FROM users WHERE lower(email)=$1', [identifier])
    : await q('SELECT * FROM users WHERE lower(username)=$1', [identifier]);
  const u = r.rows.length === 1 ? r.rows[0] : null;
  const ok = u && (await bcrypt.compare(req.body.password, u.password_hash));
  if (!ok || !u.active) return res.status(401).json({ message: 'Invalid credentials' });
  // The password is correct from here on, so the status can be reported without leaking account existence.
  if (u.status === 'PENDING') return res.status(403).json({ code: 'ACCOUNT_PENDING', message: 'Your registration is still waiting for administrator approval.' });
  if (u.status === 'REJECTED') return res.status(403).json({ code: 'ACCOUNT_REJECTED', message: `Your registration was rejected.${u.rejection_reason ? ` Reason: ${u.rejection_reason}` : ''}` });
  const welcome = u.approval_notice_pending;
  if (welcome) await q('UPDATE users SET approval_notice_pending=false WHERE id=$1', [u.id]);
  const safe = userSafe(u);
  delete safe.rejection_reason;
  res.json({ token: issueToken(safe), user: safe, message: welcome ? 'Your registration has been approved. Welcome to UVMS!' : undefined });
}));

router.get('/me', auth, asyncRoute(async (req, res) => res.json({ user: req.user })));

module.exports = router;
