/**
 * Chiffrement des jetons au repos (§16) : AES-GCM 256 bits, clé fournie par le secret Worker TOKEN_ENCRYPTION_KEY
 * (32 octets en base64, générée par Romain : `openssl rand -base64 32`). Format stocké : « v1.<iv>.<chiffré> ».
 * Le jeton en clair n'est jamais journalisé ni renvoyé au navigateur.
 */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new Error('Clé de chiffrement non configurée (secret TOKEN_ENCRYPTION_KEY).');
  const raw = unb64(keyB64.trim());
  if (raw.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets (openssl rand -base64 32).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(plain: string, keyB64: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(keyB64), new TextEncoder().encode(plain)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(stored: string, keyB64: string | undefined): Promise<string> {
  const [v, iv, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Jeton chiffré illisible.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(keyB64), unb64(ct));
  return new TextDecoder().decode(pt);
}
