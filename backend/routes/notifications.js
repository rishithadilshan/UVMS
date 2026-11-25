const express = require('express');
const { q, asyncRoute, idParam, paging } = require('../lib/core');
const { auth } = require('../lib/auth');
const realtime = require('../lib/realtime');

const router = express.Router();
router.use(auth);

router.get('/', asyncRoute(async (req, res) => {
  const { page, pageSize, limit, offset } = paging(req.query, 20);
  const unreadOnly = req.query.unread === 'true';
  const where = `user_id=$1 ${unreadOnly ? 'AND NOT read' : ''}`;
  // total and unread come from one aggregate instead of two COUNT queries; the page itself runs concurrently.
  const [cnt, r] = await Promise.all([
    q('SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT read)::int AS unread FROM notifications WHERE user_id=$1', [req.user.id]),
    q(`SELECT *, created_at AS "createdAt", id AS _id FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, [req.user.id]),
  ]);
  const unread = cnt.rows[0].unread, total = unreadOnly ? unread : cnt.rows[0].total;
  if (!req.query.page && !req.query.pageSize) return res.json(r.rows); // legacy shape: plain array
  res.json({ items: r.rows, total, unread, page, pageSize });
}));
router.get('/unread-count', asyncRoute(async (req, res) => res.json({ unread: (await q('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT read', [req.user.id])).rows[0].n })));

// Live push (Server-Sent Events). The client uses fetch streaming so the normal Authorization header is used.
router.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('event: ready\ndata: {}\n\n');
  realtime.addClient(req.user.id, res);
});

router.patch('/read-all', asyncRoute(async (req, res) => { await q('UPDATE notifications SET read=true WHERE user_id=$1 AND NOT read', [req.user.id]); res.json({ message: 'Notifications marked as read' }); }));
router.patch('/:id/read', idParam, asyncRoute(async (req, res) => {
  const r = await q('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2 RETURNING *, id AS _id', [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Notification not found' });
  res.json(r.rows[0]);
}));

module.exports = router;
