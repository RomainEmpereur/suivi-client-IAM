import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(public status: ContentfulStatusCode, message: string) {
    super(message);
  }
}

/** Réponse uniforme pour une ressource absente OU d'un autre client (on ne révèle pas l'existence). */
export const notFound = () => new HttpError(404, 'Ressource introuvable.');
export const forbidden = (msg = 'Action non autorisée.') => new HttpError(403, msg);
