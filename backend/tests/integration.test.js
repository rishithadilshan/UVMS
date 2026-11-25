// End-to-end API tests against a REAL PostgreSQL database (migrated with `npm run migrate`).
//   DATABASE_URL=postgresql://... JWT_SECRET=<32+ chars> CLIENT_URL=http://localhost:5173 npm run test:integration
// The tests create their own uniquely named users/venues and do not touch existing data.
process.env.NODE_ENV = 'test';
process.env.DISABLE_SCHEDULER = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) { console.log('Skipping integration tests: DATABASE_URL and JWT_SECRET are required'); process.exit(0); }
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const bcrypt = require('bcryptjs');
const app = require('../app');
const pool = require('../db/pool');
const { colomboNow, addDays } = require('../lib/time');
const { expirePending } = require('../lib/bookings');
const { processDueReminders } = require('../lib/reminders');
const { processWaitlist } = require('../lib/waitlist');

const tag = Date.now().toString(36);
let base, server;
const S = {}; // shared state across ordered sub-tests
const day = (n) => addDays(colomboNow().date, n);

async function call(method, path, token, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}
const login = async (email, password) => (await call('POST', '/auth/login', null, { email, password }));
async function seedUser(role, name, password = 'AdminPass#12345') {
  const email = `${role.toLowerCase()}.${tag}.${Math.random().toString(36).slice(2, 6)}@test.local`;
  const r = await pool.query("INSERT INTO users(name,email,password_hash,role,status) VALUES($1,$2,$3,$4,'APPROVED') RETURNING id", [name, email, await bcrypt.hash(password, 4), role]);
  const l = await login(email, password);
  return { id: r.rows[0].id, email, password, token: l.body.token };
}

test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.close(); await pool.end(); });

test('registration + approval workflow', async (t) => {
  S.admin = await seedUser('ADMIN', 'Test Admin');
  const reg = (o = {}) => call('POST', '/auth/register', null, { name: 'Reg User', email: `reg.${tag}.${Math.random().toString(36).slice(2, 6)}@test.local`, role: 'LECTURER', password: 'Passw0rd!', confirmPassword: 'Passw0rd!', ...o });

  await t.test('lecturer / instructor / student can register as PENDING', async () => {
    S.lecEmail = `lec.${tag}@test.local`;
    assert.equal((await reg({ email: S.lecEmail, role: 'LECTURER' })).status, 201);
    S.insEmail = `ins.${tag}@test.local`;
    assert.equal((await reg({ email: S.insEmail, role: 'INSTRUCTOR' })).status, 201);
    S.stuEmail = `stu.${tag}@test.local`; S.regNo = `EG/${tag}/1`;
    assert.equal((await reg({ email: S.stuEmail, role: 'STUDENT', registrationNumber: S.regNo })).status, 201);
  });
  await t.test('validation: admin role, password length, student number, duplicates', async () => {
    assert.equal((await reg({ role: 'ADMIN' })).status, 400);
    assert.equal((await reg({ password: 'short', confirmPassword: 'short' })).status, 400);
    assert.equal((await reg({ password: 'waytoolongpassword1', confirmPassword: 'waytoolongpassword1' })).status, 400);
    assert.equal((await reg({ role: 'STUDENT' })).status, 400, 'student needs registration number');
    assert.equal((await reg({ email: S.lecEmail })).status, 409, 'duplicate email');
    assert.equal((await reg({ role: 'STUDENT', registrationNumber: S.regNo.toLowerCase() })).status, 409, 'duplicate registration number');
  });
  await t.test('pending users cannot log in; admin is notified', async () => {
    const l = await login(S.lecEmail, 'Passw0rd!');
    assert.equal(l.status, 403); assert.equal(l.body.code, 'ACCOUNT_PENDING');
    const n = await call('GET', '/notifications?page=1', S.admin.token);
    assert.ok(n.body.items.some((x) => x.type === 'REGISTRATION_REQUEST'));
  });
  await t.test('admin approves / rejects; approved can log in, rejected cannot', async () => {
    const list = await call('GET', '/users/registrations?status=PENDING&pageSize=100', S.admin.token);
    const find = (e) => list.body.items.find((u) => u.email === e);
    for (const e of [S.lecEmail, S.insEmail, S.stuEmail]) assert.equal((await call('POST', `/users/registrations/${find(e).id}/approve`, S.admin.token)).status, 200);
    const l = await login(S.lecEmail, 'Passw0rd!');
    assert.equal(l.status, 200); assert.match(l.body.message, /approved/i);
    const byUsername = await login(S.lecEmail.split('@')[0], 'Passw0rd!');
    assert.equal(byUsername.status, 200); assert.equal(byUsername.body.user.id, l.body.user.id);
    assert.equal((await login(S.lecEmail, 'Passw0rd!')).status, 200, 'email login remains available');
    S.lec = { token: l.body.token, id: l.body.user.id }; S.ins = { token: (await login(S.insEmail, 'Passw0rd!')).body.token }; S.stu = { token: (await login(S.stuEmail, 'Passw0rd!')).body.token, id: find(S.stuEmail).id };
    const rejEmail = `rej.${tag}@test.local`; await reg({ email: rejEmail });
    const pend = await call('GET', '/users/registrations?pageSize=100', S.admin.token);
    const id = pend.body.items.find((u) => u.email === rejEmail).id;
    assert.equal((await call('POST', `/users/registrations/${id}/reject`, S.admin.token, { reason: 'Not eligible' })).status, 200);
    const r = await login(rejEmail, 'Passw0rd!');
    assert.equal(r.status, 403); assert.equal(r.body.code, 'ACCOUNT_REJECTED');
  });
  await t.test('role based access is enforced on the server', async () => {
    assert.equal((await call('GET', '/users', S.stu.token)).status, 403);
    assert.equal((await call('POST', '/venues', S.lec.token, { name: 'x', capacity: 5, type: 'Room' })).status, 403);
    assert.equal((await call('GET', '/reports/summary', S.lec.token)).status, 403);
    assert.equal((await call('GET', '/bookings')).status, 401);
  });
});

