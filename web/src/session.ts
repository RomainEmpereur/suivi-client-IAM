import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

export interface Me {
  user: { email: string; displayName: string | null; role: 'agence' | 'client' };
  view: 'agence' | 'client';
  logoutUrl: string;
  clients: { id: string; name: string; slug: string; status?: string; is_demo?: number }[];
}

export interface Session {
  me: Me;
  /** Vue effective : « client » pour un client, ou pour l'agence en bascule. */
  view: 'agence' | 'client';
  isAgency: boolean;
  setView: (v: 'agence' | 'client') => void;
}

export const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext)!;
