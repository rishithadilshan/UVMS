const { Pool, types } = require('pg');
const { timedQuery } = require('../lib/perf');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

// Booking times are naive Asia/Colombo wall-clock values. Return DATE and TIMESTAMP columns as raw
// strings ("2026-11-25", "2026-11-25 12:30:00") so no JavaScript time-zone conversion can shift them.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);

const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
  // Safety nets against runaway queries / leaked transactions (override or set to 0 to disable).
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000), idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS || 60000),
  application_name: 'uvms-api' });
pool.query = timedQuery(pool.query.bind(pool)); // per-request database timing (see lib/perf.js)
pool.on('connect', (client) => { client.query("SET TIME ZONE 'Asia/Colombo'").catch((e) => console.error('[db] set time zone failed:', e.message)); });
pool.on('error', (err) => console.error('[db] idle client error:', err.message));
module.exports = pool;
