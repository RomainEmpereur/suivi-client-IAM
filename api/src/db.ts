export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const nowIso = () => new Date().toISOString();

export async function audit(
  db: D1Database,
  entry: { clientId: string | null; actorId: string; actorEmail: string; action: string; objectType: string; objectId?: string | null; before?: unknown; after?: unknown },
) {
  await run(
    db,
    `INSERT INTO audit_log (id, client_id, actor_user_id, actor_email, action, object_type, object_id, before_json, after_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    newId('aud'), entry.clientId, entry.actorId, entry.actorEmail, entry.action, entry.objectType, entry.objectId ?? null,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
}
