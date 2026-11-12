import { useEffect, useState, useCallback } from 'preact/hooks';
import { store } from './store.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const dev = store.get('devUser');
  if (dev) headers.set('X-Dev-User', dev); // ignoré par le serveur hors développement
  if (store.get('view') === 'client') headers.set('X-View', 'client');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Erreur ${res.status}`);
  return data as T;
}

/** Téléchargement d'un fichier protégé (même authentification que l'API) : ouvre le fichier dans un nouvel onglet. */
export async function openFile(path: string) {
  const headers = new Headers();
  const dev = store.get('devUser');
  if (dev) headers.set('X-Dev-User', dev);
  if (store.get('view') === 'client') headers.set('X-View', 'client');
  const w = window.open('', '_blank');
  const res = await fetch(`/api${path}`, { headers, credentials: 'same-origin' });
  if (!res.ok) { w?.close(); const d = await res.json().catch(() => ({})); throw new ApiError(res.status, (d as { error?: string }).error ?? `Erreur ${res.status}`); }
  const url = URL.createObjectURL(await res.blob());
  if (w) w.location.href = url; else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
