const { Client } = require("pg");
// Optional SELECT-only readback. Never writes or deletes application records.
async function readBooking(id) {
  if (!process.env.QA_DATABASE_URL) return null;
  const u=new URL(process.env.QA_DATABASE_URL);
  if (!["localhost","127.0.0.1","::1"].includes(u.hostname)) throw new Error("QA_DATABASE_URL must be local.");
  const c=new Client({connectionString:process.env.QA_DATABASE_URL,statement_timeout:5000});
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const r=await c.query("SELECT id,owner_id,venue_id,status,purpose FROM bookings WHERE id=$1",[id]);
    await c.query("COMMIT"); return r.rows[0]||null;
  } catch(e) { await c.query("ROLLBACK").catch(()=>{}); throw e; }
  finally { await c.end(); }
}
module.exports={readBooking};
