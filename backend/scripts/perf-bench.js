// Measures dashboard loading as the browser sees it: wall-clock time and number of API requests for each role.
//   BENCH_BASE=http://localhost:8080/api BENCH_RUNS=20 \
//   BENCH_ADMIN="admin@uni.lk:Password" BENCH_LECTURER="..." BENCH_INSTRUCTOR="..." BENCH_STUDENT="..." node scripts/perf-bench.js
// ("email:password" per role; roles without credentials are skipped.) Raise GENERAL_RATE_LIMIT on the test server first:
// the default 100 requests / 15 min per IP would otherwise rate-limit the benchmark itself.
// Admin: old behaviour = AppShell overview call + Overview page call (2 identical requests); new = 1 shared request.
// Others: old behaviour = 3 separate calls; new = GET /dashboard/summary.
const BASE = process.env.BENCH_BASE || 'http://localhost:5050/api';
const RUNS = Number(process.env.BENCH_RUNS || 20);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function login(cred) {
  const [email, ...rest] = cred.split(':');
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: rest.join(':') }) });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.status}`);
  return (await r.json()).token;
}
const get = (token, path) => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => { if (!r.ok) throw new Error(`${path} -> ${r.status}`); return r.json(); });

const SCENARIOS = {
  ADMIN: {
    old: (t) => [get(t, '/admin/overview'), get(t, '/admin/overview')],
    new: (t) => [get(t, '/admin/overview')],
  },
  OTHER: {
    old: (t) => [get(t, '/bookings?time=upcoming&pageSize=6'), get(t, '/bookings?status=PENDING&pageSize=1'), get(t, '/venue-changes?box=incoming&status=PENDING&pageSize=1')],
    new: (t) => [get(t, '/dashboard/summary')],
  },
};

(async () => {
  const roles = [['ADMIN', 'BENCH_ADMIN', 'ADMIN'], ['LECTURER', 'BENCH_LECTURER', 'OTHER'], ['INSTRUCTOR', 'BENCH_INSTRUCTOR', 'OTHER'], ['STUDENT', 'BENCH_STUDENT', 'OTHER']];
  const rows = [];
  for (const [label, env, kind] of roles) {
    if (!process.env[env]) { rows.push({ role: label, note: `skipped (set ${env})` }); continue; }
    const token = await login(process.env[env]);
    for (const variant of ['old', 'new']) {
      const times = [];
      await Promise.all(SCENARIOS[kind][variant](token)); // warm-up
      for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); await Promise.all(SCENARIOS[kind][variant](token)); times.push(performance.now() - t0); }
      rows.push({ role: label, variant, requests: SCENARIOS[kind][variant](token).length, p50_ms: pct(times, 50).toFixed(1), p95_ms: pct(times, 95).toFixed(1), runs: RUNS });
    }
  }
  console.table(rows);
})().catch((e) => { console.error(e.message); process.exit(1); });
