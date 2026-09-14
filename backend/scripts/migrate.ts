/**
 * Applies SQL migrations from /database/migrations in filename order.
 *
 *   DATABASE_URL=postgresql://... npm run db:migrate
 *
 * Works against the local Supabase CLI stack and hosted Supabase projects
 * (use the "Session pooler" or direct connection string).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required, e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  process.exit(1);
}

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(`
    create table if not exists public.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public.schema_migrations enable row level security;
    revoke all on public.schema_migrations from anon, authenticated;
  `);

  const { rows } = await client.query<{ name: string }>('select name from public.schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into public.schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
      count += 1;
    } catch (error) {
      await client.query('rollback');
      console.error(`failed ${file}`);
      throw error;
    }
  }
  console.log(count === 0 ? 'database is up to date' : `${count} migration(s) applied`);
} finally {
  await client.end();
}