test('venues, categories and booking rules', async (t) => {
  const v = await call('POST', '/venues', S.admin.token, { name: `Hall A ${tag}`, capacity: 60, type: 'Lecture Hall', building: 'Test Block', facilities: ['Projector', 'Whiteboard'] });
  assert.equal(v.status, 201); S.v1 = v.body.id;
  S.v2 = (await call('POST', '/venues', S.admin.token, { name: `Hall B ${tag}`, capacity: 60, type: 'Lecture Hall', building: 'Test Block', facilities: ['Projector', 'Whiteboard'] })).body.id;
  assert.equal((await call('POST', '/venues', S.admin.token, { name: `hall a ${tag}`, capacity: 10, type: 'x1' })).status, 409, 'duplicate venue name');
  assert.equal((await call('POST', '/venues', S.admin.token, { name: 'Bad', capacity: 0, type: 'Room' })).status, 400, 'invalid capacity');
  const cats = await call('GET', '/categories', S.lec.token);
  assert.ok(cats.body.length >= 4); S.cat = cats.body.find((c) => c.name === 'Academic Activities').id;
  const D = day(30);
  const book = (token, o = {}) => call('POST', '/bookings', token, { venueId: S.v1, date: D, startTime: '12:30', endTime: '15:30', participants: 30, categoryId: S.cat, purpose: 'Lecture', facilities: ['Projector'], justification: 'Needed for the final year module delivery', ...o });

  await t.test('lecturer books directly -> CONFIRMED (no approval)', async () => { const r = await book(S.lec.token); assert.equal(r.status, 201); assert.equal(r.body.booking.status, 'CONFIRMED'); S.b1 = r.body.booking.id; });
  await t.test('overlapping booking rejected, adjacent booking accepted', async () => {
    assert.equal((await book(S.ins.token, { startTime: '14:00', endTime: '16:00' })).status, 409);
    assert.equal((await book(S.ins.token, { startTime: '15:30', endTime: '17:00' })).status, 201);
    assert.equal((await book(S.ins.token, { startTime: '10:00', endTime: '12:30' })).status, 201);
  });
  await t.test('capacity, facilities, past and time-order validation', async () => {
    assert.equal((await book(S.lec.token, { participants: 500, startTime: '18:00', endTime: '19:00' })).status, 400);
    assert.equal((await book(S.lec.token, { facilities: ['Smart Board'], startTime: '18:00', endTime: '19:00' })).status, 409);
    assert.equal((await book(S.lec.token, { date: day(-1) })).status, 400);
    assert.equal((await book(S.lec.token, { startTime: '15:00', endTime: '14:00' })).status, 400);
  });
  await t.test('student request is PENDING and reserves the venue', async () => {
    const r = await book(S.stu.token, { startTime: '18:00', endTime: '19:00' });
    assert.equal(r.status, 201); assert.equal(r.body.booking.status, 'PENDING'); S.sb = r.body.booking.id;
    assert.equal((await book(S.ins.token, { startTime: '18:30', endTime: '19:30' })).status, 409, 'pending request blocks others');
    assert.equal((await call('POST', `/bookings/${S.sb}/decision`, S.stu.token, { decision: 'APPROVE' })).status, 403, 'student cannot approve');
    assert.equal((await book(S.stu.token, { startTime: '20:00', endTime: '21:00', justification: '' })).status, 400, 'justification required');
  });
  await t.test('admin rejects (reason required) and the reservation is released', async () => {
    assert.equal((await call('POST', `/bookings/${S.sb}/decision`, S.admin.token, { decision: 'REJECT' })).status, 400);
    assert.equal((await call('POST', `/bookings/${S.sb}/decision`, S.admin.token, { decision: 'REJECT', reason: 'Room needed for exam' })).status, 200);
    assert.equal((await book(S.ins.token, { startTime: '18:00', endTime: '19:00' })).status, 201, 'slot is free again');
  });
  await t.test('admin approves a student request', async () => {
    const r = await book(S.stu.token, { startTime: '20:00', endTime: '21:00' }); assert.equal(r.status, 201);
    assert.equal((await call('POST', `/bookings/${r.body.booking.id}/decision`, S.admin.token, { decision: 'APPROVE' })).status, 200);
    assert.equal((await call('GET', `/bookings/${r.body.booking.id}`, S.stu.token)).body.status, 'CONFIRMED');
  });
  await t.test('pending requests expire automatically', async () => {
    const r = await book(S.stu.token, { date: day(31), startTime: '09:00', endTime: '10:00' }); assert.equal(r.status, 201);
    await pool.query("UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id=$1", [r.body.booking.id]);
    await expirePending();
    assert.equal((await call('GET', `/bookings/${r.body.booking.id}`, S.stu.token)).body.status, 'EXPIRED');
    assert.equal((await book(S.ins.token, { date: day(31), startTime: '09:00', endTime: '10:00' })).status, 201);
  });
  await t.test('ownership: users cannot see or cancel others bookings', async () => {
    assert.equal((await call('GET', `/bookings/${S.b1}`, S.stu.token)).status, 403);
    assert.equal((await call('POST', `/bookings/${S.b1}/cancel`, S.stu.token, { reason: 'trying' })).status, 403);
  });
  await t.test('recurring booking reports conflicts per occurrence', async () => {
    const dow = new Date(`${D}T00:00:00Z`).getUTCDay();
    const r = await call('POST', '/bookings', S.lec.token, { venueId: S.v2, date: D, startTime: '08:00', endTime: '10:00', participants: 20, categoryId: S.cat, purpose: 'Weekly lecture', facilities: [], recurrence: { frequency: 'WEEKLY', endDate: addDays(D, 21), daysOfWeek: [dow] } });
    assert.equal(r.status, 201); assert.equal(r.body.bookings.length, 4);
    const r2 = await call('POST', '/bookings', S.ins.token, { venueId: S.v2, date: addDays(D, 7), startTime: '09:00', endTime: '11:00', participants: 20, categoryId: S.cat, purpose: 'x1 y', facilities: [] });
    assert.equal(r2.status, 409);
  });
  await t.test('cancellation: student needs approval for confirmed booking; owner can cancel own', async () => {
    const sbConfirmed = (await call('GET', '/bookings?status=CONFIRMED&pageSize=50', S.stu.token)).body.items[0];
    const c = await call('POST', `/bookings/${sbConfirmed.id}/cancel`, S.stu.token, { reason: 'No longer needed' });
    assert.equal(c.status, 202);
    assert.equal((await call('POST', `/bookings/${S.b1}/cancel`, S.lec.token, { reason: 'Moved online' })).status, 200);
    assert.equal((await call('GET', `/bookings/${S.b1}`, S.lec.token)).body.status, 'CANCELLED');
  });
});

