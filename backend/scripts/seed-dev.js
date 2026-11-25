require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

(async () => {
  const client = await pool.connect();
  try {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEMO_SEED !== 'true') {
      throw new Error('Demo seed blocked. Set NODE_ENV=development and ENABLE_DEMO_SEED=true.');
    }
    const localFile = process.env.DEMO_DATA_FILE || path.join(__dirname, '../config-demo-data.json');
    const exampleFile = path.join(__dirname, '../config-demo-data.example.json');
    const file = process.env.DEMO_DATA_FILE
      ? localFile
      : (fs.existsSync(localFile) ? localFile : exampleFile);
    if (!fs.existsSync(file)) throw new Error(`Demo data file not found: ${file}`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    await client.query('BEGIN');
    for (const d of data.departments || []) {
      await client.query('INSERT INTO departments(name,code) VALUES($1,$2) ON CONFLICT(name) DO NOTHING', [d.name, d.code || null]);
    }
    for (const v of data.venues || []) {
      await client.query('INSERT INTO venues(name,capacity,type,building,facilities) VALUES($1,$2,$3,$4,$5) ON CONFLICT(name) DO NOTHING', [v.name, v.capacity, v.type, v.building || '', v.facilities || []]);
    }
    for (const t of data.timeSlots || []) {
      await client.query('INSERT INTO time_slots(name,start_time,end_time) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM time_slots WHERE name=$1 AND start_time=$2 AND end_time=$3)', [t.name, t.startTime, t.endTime]);
    }
    for (const u of data.users || []) {
      if (!['ADMIN', 'LECTURER', 'INSTRUCTOR', 'STUDENT', 'LAB_ASSISTANT'].includes(u.role)) throw new Error(`Invalid demo role for ${u.email}`);
      const password = process.env[u.passwordEnv];
      if (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error(`Set a valid 12-72 byte password in ${u.passwordEnv}`);
      const hash = await bcrypt.hash(password, 12);
      await client.query('INSERT INTO users(name,email,password_hash,role,approved) VALUES($1,$2,$3,$4,true) ON CONFLICT(email) DO NOTHING', [u.name, u.email.toLowerCase(), hash, u.role]);
    }
    const { DEMO_ADMIN_NAME, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = process.env;
    if (!DEMO_ADMIN_NAME || !DEMO_ADMIN_EMAIL || !/^\S+@\S+\.\S+$/.test(DEMO_ADMIN_EMAIL) ||
        !DEMO_ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD.length < 12 ||
        Buffer.byteLength(DEMO_ADMIN_PASSWORD, 'utf8') > 72 ||
        DEMO_ADMIN_PASSWORD.startsWith('replace_with_')) {
      throw new Error('Set DEMO_ADMIN_NAME, DEMO_ADMIN_EMAIL and a unique 12-72 byte DEMO_ADMIN_PASSWORD in backend/.env.');
    }
    const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
    await client.query(
      `INSERT INTO users(name,email,password_hash,role,status,approved,active)
       VALUES($1,$2,$3,'ADMIN','APPROVED',true,true)
       ON CONFLICT(email) DO UPDATE SET
         name=EXCLUDED.name,
         password_hash=EXCLUDED.password_hash,
         role=EXCLUDED.role,
         status=EXCLUDED.status,
         approved=EXCLUDED.approved,
         active=EXCLUDED.active`,
      [DEMO_ADMIN_NAME, DEMO_ADMIN_EMAIL.trim().toLowerCase(), adminHash]
    );
    await client.query('COMMIT');
    console.log('Development fixtures loaded.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Development seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
