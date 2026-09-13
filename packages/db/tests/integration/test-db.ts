import { Pool } from "pg";

export function createTestPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
  }
  return new Pool({ connectionString, max: 8 });
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("drop schema public cascade; create schema public;");
}
