import { useState } from 'preact/hooks';
import { formatDate, formatInt, type AppointmentCounter } from '@obsidian/domain';

/** Compteur contractuel (§8) — la donnée la plus sensible du produit. Définition accessible en un clic. */
export function Counter({ clientId, counter }: { clientId: string; counter: AppointmentCounter }) {
  const [open, setOpen] = useState(false);
  const pct = Math.min(100, (counter.validated / counter.target) * 100);
  return (
    <div class="card edge" style={{ '--edge': counter.onPace ? 'var(--accent)' : 'var(--alert)' }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div class="counter">
        <div>
          <div class="label">Rendez-vous validés</div>
          <div class="counter-big">{counter.validated} <span>/ {counter.target}</span></div>
        </div>
        <div style="flex:1;min-width:220px">
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={counter.target} aria-valuenow={counter.validated}
            aria-label="Rendez-vous validés sur l'objectif"><div style={{ width: `${pct}%` }} /></div>
          <div class="small muted" style="margin-top:8px">
            {counter.daysRemaining} jours restants sur {counter.windowDays} · fenêtre du {formatDate(counter.windowStart)} au {formatDate(counter.windowEnd)} (exclu)
          </div>
          <div class="small" style="margin-top:2px">
            {counter.onPace
              ? <span style="color:var(--accent)">Dans le rythme ({formatInt(Math.floor(counter.expectedByNow))} attendus à ce jour)</span>
              : <span style="color:var(--alert)">En retard sur le rythme : {formatInt(Math.floor(counter.expectedByNow))} attendus à ce jour{counter.requiredPerWeek != null ? `, ${String(counter.requiredPerWeek).replace('.', ',')} par semaine nécessaires` : ''}</span>}
          </div>
        </div>
        <div class="small" style="display:flex;flex-direction:column;gap:2px;min-width:170px">
          {counter.pendingStatus > 0 && <span style="color:var(--warn)">{counter.pendingStatus} passé{counter.pendingStatus > 1 ? 's' : ''} sans statut (non comptés)</span>}
          <span class="muted">{counter.upcoming} à venir · {counter.excluded} exclu{counter.excluded > 1 ? 's' : ''}</span>
          <button type="button" class="ghost-btn" style="margin-top:6px" aria-expanded={open} onClick={() => setOpen(!open)}>Définition et liste datée</button>
        </div>
      </div>
      {open && (
        <div class="definition">
          {counter.definition} <a href={`/c/${clientId}/rendez-vous`}>Voir la liste datée des rendez-vous →</a>
        </div>
      )}
    </div>
  );
}
