import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

export const migrate = async (connectionString: string, file = new URL('../../migrations/001_workflows.sql', import.meta.url)) => {
  const pool = new Pool({ connectionString });
  try { await pool.query(await readFile(file, 'utf8')); }
  finally { await pool.end(); }
};

if (process.env.DATABASE_URL && process.argv[1]?.endsWith('migrations.ts')) await migrate(process.env.DATABASE_URL);
