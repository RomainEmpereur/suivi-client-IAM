/**
 * Synchronisation GoHighLevel d'un client (lot 3, §13). Lecture seule côté GHL.
 * Idempotente : relancer deux fois donne le même résultat.
 *  1. Remet à zéro les colonnes CRM (contacts, RDV pris, RDV tenus, ventes) de metrics_daily sur la fenêtre.
 *  2. Réécrit ces colonnes par jour × publicité (attribution GHL utmAdId ; à défaut campagne ; à défaut « non rattaché »),
 *     sans jamais toucher aux colonnes Meta (dépense, impressions…).
 *  3. Met à jour les rendez-vous en conservant tout statut posé par l'agence.
 *  4. Remplace les sources de contacts de la fenêtre et l'instantané du pipeline affiché.
 */
import { ROLLUP_STATEMENTS, ghlAppointmentStatus, ghlAttribution, parisDay, type GhlClientConfig } from '../../../packages/domain/src/index.ts';
import type { GhlClient, GhlEvent, GhlOpportunity } from '../../../packages/ghl/src/index.ts';

export interface GhlSyncResult {
  opportunities: number; contacts: number; appointments: number; rowsWritten: number;
  statuses: Record<string, number>;
}

const NR = 'non_rattache';

function displayName(e: GhlEvent): string {
  const form = e.appointmentMeta?.defaultFormDetails;
  const raw = (form ? `${form.firstName ?? ''} ${form.lastName ?? ''}` : String(e.title ?? '').split(' - ')[0].split('||')[0]).trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Contact';
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  return parts.length > 1 ? `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : first;
}

export async function syncGhl(
  db: D1Database,
  clientId: string,
  config: GhlClientConfig,
  ghl: GhlClient,
  window: { from: string; to: string },
  now = Date.now(),
  pipelines?: { id: string; name: string; stages: { id: string; name: string; position: number }[] }[],
): Promise<GhlSyncResult> {
  const inWindow = (d: string) => d >= window.from && d <= window.to;

  // ── Lecture GHL ─────────────────────────────────────────────
  const opps: GhlOpportunity[] = [];
  for (const p of config.pipelineIds) opps.push(...await ghl.opportunities(config.locationId, p));
  const events: GhlEvent[] = [];
  const startMs = Date.parse(`${window.from}T00:00:00Z`) - 86_400_000;
  const endMs = now + 90 * 86_400_000;
  // Aucun calendrier précisé : tous les calendriers du sous-compte.
  const calendarIds = config.calendarIds.length ? config.calendarIds : (await ghl.calendars(config.locationId)).calendars.map((c) => c.id);
  for (const cal of calendarIds) events.push(...await ghl.events(config.locationId, cal, startMs, endMs));

  // ── Contacts : une seule fois chacun, à leur première opportunité ──
  const byContact = new Map<string, GhlOpportunity[]>();
  for (const o of opps) byContact.set(o.contactId, [...(byContact.get(o.contactId) ?? []), o]);
  const refOpp = (contactId: string) => {
    const list = byContact.get(contactId) ?? [];
    return list.find((o) => ghlAttribution(o).campaignId || ghlAttribution(o).adId)
      ?? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  };
  const keyOf = (o: GhlOpportunity | undefined) => {
    if (!o) return { adId: NR, campaignId: NR, campaignName: 'Non rattaché à une campagne' };
    const a = ghlAttribution(o);
    if (a.adId) return { adId: a.adId, campaignId: a.campaignId ?? NR, campaignName: a.campaignName };
    if (a.campaignId) return { adId: `campagne:${a.campaignId}`, campaignId: a.campaignId, campaignName: a.campaignName };
    return { adId: NR, campaignId: NR, campaignName: 'Non rattaché à une campagne' };
  };

  type Agg = { date: string; adId: string; campaignId: string; campaignName: string | null; crm: number; booked: number; held: number; sales: number };
  const agg = new Map<string, Agg>();
  const bump = (date: string, k: ReturnType<typeof keyOf>, field: 'crm' | 'booked' | 'held' | 'sales') => {
    const key = `${date}|${k.adId}`;
    const a = agg.get(key) ?? { date, adId: k.adId, campaignId: k.campaignId, campaignName: k.campaignName, crm: 0, booked: 0, held: 0, sales: 0 };
    a[field]++;
    agg.set(key, a);
  };
  const sources = new Map<string, number>();
  for (const [contactId, list] of byContact) {
    const o = refOpp(contactId);
    const first = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    const day = parisDay(first.createdAt);
    if (inWindow(day)) {
      bump(day, keyOf(o), 'crm');
      const src = ghlAttribution(o).isMeta ? 'Meta' : 'Autre';
      sources.set(`${day}|${src}`, (sources.get(`${day}|${src}`) ?? 0) + 1);
    }
    const won = list.filter((x) => config.wonStageIds.includes(x.pipelineStageId) && x.lastStageChangeAt)
      .sort((a, b) => a.lastStageChangeAt!.localeCompare(b.lastStageChangeAt!))[0];
    if (won && inWindow(parisDay(won.lastStageChangeAt!))) bump(parisDay(won.lastStageChangeAt!), keyOf(o), 'sales');
  }

  // ── Rendez-vous ─────────────────────────────────────────────
  const lastPast = new Map<string, string>();
  for (const e of [...events].filter((x) => (x.appointmentStatus ?? x.appoinmentStatus) !== 'cancelled' && Date.parse(x.startTime) <= now)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))) lastPast.set(e.contactId, e.id);

  const statements: D1PreparedStatement[] = [];
  const statuses: Record<string, number> = {};
  for (const e of events) {
    const isTest = config.testTitlePrefixes.some((p) => String(e.title ?? '').startsWith(p));
    const status = ghlAppointmentStatus({
      ghlStatus: e.appointmentStatus ?? e.appoinmentStatus, scheduledAt: e.startTime,
      isLastPastForContact: lastPast.get(e.contactId) === e.id,
      contactStageIds: (byContact.get(e.contactId) ?? []).map((o) => o.pipelineStageId), config, now,
    });
    statuses[status] = (statuses[status] ?? 0) + 1;
    const o = refOpp(e.contactId);
    const k = keyOf(o);
    statements.push(db.prepare(
      `INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, campaign_id, ad_id, counts_toward_target, exclusion_reason)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (client_id, ghl_appointment_id) DO UPDATE SET
         contact_name = excluded.contact_name, booked_at = excluded.booked_at, scheduled_at = excluded.scheduled_at,
         campaign_id = excluded.campaign_id, ad_id = excluded.ad_id,
         status = CASE WHEN appointments.status_source = 'agence' THEN appointments.status ELSE excluded.status END,
         counts_toward_target = CASE WHEN appointments.status_source = 'agence' THEN appointments.counts_toward_target ELSE excluded.counts_toward_target END,
         exclusion_reason = CASE WHEN appointments.status_source = 'agence' THEN appointments.exclusion_reason ELSE excluded.exclusion_reason END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(`ap_${clientId}_${e.id}`, clientId, e.id, isTest ? 'Test interne' : displayName(e),
      new Date(e.dateAdded).toISOString(), new Date(e.startTime).toISOString(), status,
      k.campaignId === NR ? null : k.campaignId, k.adId === NR || k.adId.startsWith('campagne:') ? null : k.adId,
      isTest ? 0 : 1, isTest ? 'Test interne' : null));
    if (isTest) continue;
    const bookedDay = parisDay(e.dateAdded);
    if (inWindow(bookedDay)) {
      bump(bookedDay, k, 'booked');
      if (status === 'honore') bump(bookedDay, k, 'held');
    }
  }

  // ── Écriture (idempotente) ────────────────────────────────────
  statements.unshift(db.prepare(
    `UPDATE metrics_daily SET crm_contacts = 0, appointments_booked = 0, appointments_held = 0, sales = 0,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE client_id = ?1 AND date BETWEEN ?2 AND ?3 AND source != 'manuel'`).bind(clientId, window.from, window.to));
  for (const a of agg.values()) {
    statements.push(db.prepare(
      `INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, campaign_name, crm_contacts, appointments_booked, appointments_held, sales, source)
       VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, 'ghl')
       ON CONFLICT (client_id, date, ad_id) DO UPDATE SET
         crm_contacts = excluded.crm_contacts, appointments_booked = excluded.appointments_booked,
         appointments_held = excluded.appointments_held, sales = excluded.sales,
         campaign_name = COALESCE(metrics_daily.campaign_name, excluded.campaign_name),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(clientId, a.date, a.adId, a.campaignId, a.campaignId === NR ? 'Non rattaché à une campagne' : a.campaignName, a.crm, a.booked, a.held, a.sales));
  }
  statements.push(db.prepare('DELETE FROM contact_sources_daily WHERE client_id = ?1 AND date BETWEEN ?2 AND ?3').bind(clientId, window.from, window.to));
  for (const [k, n] of sources) {
    const [date, source] = k.split('|');
    statements.push(db.prepare('INSERT INTO contact_sources_daily (client_id, date, source, contacts) VALUES (?1, ?2, ?3, ?4)').bind(clientId, date, source, n));
  }
  const displayIds = config.displayPipelineIds?.length ? config.displayPipelineIds : (config.displayPipelineId ? [config.displayPipelineId] : []);
  if (displayIds.length) {
    const pipes = pipelines ?? (await ghl.pipelines(config.locationId)).pipelines;
    statements.push(db.prepare('DELETE FROM pipeline_snapshot WHERE client_id = ?1').bind(clientId));
    displayIds.forEach((pid, rank) => {
      const pipe = pipes.find((p) => p.id === pid);
      if (!pipe) return;
      for (const st of [...pipe.stages].sort((a, b) => a.position - b.position)) {
        const n = opps.filter((o) => o.pipelineId === pipe.id && o.status === 'open' && o.pipelineStageId === st.id).length;
        statements.push(db.prepare('INSERT INTO pipeline_snapshot (client_id, stage_order, stage_name, open_opportunities, pipeline_name) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(clientId, rank * 100 + st.position + 1, st.name, n, pipe.name));
      }
    });
  }
  for (const sql of ROLLUP_STATEMENTS) statements.push(db.prepare(sql).bind(clientId, window.from, window.to));

  // Une seule transaction : tout ou rien. Une coupure ne laisse jamais des compteurs remis à zéro sans être réécrits.
  await db.batch(statements);
  return { opportunities: opps.length, contacts: byContact.size, appointments: events.length, rowsWritten: agg.size, statuses };
}