test('venue maintenance', async () => {
  const D = day(40);
  const mk = (token) => call('POST', '/bookings', token, { venueId: S.v1, date: D, startTime: '10:00', endTime: '12:00', participants: 10, categoryId: S.cat, purpose: 'Seminar', facilities: [] });
  const b = await mk(S.lec.token); assert.equal(b.status, 201);
  const m = { venueId: S.v1, status: 'UNDER_MAINTENANCE', reason: 'AC repair', startsAt: `${D}T08:00`, endsAt: `${D}T18:00` };
  const first = await call('POST', '/maintenance', S.admin.token, m);
  assert.equal(first.status, 409); assert.equal(first.body.code, 'MAINTENANCE_CONFLICTS'); assert.equal(first.body.affected.length, 1);
  const forced = await call('POST', '/maintenance', S.admin.token, { ...m, force: true });
  assert.equal(forced.status, 201);
  assert.equal((await call('GET', `/bookings/${b.body.booking.id}`, S.lec.token)).body.status, 'CONFIRMED', 'affected booking is NOT cancelled');
  assert.ok((await call('GET', '/notifications?page=1', S.lec.token)).body.items.some((n) => n.type === 'MAINTENANCE_CONFLICT'));
  assert.equal((await mk(S.ins.token)).status, 409, 'cannot book during maintenance');
  const s = await call('GET', `/venues/search?date=${D}&startTime=13:00&endTime=14:00&participants=10`, S.ins.token);
  assert.ok(s.body.unavailable.some((v) => v.id === S.v1), 'maintenance venue is shown as unavailable with a reason');
  assert.equal((await call('POST', `/maintenance/${forced.body.record.id}/restore`, S.admin.token)).status, 200);
  const after = await call('GET', `/venues/search?date=${D}&startTime=13:00&endTime=14:00&participants=10`, S.ins.token);
  assert.ok(after.body.available.some((v) => v.id === S.v1));
});

