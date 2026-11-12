# packages/meta — lot 3

Client de l'API Marketing Meta, **lecture seule** : insights au niveau publicité, découpés par jour, identifiant numérique de publicité compris.
Aucune méthode d'écriture n'existe ici (§19) ; `get` n'émet que des GET, vers graph.facebook.com uniquement, jeton en en-tête.
Permission nécessaire : `ads_read` ; accès « Voir les performances » sur les comptes affectés à l'utilisateur système.
