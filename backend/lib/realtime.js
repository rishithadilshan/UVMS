// Real-time notification push using Server-Sent Events (no extra dependency). Clients connect to
// GET /api/notifications/stream with their normal Authorization header (fetch streaming).
const clients = new Map(); // userId -> Set<res>

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => { const s = clients.get(userId); if (s) { s.delete(res); if (!s.size) clients.delete(userId); } });
}
function push(userId, event, data) {
  const s = clients.get(userId);
  if (!s) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of s) { try { res.write(payload); } catch { /* connection closed */ } }
}
const heartbeat = setInterval(() => { for (const s of clients.values()) for (const res of s) { try { res.write(': ping\n\n'); } catch { /* ignore */ } } }, 25000);
heartbeat.unref();

module.exports = { addClient, push };
