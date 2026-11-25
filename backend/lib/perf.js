// Lightweight API / database timing (no extra dependency).
//  - per request: total time, database time (incl. pool wait), number of queries, backend (non-DB) time
//  - slow requests and slow queries are logged once each; nothing else is logged unless PERF_LOG_ALL=true
//  - only the route pattern is logged (e.g. "GET /api/bookings/:id"): never query strings, headers, tokens or SQL parameter values
// Settings (all optional): SLOW_REQUEST_MS=500  SLOW_QUERY_MS=250  PERF_LOG_ALL=false  PERF_SERVER_TIMING=false  PERF_DISABLED=false
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== undefined && v !== '' ? Number(v) : d);
const SLOW_REQUEST_MS = num(process.env.SLOW_REQUEST_MS, 500);
const SLOW_QUERY_MS = num(process.env.SLOW_QUERY_MS, 250);
const LOG_ALL = process.env.PERF_LOG_ALL === 'true';
const SERVER_TIMING = process.env.PERF_SERVER_TIMING === 'true';
const DISABLED = process.env.PERF_DISABLED === 'true';
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

/** Wraps a promise-returning query function so its duration is added to the current request's counters. */
function timedQuery(fn) {
  if (DISABLED) return fn;
  return function timed(...args) {
    const store = als.getStore();            // captured at call time: always the calling request
    const t0 = process.hrtime.bigint();
    const text = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '';
    const done = () => {
      const d = ms(t0);
      if (store) { store.dbMs += d; store.dbCount += 1; }
      if (d >= SLOW_QUERY_MS) console.warn(`[slow-query] ${d.toFixed(0)}ms ${String(text).replace(/\s+/g, ' ').slice(0, 140)}`);
    };
    const r = fn.apply(this, args);
    if (r && typeof r.then === 'function') r.then(done, done);
    return r;
  };
}

function middleware(pool) {
  return (req, res, next) => {
    if (DISABLED || req.originalUrl.startsWith('/api/notifications/stream')) return next(); // SSE stays open for hours
    const store = { t0: process.hrtime.bigint(), dbMs: 0, dbCount: 0 };
    if (SERVER_TIMING) {
      const writeHead = res.writeHead;
      res.writeHead = function patched(...a) {
        if (!res.headersSent) {
          const total = ms(store.t0);
          res.setHeader('Server-Timing', `db;dur=${store.dbMs.toFixed(1)}, app;dur=${Math.max(0, total - store.dbMs).toFixed(1)}, total;dur=${total.toFixed(1)}`);
          res.setHeader('X-DB-Queries', String(store.dbCount));
        }
        return writeHead.apply(this, a);
      };
    }
    res.on('finish', () => {
      const total = ms(store.t0);
      if (!LOG_ALL && total < SLOW_REQUEST_MS) return;
      const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : (req.baseUrl ? `${req.baseUrl} (middleware)` : '(unmatched)');
      console.warn(`[${total >= SLOW_REQUEST_MS ? 'slow-request' : 'request'}] ${req.method} ${route} ${res.statusCode} total=${total.toFixed(0)}ms db=${store.dbMs.toFixed(0)}ms(${store.dbCount}q) app=${Math.max(0, total - store.dbMs).toFixed(0)}ms pool_waiting=${pool ? pool.waitingCount : '?'}`);
    });
    als.run(store, next);
  };
}

module.exports = { timedQuery, middleware, als, SLOW_QUERY_MS, SLOW_REQUEST_MS };
