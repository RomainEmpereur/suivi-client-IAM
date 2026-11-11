/**
 * Import PONCTUEL à partir d'exports lus par les connecteurs MCP Meta et GoHighLevel (décision 0006).
 * Transitoire : la synchronisation quotidienne du lot 3 remplacera ces données (source = 'mcp').
 *
 * Aucun chiffre n'est saisi à la main : tout est lu dans les fichiers d'export, puis contrôlé
 * (le total de dépense doit égaler le total du compte passé en argument, au centime près).
 *
 * Usage :
 *   node --experimental-strip-types scripts/import-mcp.ts config.json > import.sql
 * config.json :
 *   { clientId, metaCampaignDaily, accountSpendCheck, ghlOpportunities: [..], ghlEvents,
 *     r1StageId, postCallStageIds: [..], noShowStageIds: [..], wonStageIds: [..], stageOrder: {stageId: [pos, name]} }
 */
import { readFileSync } from 'node:fs';
import { rollupSql } from '../packages/domain/src/index.ts';

interface Config {
  clientId: string;
  metaCampaignDaily: string;
  accountSpendCheck: string; // ex. "1525.47"
  ghlOpportunities: string[];
  ghlEvents: string; // [[id, contactId, start, dateAdded, status, nomAffiché, motifExclusion], …]
  postCallStageIds: string[];
  noShowStageIds: string[];
  wonStageIds: string[];
  stageOrder: Record<string, [number, string]>;
}

const cfg: Config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const q = (v: unknown): string =>
  v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const cents = (s: string) => {
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2)) * (s.startsWith('-') ? -1 : 1);
};
const int = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
/** Jour calendaire à Paris d'un horodatage. */
const parisDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// ─── Meta : jour × campagne ────────────────────────────────────────────────
const metaRaw = JSON.parse(readFileSync(cfg.metaCampaignDaily, 'utf8'));
const meta: any[] = typeof metaRaw.ad_entities === 'string' ? JSON.parse(metaRaw.ad_entities) : metaRaw.ad_entities;
const units = new Set(meta.filter((r) => r.amount_spent).map((r) => r.amount_spent.unit));
if (units.size !== 1 || !units.has('EUR')) throw new Error(`Devise inattendue : ${[...units].join(', ')}`);
const from = meta.reduce((m, r) => (r.date_start < m ? r.date_start : m), '9999');
const to = meta.reduce((m, r) => (r.date_start > m ? r.date_start : m), '0000');
const spendTotal = meta.reduce((s, r) => s + (r.amount_spent ? cents(r.amount_spent.value) : 0), 0);
if (spendTotal !== cents(cfg.accountSpendCheck)) {
  throw new Error(`Contrôle échoué : dépense ${spendTotal} c ≠ total du compte ${cents(cfg.accountSpendCheck)} c`);
}
const campaignNames = new Map<string, string>(meta.map((r) => [r.id, r.name]));
const campaignBudget = new Map<string, number | null>();
for (const r of meta) if (r.daily_budget?.value) campaignBudget.set(r.id, cents(r.daily_budget.value));

