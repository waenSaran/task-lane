export interface Queryable {
  query(sql: string): Promise<unknown>;
}

export type ServiceHealth = {
  status: "ok" | "error";
  service: string;
  database: "up" | "down";
  timestamp: string;
};

export async function createServiceHealth(
  service: string,
  queryable: Queryable,
  now: () => Date = () => new Date(),
): Promise<ServiceHealth> {
  try {
    await queryable.query("select 1");
    return { status: "ok", service, database: "up", timestamp: now().toISOString() };
  } catch {
    return { status: "error", service, database: "down", timestamp: now().toISOString() };
  }
}
