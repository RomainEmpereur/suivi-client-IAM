import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, run } from '../db.ts';
import { HttpError, forbidden, notFound } from '../errors.ts';

/**
 * Ressources d'onboarding (§7, décision 0020) : logo, charte, captures, témoignages, enregistrements.
 * Déposées par le client (ou l'agence en vue agence) dans R2, ou données sous forme de lien https.
 * Lecture : le client de l'espace et l'agence, mêmes droits que l'espace.
 */
export const resources = new Hono<AppEnv>();
resources.use('/:clientId/resources', scopeClient);
resources.use('/:clientId/resources/*', scopeClient);

export const RESOURCE_TYPES = ['logo', 'charte', 'captures_produit', 'temoignage', 'enregistrement', 'acces_site', 'autre'] as const;
const MAX_FILE = 50 * 1024 * 1024;
const MAX_ASSETS = 60;
/** Types acceptés, vérifiés par la signature du fichier (le type annoncé ne suffit pas). */
const FILE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  'image/webp': (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  'application/pdf': (b) => String.fromCharCode(...b.slice(0, 5)) === '%PDF-',
  'video/mp4': (b) => String.fromCharCode(...b.slice(4, 8)) === 'ftyp',
  'video/quicktime': (b) => ['ftyp', 'moov', 'wide', 'mdat'].includes(String.fromCharCode(...b.slice(4, 8))),
  'audio/mpeg': (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
};

interface AssetRow {
  id: string; type: string; r2_key: string | null; external_url: string | null; description: string | null;
  file_name: string | null; content_type: string | null; size_bytes: number | null; created_by_role: string; created_at: string;
}

/** Qui peut déposer : le client dans son espace, l'agence en vue agence. */
function canWrite(c: { get: (k: 'user' | 'view') => unknown }) {
  const user = c.get('user') as { role: string };
  if (user.role === 'agence') requireAgency(c);
}

const serialize = (r: AssetRow, clientId: string) => ({
  id: r.id, type: r.type, description: r.description, createdAt: r.created_at, createdBy: r.created_by_role,
  fileName: r.file_name, contentType: r.content_type, size: r.size_bytes,
  url: r.r2_key ? `/api/clients/${clientId}/resources/${r.id}/file` : r.external_url,
  isFile: Boolean(r.r2_key),
});

resources.get('/:clientId/resources', async (c) => {
  const client = c.get('client');
  const rows = await all<AssetRow>(c.env.DB, 'SELECT * FROM onboarding_assets WHERE client_id = ?1 ORDER BY created_at DESC', client.id);
  return c.json({ resources: rows.map((r) => serialize(r, client.id)) });
});

function readMeta(c: { req: { query: (k: string) => string | undefined } }) {
  const type = c.req.query('type') ?? '';
  if (!RESOURCE_TYPES.includes(type as never)) throw new HttpError(400, 'Type de ressource inconnu.');
  const description = (c.req.query('description') ?? '').trim().slice(0, 300) || null;
  return { type, description };
}

/** Dépôt d'un fichier : corps brut, type dans Content-Type, nom dans X-File-Name. */
resources.put('/:clientId/resources/file', async (c) => {
  canWrite(c);
  if (!c.env.FILES) throw new HttpError(503, 'Stockage de fichiers non activé.');
  const client = c.get('client');
  const user = c.get('user');
  const { type, description } = readMeta(c);
  const count = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM onboarding_assets WHERE client_id = ?1', client.id);
  if ((count?.n ?? 0) >= MAX_ASSETS) throw new HttpError(409, `${MAX_ASSETS} ressources au plus : passez par le dossier Drive pour le reste.`);
  const ctype = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!FILE_TYPES[ctype]) throw new HttpError(400, 'Format non accepté : image (PNG, JPEG, GIF, WebP), PDF, vidéo (MP4, MOV) ou audio (MP3).');
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_FILE) throw new HttpError(413, 'Fichier trop lourd (50 Mo au plus) : déposez-le dans le dossier Drive et collez le lien.');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'Fichier vide.');
  if (buf.byteLength > MAX_FILE) throw new HttpError(413, 'Fichier trop lourd (50 Mo au plus) : déposez-le dans le dossier Drive et collez le lien.');
  if (!FILE_TYPES[ctype](new Uint8Array(buf.slice(0, 16)))) throw new HttpError(400, 'Le contenu du fichier ne correspond pas à son format.');
  let name = 'ressource';
  try { name = decodeURIComponent(c.req.header('X-File-Name') ?? name); } catch { /* nom par défaut */ }
  name = name.replace(/[^\p{L}\p{N}._\- ]+/gu, '_').slice(0, 120) || 'ressource';
  const id = newId('res');
  const key = `onboarding/${client.id}/${id}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: ctype } });
  await run(c.env.DB, `INSERT INTO onboarding_assets (id, client_id, type, r2_key, description, file_name, content_type, size_bytes, created_by_role)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`, id, client.id, type, key, description, name, ctype, buf.byteLength, user.role === 'agence' ? 'agence' : 'client');
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'ressource_depot', objectType: 'onboarding_asset', objectId: id, after: { type, name, size: buf.byteLength } });
  return c.json({ ok: true, id }, 201);
});

/** Ressource donnée sous forme de lien (Drive, Dropbox, Loom…). */
resources.post('/:clientId/resources/link', async (c) => {
  canWrite(c);
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json<{ type?: string; url?: string; description?: string }>().catch(() => ({} as Record<string, never>));
  if (!RESOURCE_TYPES.includes(body.type as never)) throw new HttpError(400, 'Type de ressource inconnu.');
  const url = (body.url ?? '').trim();
  let ok = false;
  try { ok = new URL(url).protocol === 'https:'; } catch { ok = false; }
  if (!ok || url.length > 600) throw new HttpError(400, 'Le lien doit être une adresse https.');
  const count = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM onboarding_assets WHERE client_id = ?1', client.id);
  if ((count?.n ?? 0) >= MAX_ASSETS) throw new HttpError(409, `${MAX_ASSETS} ressources au plus.`);
  const id = newId('res');
  await run(c.env.DB, 'INSERT INTO onboarding_assets (id, client_id, type, external_url, description, created_by_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    id, client.id, body.type, url, (body.description ?? '').trim().slice(0, 300) || null, user.role === 'agence' ? 'agence' : 'client');
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'ressource_lien', objectType: 'onboarding_asset', objectId: id, after: { type: body.type } });
  return c.json({ ok: true, id }, 201);
});

resources.get('/:clientId/resources/:id/file', async (c) => {
  const client = c.get('client');
  const r = await first<AssetRow>(c.env.DB, 'SELECT * FROM onboarding_assets WHERE id = ?1 AND client_id = ?2', c.req.param('id'), client.id);
  if (!r?.r2_key) throw notFound();
  if (!c.env.FILES) throw new HttpError(503, 'Stockage de fichiers non activé.');
  const obj = await c.env.FILES.get(r.r2_key);
  if (!obj) throw notFound();
  const type = r.content_type ?? 'application/octet-stream';
  return new Response(obj.body, { headers: {
    'content-type': type,
    'content-disposition': `${FILE_TYPES[type] ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(r.file_name ?? 'ressource')}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
  } });
});

/** Suppression : l'agence (vue agence), ou le client pour ce qu'il a lui-même déposé. */
resources.delete('/:clientId/resources/:id', async (c) => {
  canWrite(c);
  const client = c.get('client');
  const user = c.get('user');
  const r = await first<AssetRow>(c.env.DB, 'SELECT * FROM onboarding_assets WHERE id = ?1 AND client_id = ?2', c.req.param('id'), client.id);
  if (!r) throw notFound();
  if (user.role === 'client' && r.created_by_role !== 'client') throw forbidden("Cette ressource a été ajoutée par l'agence.");
  await run(c.env.DB, 'DELETE FROM onboarding_assets WHERE id = ?1 AND client_id = ?2', r.id, client.id);
  if (r.r2_key && c.env.FILES) await c.env.FILES.delete(r.r2_key);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'ressource_suppression', objectType: 'onboarding_asset', objectId: r.id, before: { type: r.type, name: r.file_name } });
  return c.json({ ok: true });
});
