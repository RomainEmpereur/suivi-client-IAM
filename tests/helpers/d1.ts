/**
 * Adaptateur minimal D1 → node:sqlite, pour exécuter l'API réelle sur le schéma réel en test.
 * Couvre prepare/bind/first/all/run/batch/exec — ce que l'API utilise.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type Param = string | number | null | bigint | Uint8Array;
const norm = (v: unknown): Param => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Param));

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private params: Param[] = []) {}
  bind(...p: unknown[]) { return new Stmt(this.db, this.sql, p.map(norm)); }
  // D1 accepte ?1, ?2… : node:sqlite aussi (paramètres positionnels numérotés).
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...(r as object) }));
    return { results: rows as T[], success: true, meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createTestDb(seedSql?: string) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const dir = join(import.meta.dirname, '..', '..', 'db', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  if (seedSql) db.exec(seedSql);
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    // Comme D1 : un batch est une transaction (tout ou rien).
    batch: async (stmts: Stmt[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const st of stmts) out.push(await st.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    exec: async (sql: string) => { db.exec(sql); return { count: 0, duration: 0 }; },
  };
  return { raw: db, d1: d1 as unknown as D1Database };
}
