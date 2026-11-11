# jobs/sync-daily — lot 3

Cron à 6 h 00 heure de Paris. Pour chaque client actif : Meta (7 derniers jours réécrits), puis GHL, puis rollup (`packages/domain/src/rollup.ts`), puis règles, puis recommandations. Idempotent, isolé par client, journalisé dans `sync_runs`.