type Row = Record<string, number | string | null>;
const rows = new Map<string, Row>(); // clé : date|campagne
const NR = 'non_rattache';
function row(date: string, campaignId: string): Row {
  const key = `${date}|${campaignId}`;
  let r = rows.get(key);
  if (!r) {
    r = {
      client_id: cfg.clientId, date, ad_id: `campagne:${campaignId}`, campaign_id: campaignId, adset_id: '',
      campaign_name: campaignId === NR ? 'Non rattaché à une campagne' : campaignNames.get(campaignId) ?? campaignId,
      adset_name: null, ad_name: null, ad_status: null,
      campaign_daily_budget_cents: campaignBudget.get(campaignId) ?? null,
      spend_cents: 0, spend_original_minor: 0, currency: 'EUR', fx_rate_to_eur: 1,
      impressions: 0, frequency: null, link_clicks: 0, landing_page_views: 0, vsl_views: 0, thruplays: 0, video_plays: 0,
      leads: 0, crm_contacts: 0, appointments_booked: 0, appointments_held: 0, sales: 0, cash_collected_cents: 0, source: 'mcp',
    };
    rows.set(key, r);
  }
  return r;
}
for (const m of meta) {
  const spend = m.amount_spent ? cents(m.amount_spent.value) : 0;
  const imp = int(m.impressions);
  if (!spend && !imp && !int(m.lead)) continue;
  const r = row(m.date_start, m.id);
  r.spend_cents = spend; r.spend_original_minor = spend;
  r.impressions = imp; r.frequency = m.frequency ? Number(m.frequency) : null;
  r.link_clicks = int(m.link_click); r.landing_page_views = int(m.landing_page_view);
  r.video_plays = int(m.video_play_actions); r.thruplays = int(m.video_thruplay_watched_actions);
  r.leads = int(m.lead);
  r.ad_status = m.effective_status ?? null;
}
const inWindow = (d: string) => d >= from && d <= to;
const knownCampaign = (id: string | null | undefined) => (id && campaignNames.has(id) ? id : NR);

// ─── GoHighLevel : opportunités ────────────────────────────────────────────
const opps: any[] = cfg.ghlOpportunities.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).data.opportunities);
const oppCampaign = (o: any): string | null =>
  (o.attributions ?? []).find((a: any) => a.utmCampaignId)?.utmCampaignId ?? null;
const isMeta = (o: any) =>
  Boolean(oppCampaign(o)) || /facebook|instagram|meta/i.test(String(o.source ?? '')) ||
  (o.attributions ?? []).some((a: any) => /facebook|ig|instagram/i.test(String(a.utmSource ?? a.adSource ?? '')));
const byContact = new Map<string, any>(opps.map((o) => [o.contactId, o]));
const sources = new Map<string, number>(); // date|source

for (const o of opps) {
  const day = parisDay(o.createdAt);
  if (!inWindow(day)) continue;
  const cr = row(day, knownCampaign(oppCampaign(o)));
  cr.crm_contacts = Number(cr.crm_contacts) + 1;
  const src = isMeta(o) ? 'Meta' : 'Autre';
  sources.set(`${day}|${src}`, (sources.get(`${day}|${src}`) ?? 0) + 1);
  if (cfg.wonStageIds.includes(o.pipelineStageId) && o.lastStageChangeAt) {
    const wonDay = parisDay(o.lastStageChangeAt);
    if (inWindow(wonDay)) { const r = row(wonDay, knownCampaign(oppCampaign(o))); r.sales = Number(r.sales) + 1; }
  }
}

// ─── GoHighLevel : rendez-vous (règle de statut de la décision 0006) ──────────
const events: [string, string, string, string, string, string, string][] = JSON.parse(readFileSync(cfg.ghlEvents, 'utf8'));
const now = Date.now();
const apptSql: string[] = [];
const statusCount: Record<string, number> = {};
for (const [id, contactId, start, added, ghlStatus, name, excl] of events) {
  const o = byContact.get(contactId);
  const stage = o?.pipelineStageId;
  let status: string;
  if (ghlStatus === 'cancelled') status = 'annule';
  else if (ghlStatus === 'noshow' || (stage && cfg.noShowStageIds.includes(stage))) status = 'absent';
  else if (ghlStatus === 'showed' || (stage && cfg.postCallStageIds.includes(stage))) status = 'honore';
  else status = 'prevu';
  if (status === 'honore' && Date.parse(start) > now) status = 'prevu'; // garde-fou : pas d'« honoré » dans le futur
  statusCount[status] = (statusCount[status] ?? 0) + 1;
  const campaign = o ? oppCampaign(o) : null;
  const isTest = Boolean(excl);
  apptSql.push(`INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, campaign_id, ad_id, counts_toward_target, exclusion_reason) VALUES (${[
    q(`ap_${cfg.clientId}_${id}`), q(cfg.clientId), q(id), q(name), q(new Date(added).toISOString()), q(new Date(start).toISOString()),
    q(status), q(campaign), q(o ? (o.attributions ?? []).find((a: any) => a.utmAdId)?.utmAdId ?? null : null),
    isTest ? 0 : 1, q(excl || null),
  ].join(', ')});`);
  if (isTest) continue; // un test n'est pas un rendez-vous pris
  const bookedDay = parisDay(added);
  if (inWindow(bookedDay)) {
    const r = row(bookedDay, knownCampaign(campaign));
    r.appointments_booked = Number(r.appointments_booked) + 1;
    if (status === 'honore') r.appointments_held = Number(r.appointments_held) + 1;
  }
}

