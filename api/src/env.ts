export interface Bindings {
  DB: D1Database;
  ENVIRONMENT: 'development' | 'test' | 'demo' | 'production';
  /** « 1 » autorise l'en-tête X-Dev-User. Refusé en production ; en démo, seulement derrière Access et pour une identité *.demo.local. */
  DEV_AUTH?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Secret Worker : 32 octets base64, chiffrement des jetons (§16). */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Secret Worker : clé de la génération automatique du delivery (routes /api/robot, décision 0009). */
  DELIVERY_ROBOT_TOKEN?: string;
  /** Stockage des fichiers (R2) : PDF des guides, puis ressources et pièces jointes. Absent tant que R2 n'est pas activé. */
  FILES?: R2Bucket;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'agence' | 'client';
  client_id: string | null;
  last_login_at: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  offer: string | null;
  start_date: string | null;
  campaigns_launched_at: string | null;
  appointment_target: number;
  window_days: number;
  thresholds_json: string;
  unit_economics_json: string;
  ad_account_currency: string;
  ad_account_timezone: string;
  auto_publish_recos: number;
  onboarding_locked: number;
  onboarding_submitted_at?: string | null;
  unmeasured_json?: string;
  ghl_config_json?: string;
  drive_folder_url?: string | null;
  master_tracker_url?: string | null;
  facebook_page_id?: string | null;
  ads_live_synced_at?: string | null;
  verticals_enabled?: number;
  delivery_mechanism?: string | null;
  is_demo: number;
}

/** Vue effective : « client » pour un client, ou pour l'agence en bascule « Vue client ». */
export type Audience = 'agence' | 'client';

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: UserRow; view: Audience; client: ClientRow };
};