test('search shows available and booked venues with the right privacy', async () => {
  const D = day(50);
  await call('POST', '/bookings', S.lec.token, { venueId: S.v1, date: D, startTime: '09:00', endTime: '11:00', participants: 20, categoryId: S.cat, purpose: 'Secret purpose', facilities: [] });
  const r = await call('GET', `/venues/search?date=${D}&startTime=10:00&endTime=12:00&participants=20&facilities=Projector`, S.stu.token);
  assert.equal(r.status, 200);
  assert.ok(r.body.available.some((v) => v.id === S.v2) && r.body.available[0].explanation);
  const booked = r.body.booked.find((v) => v.id === S.v1);
  assert.ok(booked && booked.partiallyAvailable.length, 'partial availability shown');
  assert.ok(!JSON.stringify(r.body).includes('Secret purpose'), 'purpose of other users is never exposed');
  assert.equal(booked.existingBookings[0].ownerEmail, undefined, 'students do not receive booker e-mail');
  const big = await call('GET', `/venues/search?date=${D}&startTime=10:00&endTime=12:00&participants=500`, S.stu.token);
  assert.equal(big.body.available.length + big.body.booked.length, 0, 'capacity failures are never shown');
});

test('reminders: short notice, no duplicates, none for cancelled', async () => {
  const now = colomboNow(); const [h] = now.time.split(':').map(Number);
  // tomorrow at a time less than 24h away => short-notice reminder
  const tomorrow = addDays(now.date, 1); const hh = String(Math.min(23, h)).padStart(2, '0');
  const mk = (st, en) => call('POST', '/bookings', S.lec.token, { venueId: S.v2, date: tomorrow, startTime: st, endTime: en, participants: 5, categoryId: S.cat, purpose: 'Reminder test', facilities: [] });
  const r = await mk(`${hh}:${now.time.split(':')[1]}`, '23:59'); if (r.status !== 201) return; // skip near midnight
  await processDueReminders(); await processDueReminders();
  const n = (await call('GET', '/notifications?page=1&pageSize=50', S.lec.token)).body.items.filter((x) => x.type === 'BOOKING_REMINDER' && x.entity_id === r.body.booking.id);
  assert.equal(n.length, 1, 'exactly one reminder, even when the scheduler runs twice');
  const rec = (await pool.query('SELECT status FROM booking_reminders WHERE booking_id=$1', [r.body.booking.id])).rows[0];
  assert.equal(rec.status, 'SENT');
  const D = day(60);
  const far = await call('POST', '/bookings', S.lec.token, { venueId: S.v2, date: D, startTime: '12:30', endTime: '15:30', participants: 5, categoryId: S.cat, purpose: 'Future', facilities: [] });
  const rem = (await pool.query('SELECT status, remind_at FROM booking_reminders WHERE booking_id=$1', [far.body.booking.id])).rows[0];
  assert.equal(rem.status, 'PENDING'); assert.equal(new Date(rem.remind_at).toISOString(), new Date(`${addDays(D, -1)}T12:30:00+05:30`).toISOString(), '24h before, Asia/Colombo');
  await call('POST', `/bookings/${far.body.booking.id}/modify`, S.lec.token, { startTime: '14:00', endTime: '16:00' });
  const rem2 = (await pool.query('SELECT remind_at FROM booking_reminders WHERE booking_id=$1', [far.body.booking.id])).rows[0];
  assert.equal(new Date(rem2.remind_at).toISOString(), new Date(`${addDays(D, -1)}T14:00:00+05:30`).toISOString(), 'recalculated after reschedule');
  await call('POST', `/bookings/${far.body.booking.id}/cancel`, S.lec.token, { reason: 'Cancel test' });
  assert.equal((await pool.query('SELECT status FROM booking_reminders WHERE booking_id=$1', [far.body.booking.id])).rows[0].status, 'CANCELLED');
});

