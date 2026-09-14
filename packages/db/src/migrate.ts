import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

const migrations = [
  { version: "001_initial", url: new URL("../migrations/001_initial.sql", import.meta.url) },
  { version: "002_repository_preferences", url: new URL("../migrations/002_repository_preferences.sql", import.meta.url) },
] as const;

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["task-lane:migrations"]);
    await ensureMigrationTable(client);

    for (const migration of migrations) {
      const applied = await client.query<{ version: string }>(
        "select version from schema_migrations where version = $1",
        [migration.version],
      );
      if (applied.rowCount) continue;

      const sql = await readFile(migration.url, "utf8");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [migration.version]);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
