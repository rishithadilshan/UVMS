const jwt = require('jsonwebtoken');
const { q, asyncRoute } = require('./core');

const userSafe = (u) => { if (!u) return u; const { password_hash, ...rest } = u; return { ...rest, _id: rest.id }; };
const issueToken = (u) => jwt.sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30m', issuer: 'uvms-api', audience: 'uvms-client' });

/**
 * Authentication middleware. The role and approval status are ALWAYS reloaded from the database;
 * nothing the client sends (or a stale token claims) is trusted. Only APPROVED, active accounts pass.
 */
const auth = asyncRoute(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'uvms-api', audience: 'uvms-client' }); }
  catch { return res.status(401).json({ message: 'Invalid or expired session' }); }
  const r = await q('SELECT id,name,email,username,role,department_id,active,approved,status,registration_number FROM users WHERE id=$1', [payload.sub]);
  const u = r.rows[0];
  if (!u || !u.active || u.status !== 'APPROVED') return res.status(401).json({ message: 'Account is inactive or not approved' });
  req.user = userSafe(u);
  next();
});

/** Role-based authorization middleware, enforced on the server for every protected route. */
const roles = (...allowed) => (req, res, next) => (allowed.includes(req.user.role) ? next() : res.status(403).json({ message: 'Insufficient permissions' }));

module.exports = { auth, roles, issueToken, userSafe };
