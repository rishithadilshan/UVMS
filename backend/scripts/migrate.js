require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

// Applies the baseline schema (001) and every numbered file in db/migrations in order.
// Each migration runs in its own transaction and is recorded in schema_migrations.
const migrations = [{ version: '001_initial_postgresql_schema', file: path.join(__dirname, '../db/migrations/schema.sql') }];
const dir = path.join(__dirname, '../db/migrations');
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.+\.sql$/.test(x)).sort()) {
    migrations.push({ version: f.replace(/\.sql$/, ''), file: path.join(dir, f) });
  }
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(120) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('SET statement_timeout = 0'); // DDL (index builds) may legitimately exceed the API's statement timeout
    await client.query('SELECT pg_advisory_lock(727002)'); // serialise concurrent migrators
    for (const m of migrations) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [m.version]);
      if (existing.rowCount) { console.log(`up to date: ${m.version}`); continue; }
      try {
        await client.query('BEGIN');
        await client.query(fs.readFileSync(m.file, 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [m.version]);
        await client.query('COMMIT');
        console.log(`applied: ${m.version}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${m.version}: ${e.message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727002)');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
