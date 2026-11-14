import { Hono } from 'hono';
import type { AppEnv } from './env.ts';
import { authenticate } from './auth.ts';
import { HttpError } from './errors.ts';
import { me } from './routes/me.ts';
import { clients } from './routes/clients.ts';
import { agency } from './routes/agency.ts';
import { dev } from './routes/dev.ts';
import { onboarding } from './routes/onboarding.ts';
import { appointments } from './routes/appointments.ts';
import { connections } from './routes/connections.ts';
import { delivery, deliveryAgency, robot } from './routes/delivery.ts';
import { analyses, analysesRobot } from './routes/analyses.ts';
import { pilotage } from './routes/pilotage.ts';
import { reports } from './routes/reports.ts';
import { cash } from './routes/cash.ts';
import { finance } from './routes/finance.ts';
import { resources } from './routes/resources.ts';
import { requests } from './routes/requests.ts';
import { optimisations } from './routes/optimisations.ts';
import { ads } from './routes/ads.ts';
import { prospects } from './routes/prospects.ts';
import { tasks } from './routes/tasks.ts';

const app = new Hono<AppEnv>().basePath('/api');

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  // Journal technique : message seulement, jamais de jeton ni de donnée personnelle.
  console.error('Erreur API', err instanceof Error ? err.message : 'inconnue');
  return c.json({ error: 'Erreur interne.' }, 500);
});
app.notFound((c) => c.json({ error: 'Ressource introuvable.' }, 404));

app.get('/health', (c) => c.json({ ok: true }));
app.route('/dev', dev);
// Génération automatique du delivery : clé dédiée, hors Access (décision 0009).
robot.route('/', analysesRobot);
app.route('/robot', robot);

app.use('*', authenticate);
app.route('/', me);
app.route('/agence', finance);
app.route('/agence', prospects);
app.route('/agence', tasks);
app.route('/agence', requests);
app.route('/agence', agency);
app.route('/clients', onboarding);
app.route('/clients', appointments);
app.route('/clients', connections);
app.route('/clients', delivery);
app.route('/clients', analyses);
app.route('/clients', pilotage);
app.route('/clients', reports);
app.route('/clients', cash);
app.route('/clients', resources);
app.route('/clients', optimisations);
app.route('/clients', ads);
app.route('/', deliveryAgency);
app.route('/clients', clients);

export default app;
