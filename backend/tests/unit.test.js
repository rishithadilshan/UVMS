// Pure-logic unit tests (no database required): node --test tests/unit.test.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/none';
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/time');
const { rank, scoreVenue } = require('../lib/recommend');
const { facilitiesCover, missingFacilities, partialAvailability } = require('../lib/availability');
const { buildXlsx, toCsv, crc32 } = require('../lib/xlsx');

const now = { date: '2026-11-21', time: '10:00', stamp: '2026-11-21 10:00' };

test('booking window validation', () => {
  assert.deepEqual(t.validateWindow({ date: '2026-11-25', startTime: '12:30', endTime: '15:30' }, { now }), []);
  assert.match(t.validateWindow({ date: '2026-11-25', startTime: '15:30', endTime: '12:30' }, { now })[0], /later than start/);
  assert.match(t.validateWindow({ date: '2026-11-25', startTime: '12:30', endTime: '12:30' }, { now })[0], /later than start/);
  assert.match(t.validateWindow({ date: '2026-11-20', startTime: '12:30', endTime: '13:30' }, { now })[0], /past/);
  assert.match(t.validateWindow({ date: '2026-11-21', startTime: '09:00', endTime: '11:00' }, { now })[0], /past/);
  assert.ok(t.validateWindow({ date: '2026-02-30', startTime: '09:00', endTime: '11:00' }, { now }).length);
  assert.ok(t.validateWindow({ date: '2026-11-25', startTime: '25:00', endTime: '26:00' }, { now }).length);
});

test('overlap rule: newStart < existingEnd AND newEnd > existingStart', () => {
  const a = ['2026-11-25 12:30:00', '2026-11-25 15:30:00'];
  assert.equal(t.overlaps(...a, '2026-11-25 14:00:00', '2026-11-25 16:00:00'), true);
  assert.equal(t.overlaps(...a, '2026-11-25 15:30:00', '2026-11-25 17:00:00'), false, 'back-to-back bookings do not overlap');
  assert.equal(t.overlaps(...a, '2026-11-25 10:00:00', '2026-11-25 12:30:00'), false);
  assert.equal(t.overlaps(...a, '2026-11-25 13:00:00', '2026-11-25 14:00:00'), true, 'contained');
  assert.equal(t.overlaps(...a, '2026-11-25 08:00:00', '2026-11-25 18:00:00'), true, 'containing');
});

test('Asia/Colombo reminder time is 24h before start (UTC+05:30)', () => {
  assert.equal(t.reminderTime('2026-11-25 12:30:00', 24).toISOString(), '2026-11-24T07:00:00.000Z');
  assert.equal(t.reminderTime('2026-11-25 00:15:00', 24).toISOString(), '2026-11-23T18:45:00.000Z');
});

test('recurrence expansion', () => {
  assert.deepEqual(t.expandRecurrence({ frequency: 'WEEKLY', startDate: '2026-11-23', endDate: '2026-12-07', daysOfWeek: [1] }), ['2026-11-23', '2026-11-30', '2026-12-07']);
  assert.deepEqual(t.expandRecurrence({ frequency: 'BIWEEKLY', startDate: '2026-11-23', endDate: '2026-12-21', daysOfWeek: [1] }), ['2026-11-23', '2026-12-07', '2026-12-21']);
  assert.equal(t.expandRecurrence({ frequency: 'WEEKLY', startDate: '2026-11-23', endDate: '2026-12-02', daysOfWeek: [1, 3] }).length, 4);
  assert.throws(() => t.expandRecurrence({ frequency: 'WEEKLY', startDate: '2026-11-23', endDate: '2026-11-22', daysOfWeek: [1] }));
  assert.throws(() => t.expandRecurrence({ frequency: 'WEEKLY', startDate: '2026-11-23', endDate: '2026-11-30', daysOfWeek: [] }));
  assert.throws(() => t.expandRecurrence({ frequency: 'WEEKLY', startDate: '2026-01-01', endDate: '2028-01-01', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }), /exceed/);
});

test('free intervals (partial availability)', () => {
  assert.deepEqual(t.freeIntervals(480, 720, [[540, 600], [660, 780]]), [[480, 540], [600, 660]]);
  assert.deepEqual(t.freeIntervals(480, 720, []), [[480, 720]]);
  assert.deepEqual(t.freeIntervals(480, 720, [[0, 1000]]), []);
  const free = partialAvailability('2026-11-25', '09:00', '13:00', [{ starts_at: '2026-11-25 10:00:00', ends_at: '2026-11-25 11:00:00' }], []);
  assert.deepEqual(free, [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '13:00' }]);
});

test('facility matching is case-insensitive and reports what is missing', () => {
  assert.ok(facilitiesCover(['Projector', 'Wi-Fi'], ['projector']));
  assert.ok(!facilitiesCover(['Projector'], ['Projector', 'Microphone']));
  assert.deepEqual(missingFacilities(['Projector'], ['Projector', 'Microphone']), ['Microphone']);
});

test('recommendation ranking is rule based and explains itself', () => {
  const venues = [
    { name: 'Big', capacity: 200, building: 'Main', type: 'Lecture Hall', facilities: ['Projector', 'Wi-Fi', 'Sound System', 'Whiteboard'] },
    { name: 'Right', capacity: 45, building: 'Eng', type: 'Lecture Hall', facilities: ['Projector'] },
    { name: 'Lab', capacity: 40, building: 'Eng', type: 'Laboratory', facilities: ['Projector'] },
  ];
  const out = rank(venues, { participants: 40, facilities: ['Projector'], building: 'Eng', type: 'Lecture Hall' });
  assert.equal(out[0].venue.name, 'Right');
  assert.equal(out.at(-1).venue.name, 'Big');
  assert.match(out[0].explanation, /sufficient capacity/);
  assert.match(out[0].explanation, /preferred building/);
  assert.ok(scoreVenue(venues[1], { participants: 40 }).score <= 100);
});

test('xlsx / csv export helpers', () => {
  const buf = buildXlsx([{ name: 'A', rows: [['x', 1], ['<&>', 'é']] }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, 'zip signature');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(toCsv([['a', 'b,c'], [1, 'q"r']]), 'a,"b,c"\r\n1,"q""r"');
});
