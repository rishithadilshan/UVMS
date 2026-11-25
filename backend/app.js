require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const pool = require('./db/pool');
const { q, asyncRoute } = require('./lib/core');

const required = ['DATABASE_URL', 'JWT_SECRET', 'CLIENT_URL'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required; refusing to start with unsafe defaults`);
if (/replace_with|change_this|password_here/i.test(process.env.DATABASE_URL)) throw new Error('DATABASE_URL contains a placeholder; configure a real database credential');
if (process.env.JWT_SECRET.length < 32 || /replace|change_this|example/i.test(process.env.JWT_SECRET)) throw new Error('JWT_SECRET must be a newly generated secret of at least 32 characters; placeholder values are rejected');
if (process.env.NODE_ENV === 'production' && (!process.env.ALLOWED_REGISTRATION_DOMAINS || /your-university|example/i.test(process.env.ALLOWED_REGISTRATION_DOMAINS))) throw new Error('Set real ALLOWED_REGISTRATION_DOMAINS in production to restrict public registration');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.use(require('./lib/perf').middleware(pool));
const allowedOrigins = process.env.CLIENT_URL.split(',').map((v) => v.trim()).filter(Boolean);
app.use(helmet());
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.includes(origin)) return cb(null, true); return cb(Object.assign(new Error('Origin not allowed by CORS'), { status: 403 })); }, credentials: false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false }));
const { generalLimiter } = require("./middleware/rateLimiter");
app.use("/api", generalLimiter);
app.get('/api/health', asyncRoute(async (req, res) => { await q('SELECT 1'); res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() }); }));

const categories = require('./routes/categories');
const bookings = require('./routes/bookings');
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use(require('./routes/legacy'));                       // legacy slot/request/exchange APIs (full /api/... paths)
app.use('/api/bookings', bookings);
app.use('/api/modification-requests', bookings.modRouter);
app.use('/api/venue-changes', require('./routes/venueChanges'));
app.use('/api/categories', categories);
app.use('/api/priority', categories.priority);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use((req, res) => res.status(404).json({ message: 'API endpoint not found' }));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ message: err.message, ...(err.reasons ? { reasons: err.reasons } : {}), ...(err.conflicts ? { conflicts: err.conflicts } : {}), ...(err.affected ? { affected: err.affected, code: err.code } : {}) });
  console.error('[api error]', err.message);
  if (err.code === '23P01') return res.status(409).json({ message: 'The venue is already booked or reserved for that time' });
  if (err.code === '23505') return res.status(409).json({ message: 'A conflicting or duplicate record already exists' });
  if (err.code === '23503') return res.status(400).json({ message: 'Referenced record does not exist' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ message: 'Invalid input value' });
  res.status(err.status || 500).json({ message: (err.status || 500) >= 500 ? 'An unexpected server error occurred' : err.message });
});

module.exports = app;
