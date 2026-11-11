/**
 * Jeu de données de DÉMONSTRATION — jamais en production.
 * Tous les clients créés ici portent is_demo = 1 et l'API les refuse quand ENVIRONMENT=production.
 *
 * Usage : node --experimental-strip-types db/seed/generate.ts [AAAA-MM-JJ] > db/seed/.demo.sql
 * La date (par défaut : aujourd'hui à Paris) sert d'ancre, pour que la démo soit toujours « à jour ».
 * Le résultat est déterministe pour une ancre donnée.
 */
import { addDaysYmd, parisDayStartMs, rollupSql, todayParis } from '../../packages/domain/src/index.ts';

if (process.env.ENVIRONMENT === 'production') {
  console.error('Refusé : le jeu de démonstration ne peut pas être généré pour la production.');
  process.exit(1);
}

export function generateDemoSql(anchor: string): string {
  // ── utilitaires ─────────────────────────────────────────────
  let seed = 20261111;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda); let k = 0; let p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  };
  const q = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const out: string[] = [];
  const insert = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
  };
  const d = (offset: number) => addDaysYmd(anchor, offset);
  /** Horodatage UTC pour un jour (AAAA-MM-JJ) et une heure de Paris. */
  const parisAt = (ymd: string, hour: number, minute = 0) =>
    new Date(parisDayStartMs(ymd) + (hour * 60 + minute) * 60_000).toISOString();
  const nowIso = parisAt(anchor, 6, 4);

  out.push('-- Jeu de démonstration généré — ancre ' + anchor + ' — NE PAS APPLIQUER EN PRODUCTION');
  out.push('PRAGMA foreign_keys = ON;');
  out.push("DELETE FROM clients WHERE is_demo = 1;");
  out.push("DELETE FROM users WHERE email LIKE '%.demo.local';");
  out.push("DELETE FROM guides WHERE id LIKE 'gd_demo_%';");

  // ── utilisateurs agence ─────────────────────────────────────
  insert('users', { id: 'usr_demo_agence', email: 'agence@obsidian.demo.local', display_name: 'Agence (démo)', role: 'agence', client_id: null });

  // ── guides communs ──────────────────────────────────────────
  const guides = [
    ['gd_demo_bm', 'Créer son portefeuille business et son compte publicitaire', 'pdf', 1],
    ['gd_demo_meta', 'Donner ses accès Meta', 'page', 1],
    ['gd_demo_crm', 'Prise en main du CRM', 'video', 1],
    ['gd_demo_rdv', 'Mettre à jour ses rendez-vous (présent, absent, vendu)', 'page', 1],
    ['gd_demo_dns', 'Donner l’accès au nom de domaine', 'pdf', 1],
    ['gd_demo_video', 'Tourner ses vidéos publicitaires', 'video', 1],
    ['gd_demo_facture', 'Régler une facture', 'page', 0],
  ] as const;
  guides.forEach(([id, title, kind, published], i) =>
    insert('guides', { id, client_id: null, title, kind, url: 'https://example.com/guide-demo', sort_order: i + 1, published }));

  // ════════════════════════════════════════════════════════════
  // Client A — Nordline CRM : campagnes lancées il y a 45 jours
  // ════════════════════════════════════════════════════════════
  const A = 'cl_demo_nordline';
  const launch = d(-45);
  insert('clients', {
    id: A, name: 'Nordline CRM (démo)', slug: 'nordline-demo', status: 'actif',
    offer: 'Standard — 1 500 € + 1 500 € à 30 rendez-vous validés', start_date: d(-75), campaigns_launched_at: launch,
    appointment_target: 30, window_days: 90,
    thresholds_json: JSON.stringify({ cost_per_booked_max_cents: 8424 }),
    unit_economics_json: JSON.stringify({ monthly_ticket_cents: 39000, lifetime_months: 18, gross_margin: 0.8, demo_close_rate: 0.25, acceptable_share: 0.06 }),
    onboarding_locked: 1, is_demo: 1,
  });
  insert('users', { id: 'usr_demo_nordline', email: 'client@nordline.demo.local', display_name: 'Client Nordline (démo)', role: 'client', client_id: A });

  ['onboarding', 'offre', 'landing', 'vsl', 'ads', 'sequences', 'recette', 'lancement'].forEach((phase, i) =>
    insert('phases', { id: `ph_${A}_${phase}`, client_id: A, phase, state: 'valide', started_at: d(-75 + i * 4) }));

  const delivA = [
    ['offre', 'offre', 'Offre de trafic froid', 'valide', 'Audit gratuit du pipeline commercial en 30 minutes, avec la garantie de 3 actions concrètes.'],
    ['landing', 'landing', 'Landing page « Audit pipeline »', 'valide', 'Page publiée, reliée au CRM. Version de référence.'],
    ['vsl_script', 'vsl', 'Script de la VSL', 'valide', 'Script de 9 minutes structuré autour de l’histoire du fondateur.'],
    ['vsl_video', 'vsl', 'VSL montée', 'mis_a_jour', 'Version 2 : introduction raccourcie à 40 secondes.'],
    ['ads_scripts', 'ads', 'Scripts des 6 publicités', 'valide', 'Six angles testés : fondateur, démo, témoignage, douleur, cas chiffré, FAQ.'],
    ['sequences', 'sequences', 'Séquences email et SMS', 'valide', 'Rappels avant rendez-vous et relance des non-réservés.'],
  ] as const;
  delivA.forEach(([type, phase, title, status, summary], i) =>
    insert('deliverables', {
      id: `dl_${A}_${type}`, client_id: A, type, phase, title, status, version: status === 'mis_a_jour' ? 2 : 1,
      external_url: 'https://example.com/livrable-demo', client_summary: summary, visible_client: 1, published_at: parisAt(d(-70 + i * 4), 10),
    }));

  insert('tasks', { id: `tk_${A}_1`, client_id: A, label: 'Renseigner le statut des rendez-vous passés', owner: 'client', phase: 'lancement', status: 'a_faire', blocking: 1, due_date: d(-2), guide_id: 'gd_demo_rdv' });
  insert('tasks', { id: `tk_${A}_2`, client_id: A, label: 'Tourner 2 nouvelles vidéos face caméra', owner: 'client', phase: 'lancement', status: 'a_faire', due_date: d(6), guide_id: 'gd_demo_video' });
  insert('tasks', { id: `tk_${A}_3`, client_id: A, label: 'Préparer la série de créatives n° 3', owner: 'agence', phase: 'lancement', status: 'en_cours', due_date: d(4) });
  insert('tasks', { id: `tk_${A}_4`, client_id: A, label: 'Point mensuel de résultats', owner: 'agence', phase: 'lancement', status: 'a_faire', due_date: d(9) });

  const connA: [string, string, string | null, string | null][] = [
    ['meta', 'ok', null, null],
    ['pixel', 'ok', null, null],
    ['ghl', 'ok', null, null],
    ['calendrier', 'ok', null, null],
    ['domaine', 'ok', null, null],
    ['mailing', 'degrade', 'SPF présent, DKIM absent sur le domaine d’envoi', 'Ajoutez l’enregistrement DKIM fourni par l’agence chez votre hébergeur de domaine.'],
    ['formulaire', 'ok', null, null],
  ];
  connA.forEach(([type, state, error, action]) =>
    insert('connections', {
      id: `cn_${A}_${type}`, client_id: A, type, state, last_checked_at: nowIso, error_message: error, client_action: action,
      external_id: type === 'meta' ? 'act_000000000000001' : null,
      token_expires_at: type === 'meta' ? parisAt(d(52), 0) : null,
    }));

  insert('funnel_events', { id: `fe_${A}_1`, client_id: A, date: launch, label: 'Lancement', description: 'Mise en ligne des campagnes' });
  insert('funnel_events', { id: `fe_${A}_2`, client_id: A, date: d(-25), label: 'VSL directe', description: 'La landing renvoie directement vers la VSL' });
  insert('funnel_events', { id: `fe_${A}_3`, client_id: A, date: d(-10), label: 'Calendrier simplifié', description: 'Passage de 3 à 1 étape de réservation' });

  // ── Métriques : 2 campagnes, 6 publicités ───────────────────
  const ads = [
    { ad: '120210000000101', name: 'Ad 01 — Fondateur face cam', camp: '120210000000001', cname: 'C1 — VSL directe', set: '120210000000011', sname: 'Larges FR', spend: 1500, cpm: 1100, ctr: 0.019, book: 0.17 },
    { ad: '120210000000102', name: 'Ad 02 — Démo écran', camp: '120210000000001', cname: 'C1 — VSL directe', set: '120210000000011', sname: 'Larges FR', spend: 1150, cpm: 1250, ctr: 0.016, book: 0.12 },
    { ad: '120210000000103', name: 'Ad 03 — Témoignage client', camp: '120210000000001', cname: 'C1 — VSL directe', set: '120210000000011', sname: 'Larges FR', spend: 800, cpm: 1400, ctr: 0.014, book: 0.10 },
    { ad: '120210000000104', name: 'Ad 04 — Hook douleur', camp: '120210000000001', cname: 'C1 — VSL directe', set: '120210000000011', sname: 'Larges FR', spend: 650, cpm: 1700, ctr: 0.011, book: 0 },
    { ad: '120210000000201', name: 'RT 01 — Cas chiffré', camp: '120210000000002', cname: 'C2 — Retargeting', set: '120210000000021', sname: 'Visiteurs 30 j', spend: 380, cpm: 2200, ctr: 0.024, book: 0.2 },
    { ad: '120210000000202', name: 'RT 02 — FAQ', camp: '120210000000002', cname: 'C2 — Retargeting', set: '120210000000021', sname: 'Visiteurs 30 j', spend: 260, cpm: 2400, ctr: 0.02, book: 0.1 },
  ];
  const budgets: Record<string, number> = { '120210000000001': 4200, '120210000000002': 700 };
  let apptN = 0;
  const firstDay = launch;
  const lastDay = d(-1);
  for (let day = firstDay; day <= lastDay; day = addDaysYmd(day, 1)) {
    const dayIdx = Math.round((parisDayStartMs(day) - parisDayStartMs(firstDay)) / 86_400_000);
    const improve = dayIdx >= 20 ? 1.25 : 1; // effet « VSL directe »
    let organic = 0;
    let metaContacts = 0;
    for (const a of ads) {
      const spend = Math.round(a.spend * (0.75 + rand() * 0.5));
      const impressions = Math.round((spend / a.cpm) * 1000);
      const clicks = Math.round(impressions * a.ctr * (0.85 + rand() * 0.3));
      const lpv = Math.round(clicks * (0.7 + rand() * 0.1));
      const vsl = Math.round(lpv * 0.5);
      const plays = Math.round(impressions * 0.3);
      const thru = Math.round(plays * (0.1 + rand() * 0.06));
      const leads = poisson(lpv * 0.12);
      const booked = a.book === 0 ? 0 : Math.min(leads, poisson(leads * a.book * improve));
      let held = 0, sales = 0, cash = 0;
      for (let i = 0; i < booked; i++) {
        apptN++;
        const bookedAt = parisAt(day, 9 + Math.floor(rand() * 10), Math.floor(rand() * 60));
        const schedDay = addDaysYmd(day, 1 + Math.floor(rand() * 5));
        const scheduledAt = parisAt(schedDay, 10 + Math.floor(rand() * 7));
        let status: string;
        const past = schedDay < anchor;
        const r = rand();
        if (!past) status = r < 0.08 ? 'annule' : 'prevu';
        else if (schedDay >= d(-4) && r < 0.35) status = 'prevu'; // statut pas encore renseigné dans le CRM
        else status = r < 0.1 ? 'annule' : r < 0.25 ? 'absent' : 'honore';
        const excluded = apptN === 7;
        if (status === 'honore') {
          held++;
          if (rand() < 0.25) { sales++; cash += 117000; }
        }
        insert('appointments', {
          id: `ap_${A}_${String(apptN).padStart(3, '0')}`, client_id: A, ghl_appointment_id: `demo-${apptN}`,
          contact_name: `Contact démo ${String(apptN).padStart(3, '0')}`, booked_at: bookedAt, scheduled_at: scheduledAt, status,
          campaign_id: a.camp, ad_id: a.ad, counts_toward_target: excluded ? 0 : 1,
          exclusion_reason: excluded ? 'Hors cible : étudiant, pas de décision d’achat' : null,
        });
      }
      metaContacts += leads;
      insert('metrics_daily', {
        client_id: A, date: day, ad_id: a.ad, campaign_id: a.camp, adset_id: a.set,
        campaign_name: a.cname, adset_name: a.sname, ad_name: a.name, ad_status: 'ACTIVE',
        campaign_daily_budget_cents: budgets[a.camp], spend_cents: spend, spend_original_minor: spend, currency: 'EUR', fx_rate_to_eur: 1,
        impressions, frequency: 1.2 + dayIdx * 0.02, link_clicks: clicks, landing_page_views: lpv, vsl_views: vsl,
        thruplays: thru, video_plays: plays, leads, crm_contacts: leads, appointments_booked: booked,
        appointments_held: held, sales, cash_collected_cents: cash, source: 'demo',
      });
    }
    organic = poisson(0.8);
    insert('contact_sources_daily', { client_id: A, date: day, source: 'Meta', contacts: metaContacts });
    if (organic) insert('contact_sources_daily', { client_id: A, date: day, source: 'Organique', contacts: organic });
    const unmatched = poisson(0.3);
    if (unmatched) insert('contact_sources_daily', { client_id: A, date: day, source: 'Non rattaché', contacts: unmatched });
  }
  out.push(rollupSql(A, firstDay, lastDay));

  [['Nouveau lead', 18], ['RDV planifié', 7], ['RDV tenu', 5], ['Proposition envoyée', 3], ['Gagné', 2]].forEach(([name, n], i) =>
    insert('pipeline_snapshot', { client_id: A, stage_order: i + 1, stage_name: name, open_opportunities: n }));

  for (const src of ['meta', 'ghl']) {
    insert('sync_runs', { id: `sr_${A}_${src}`, client_id: A, source: src, started_at: parisAt(anchor, 6, 0), finished_at: nowIso, rows_written: 42, ok: 1 });
  }

  const y = d(-1);
  insert('recommendations', {
    id: `rc_${A}_1`, client_id: A, date: anchor, severity: 'corriger', rule_key: 'creative_a_couper',
    title: 'Couper Ad 04 — Hook douleur', body: 'Ad 04 a dépensé plus de 1,5 × le coût par rendez-vous cible sans produire un seul rendez-vous sur 7 jours. Couper la publicité dans le gestionnaire Meta.',
    internal_note: 'Le hook douleur ne passe pas sur cette cible, CPM élevé.',
    client_title: 'Nous arrêtons la publicité « Hook douleur »', client_body: 'Cette publicité a coûté plus qu’un rendez-vous cible sans en produire. Nous la coupons aujourd’hui et réaffectons le budget aux publicités qui fonctionnent.',
    metrics_json: JSON.stringify({ ad_id: '120210000000104' }), visible_client: 1, published_at: nowIso,
  });
  insert('recommendations', {
    id: `rc_${A}_2`, client_id: A, date: anchor, severity: 'corriger', rule_key: 'statuts_manquants',
    title: 'Statuts de rendez-vous manquants', body: 'Des rendez-vous passés depuis plus de 24 h n’ont pas de statut présent / absent dans GHL : le taux de présence et le compteur ne sont pas à jour.',
    client_title: 'Renseignez le statut de vos derniers rendez-vous', client_body: 'Quelques rendez-vous passés n’ont pas encore de statut dans le CRM. Sans lui, ils ne comptent pas dans vos 30 rendez-vous validés. Le guide « Mettre à jour ses rendez-vous » montre comment faire en 2 minutes.',
    visible_client: 1, published_at: nowIso, repeat_count: 2,
  });
  insert('recommendations', {
    id: `rc_${A}_3`, client_id: A, date: anchor, severity: 'info', rule_key: 'creative_a_dupliquer',
    title: 'Dupliquer Ad 01 — Fondateur face cam', body: 'Coût par rendez-vous sous 50 % de la moyenne du compte sur 7 jours. Dupliquer dans un nouvel ensemble.',
    visible_client: 0,
  });
  insert('recommendations', {
    id: `rc_${A}_4`, client_id: A, date: y, severity: 'surveiller', rule_key: 'cpm_eleve',
    title: 'CPM du retargeting au-dessus du seuil', body: 'Le CPM du retargeting dépasse 15 € sur 7 jours. Élargir l’audience à 60 jours.',
    client_title: 'Le retargeting coûte plus cher à diffuser', client_body: 'Nous élargissons l’audience pour faire baisser le coût d’affichage.',
    visible_client: 1, published_at: parisAt(y, 7), state: 'traitee', state_changed_at: parisAt(y, 11),
  });
  insert('feedback', { id: `fb_${A}_1`, client_id: A, author_user_id: 'usr_demo_nordline', category: 'question', body: 'Pourquoi deux rendez-vous de la semaine dernière ne comptent pas dans le compteur ?', status: 'nouveau' });

  // ════════════════════════════════════════════════════════════
  // Client B — Pilotis RH : en production des livrables
  // ════════════════════════════════════════════════════════════
  const B = 'cl_demo_pilotis';
  insert('clients', {
    id: B, name: 'Pilotis RH (démo)', slug: 'pilotis-demo', status: 'build',
    offer: 'Standard — 1 500 € + 1 500 € à 30 rendez-vous validés', start_date: d(-20), campaigns_launched_at: null,
    onboarding_locked: 1, is_demo: 1,
  });
  insert('users', { id: 'usr_demo_pilotis', email: 'client@pilotis.demo.local', display_name: 'Client Pilotis (démo)', role: 'client', client_id: B });
  const phB: Record<string, string> = { onboarding: 'valide', offre: 'livre', landing: 'en_cours' };
  ['onboarding', 'offre', 'landing', 'vsl', 'ads', 'sequences', 'recette', 'lancement'].forEach((phase) =>
    insert('phases', {
      id: `ph_${B}_${phase}`, client_id: B, phase, state: phB[phase] ?? 'a_venir',
      started_at: phase === 'landing' ? d(-5) : phase === 'offre' ? d(-14) : phase === 'onboarding' ? d(-20) : null,
      blocker: phase === 'landing' ? 'En attente des captures du produit' : null,
    }));
  insert('deliverables', { id: `dl_${B}_offre`, client_id: B, type: 'offre', phase: 'offre', title: 'Offre de trafic froid', status: 'a_relire', external_url: 'https://example.com/livrable-demo', client_summary: 'Diagnostic RH offert de 20 minutes pour les PME de 20 à 200 salariés. À relire avant vendredi.', visible_client: 1, published_at: parisAt(d(-3), 15) });
  insert('deliverables', { id: `dl_${B}_landing`, client_id: B, type: 'landing', phase: 'landing', title: 'Landing page « Diagnostic RH »', status: 'brouillon', external_url: 'https://example.com/brouillon-interne', client_summary: 'Brouillon interne — non publié.', visible_client: 0 });
  insert('deliverables', { id: `dl_${B}_vsl`, client_id: B, type: 'vsl_script', phase: 'vsl', title: 'Script de la VSL', status: 'brouillon', visible_client: 0 });
  const tB: [string, 'agence' | 'client', string, string, number, number][] = [
    ['Structure de la page validée', 'agence', 'fait', 'landing', -4, 0],
    ['Rédaction des sections', 'agence', 'fait', 'landing', -2, 0],
    ['Intégration de la page', 'agence', 'en_cours', 'landing', 2, 0],
    ['Envoyer les captures du produit et du tableau de bord', 'client', 'a_faire', 'landing', -8, 1],
    ['Donner vos accès Meta', 'client', 'a_faire', 'recette', 3, 1],
    ['Donner l’accès au nom de domaine', 'client', 'fait', 'landing', -6, 0],
  ];
  tB.forEach(([label, owner, status, phase, due, blocking], i) =>
    insert('tasks', {
      id: `tk_${B}_${i + 1}`, client_id: B, label, owner, status, phase, due_date: d(due), blocking,
      guide_id: label.includes('Meta') ? 'gd_demo_meta' : label.includes('domaine') ? 'gd_demo_dns' : null,
      done_at: status === 'fait' ? parisAt(d(due), 12) : null,
    }));
  const connB: [string, string, string | null, string | null][] = [
    ['meta', 'non_configure', null, 'Donnez l’accès partenaire à votre compte publicitaire (guide « Donner ses accès Meta »).'],
    ['pixel', 'non_configure', null, null],
    ['ghl', 'ok', null, null],
    ['calendrier', 'casse', 'Calendrier Google déconnecté (jeton révoqué)', 'Reconnectez votre agenda dans le CRM : Paramètres → Calendriers → Connexions.'],
    ['domaine', 'ok', null, null],
    ['mailing', 'non_configure', null, null],
    ['formulaire', 'non_configure', null, null],
  ];
  connB.forEach(([type, state, error, action]) =>
    insert('connections', { id: `cn_${B}_${type}`, client_id: B, type, state, last_checked_at: nowIso, error_message: error, client_action: action }));

  return out.join('\n') + '\n';
}

// Exécution directe
if (import.meta.url === `file://${process.argv[1]}`) {
  const anchor = process.argv[2] ?? todayParis();
  process.stdout.write(generateDemoSql(anchor));
}