test('venue change request: relocation keeps bookings consistent', async (t) => {
  const D = day(70);
  const own = await call('POST', '/bookings', S.lec.token, { venueId: S.v1, date: D, startTime: '10:00', endTime: '12:00', participants: 30, categoryId: S.cat, purpose: 'Owner class', facilities: ['Projector'] });
  assert.equal(own.status, 201); const target = own.body.booking.id;
  const body = { targetBookingId: target, date: D, startTime: '10:00', endTime: '12:00', participants: 25, categoryId: S.cat, purpose: 'Exam', facilities: ['Projector'], reason: 'Exam hall needed' };
  assert.equal((await call('POST', '/venue-changes', S.lec.token, body)).status, 400, 'cannot request own booking');
  const cr = await call('POST', '/venue-changes', S.ins.token, body); assert.equal(cr.status, 201); const id = cr.body.id;
  assert.ok((await call('GET', '/notifications?page=1&pageSize=50', S.lec.token)).body.items.some((n) => n.type === 'VENUE_CHANGE_REQUEST'), 'owner notified');
  await t.test('unauthorised users cannot respond', async () => {
    assert.equal((await call('POST', `/venue-changes/${id}/respond`, S.stu.token, { decision: 'REJECT' })).status, 403);
    assert.equal((await call('POST', `/venue-changes/${id}/respond`, S.ins.token, { decision: 'REJECT' })).status, 403);
  });
  await t.test('an invalid alternative is refused and nothing changes', async () => {
    const r = await call('POST', `/venue-changes/${id}/respond`, S.lec.token, { decision: 'ACCEPT', alternative: { venueId: S.v1, date: D, startTime: '10:00', endTime: '12:00' } });
    assert.equal(r.status, 409);
    assert.equal((await call('GET', `/bookings/${target}`, S.lec.token)).body.venue.id, S.v1);
  });
  await t.test('valid alternative moves the owner and books the requester', async () => {
    const r = await call('POST', `/venue-changes/${id}/respond`, S.lec.token, { decision: 'ACCEPT', message: 'Happy to help', alternative: { venueId: S.v2, date: D, startTime: '10:00', endTime: '12:00' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call('GET', `/bookings/${target}`, S.lec.token)).body.venue.id, S.v2);
    const nb = await call('GET', `/bookings/${r.body.newBookingId}`, S.ins.token);
    assert.equal(nb.body.venue.id, S.v1); assert.equal(nb.body.status, 'CONFIRMED');
    const overlaps = await pool.query("SELECT 1 FROM bookings a JOIN bookings b ON a.id<b.id AND a.venue_id=b.venue_id AND a.status IN ('PENDING','CONFIRMED') AND b.status IN ('PENDING','CONFIRMED') AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at WHERE a.venue_id = ANY($1)", [[S.v1, S.v2]]);
    assert.equal(overlaps.rowCount, 0, 'no overlapping reserving bookings exist');
  });
});

test('booking priority management', async () => {
  const c = await call('POST', '/categories', S.admin.token, { name: `Custom ${tag}`, description: 'x', priorityLevel: 2 });
  assert.equal(c.status, 201);
  assert.equal((await call('PUT', `/categories/${c.body.id}`, S.admin.token, { priorityLevel: 5, active: false })).body.priorityLevel, 5);
  assert.ok(!(await call('GET', '/categories', S.lec.token)).body.some((x) => x.id === c.body.id), 'inactive categories are not selectable');
  assert.equal((await call('POST', '/categories', S.lec.token, { name: 'Nope', priorityLevel: 1 })).status, 403);
  assert.equal((await call('POST', '/categories', S.admin.token, { name: `Custom ${tag}`, priorityLevel: 1 })).status, 409);
});

test('waitlist notifies but never books', async () => {
  const D = day(80);
  await call('POST', '/bookings', S.lec.token, { venueId: S.v1, date: D, startTime: '10:00', endTime: '12:00', participants: 10, categoryId: S.cat, purpose: 'Block', facilities: [] });
  const w = await call('POST', '/waitlist', S.ins.token, { venueId: S.v1, date: D, startTime: '10:00', endTime: '12:00', participants: 10 });
  assert.equal(w.status, 201);
  const blocking = (await call('GET', '/bookings?pageSize=100&time=upcoming', S.lec.token)).body.items.find((b) => b.purpose === 'Block');
  await call('POST', `/bookings/${blocking.id}/cancel`, S.lec.token, { reason: 'Freed' });
  await processWaitlist(S.v1);
  assert.ok((await call('GET', '/notifications?page=1&pageSize=50', S.ins.token)).body.items.some((n) => n.type === 'WAITLIST_AVAILABLE'));
  const mine = (await call('GET', '/bookings?pageSize=100&from=' + D + '&to=' + D, S.ins.token)).body.items;
  assert.equal(mine.length, 0, 'waitlist did not create a booking');
});

test('reports use real data and export', async () => {
  const r = await call('GET', '/reports/summary?period=monthly', S.admin.token);
  assert.equal(r.status, 200); assert.ok(r.body.totals.venues >= 2);
  const x = await fetch(`${base}/api/reports/export?period=custom&from=${day(0)}&to=${day(90)}&format=xlsx`, { headers: { Authorization: `Bearer ${S.admin.token}` } });
  assert.equal(x.status, 200); assert.equal(Buffer.from(await x.arrayBuffer()).readUInt32LE(0), 0x04034b50);
});
