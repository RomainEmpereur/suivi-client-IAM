/** Préférences par navigateur (thème, vue, identité de dev). Toujours protégé : le stockage peut être absent. */
export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null) {
    try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* ignoré */ }
  },
};
