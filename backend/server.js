const app = require('./app');
const pool = require('./db/pool');
const scheduler = require('./lib/scheduler');

const port = Number(process.env.PORT || 5050);
let server;
pool.query('SELECT 1').then(() => {
  server = app.listen(port, '0.0.0.0', () => { console.log(`[api] listening on ${port}`); scheduler.start(); });
}).catch((err) => { console.error('[startup] database connection failed:', err.message); process.exit(1); });

const shutdown = async () => {
  scheduler.stop();
  if (server) { server.close(async () => { await pool.end(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
  else { await pool.end(); process.exit(0); }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
