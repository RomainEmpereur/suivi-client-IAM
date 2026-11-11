import type { MiddlewareHandler } from 'hono';
import type { AppEnv, ClientRow } from './env.ts';
import { first } from './db.ts';
import { notFound } from './errors.ts';

/**
 * Isolation des données (§4, §16) : le client_id effectif est vérifié côté serveur à chaque requête.
 * - Un utilisateur client ne peut cibler que SON client ; tout autre identifiant → 404
 *   (même réponse qu'un identifiant inexistant : on ne révèle pas l'existence d'un autre client).
 * - Les clients de démonstration n'existent pas en production.
 */
export const scopeClient: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  const clientId = c.req.param('clientId');
  if (!clientId) throw notFound();
  if (user.role === 'client' && user.client_id !== clientId) throw notFound();

  const client = await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', clientId);
  if (!client) throw notFound();
  if (client.is_demo && c.env.ENVIRONMENT === 'production') throw notFound();

  c.set('client', client);
  await next();
};
