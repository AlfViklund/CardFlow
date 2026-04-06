import 'dotenv/config';
import { createPool, runMigrations } from './src/index';

const connectionString = process.env.DATABASE_URL ?? 'postgres://cardflow:cardflow@localhost:5432/cardflow';
const pool = createPool(connectionString);

try {
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await pool.end();
}