// ─── Instantané du pipeline : opportunités ouvertes par étape ─────────────────
const openByStage = new Map<string, number>();
for (const o of opps) if (o.status === 'open') openByStage.set(o.pipelineStageId, (openByStage.get(o.pipelineStageId) ?? 0) + 1);

// ─── SQL ─────────────────────────────────────────────────────────────────
const out: string[] = [];
out.push(`-- Import ponctuel MCP — client ${cfg.clientId} — fenêtre ${from} → ${to} — généré le ${new Date().toISOString()}`);
out.push(`DELETE FROM metrics_daily WHERE client_id = ${q(cfg.clientId)} AND source = 'mcp';`);
out.push(`DELETE FROM metrics_rollup WHERE client_id = ${q(cfg.clientId)};`);
out.push(`DELETE FROM appointments WHERE client_id = ${q(cfg.clientId)};`);
out.push(`DELETE FROM pipeline_snapshot WHERE client_id = ${q(cfg.clientId)};`);
out.push(`DELETE FROM contact_sources_daily WHERE client_id = ${q(cfg.clientId)};`);
for (const r of rows.values()) {
  const cols = Object.keys(r);
  out.push(`INSERT INTO metrics_daily (${cols.join(', ')}) VALUES (${cols.map((c) => q(r[c])).join(', ')});`);
}
out.push(...apptSql);
for (const [k, n] of sources) {
  const [date, source] = k.split('|');
  out.push(`INSERT INTO contact_sources_daily (client_id, date, source, contacts) VALUES (${q(cfg.clientId)}, ${q(date)}, ${q(source)}, ${n});`);
}
for (const [stageId, [pos, name]] of Object.entries(cfg.stageOrder)) {
  out.push(`INSERT INTO pipeline_snapshot (client_id, stage_order, stage_name, open_opportunities) VALUES (${q(cfg.clientId)}, ${pos}, ${q(name)}, ${openByStage.get(stageId) ?? 0});`);
}
out.push(rollupSql(cfg.clientId, from, to));
const finished = new Date().toISOString();
for (const src of ['meta', 'ghl']) {
  out.push(`INSERT INTO sync_runs (id, client_id, source, started_at, finished_at, rows_written, ok) VALUES (${q(`sr_mcp_${src}_${Date.now()}`)}, ${q(cfg.clientId)}, ${q(src)}, ${q(finished)}, ${q(finished)}, ${rows.size}, 1);`);
}
process.stdout.write(out.join('\n') + '\n');

// Contrôles affichés (stderr) : aucun chiffre ne sort du script sans être vérifiable.
const sum = (k: string) => [...rows.values()].reduce((s, r) => s + Number(r[k] ?? 0), 0);
console.error(JSON.stringify({
  fenetre: [from, to], lignes: rows.size, depense_cents: sum('spend_cents'), impressions: sum('impressions'),
  clics: sum('link_clicks'), leads: sum('leads'), contacts_crm: sum('crm_contacts'), rdv_pris: sum('appointments_booked'),
  rdv_honores: sum('appointments_held'), ventes: sum('sales'), statuts_rdv: statusCount,
}, null, 1));
