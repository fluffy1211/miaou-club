# Préparation sauvegardes distantes — préproduction fermée

Préparation locale non activée, basée sur `dab0f0a79179e92b038147851949c745e6617a41`. Les règles opérationnelles restent dans [DEVELOPPEMENT](../docs/DEVELOPPEMENT.md) ; les décisions fournisseur restent dans le cadrage local du projet (`docs/FOURNISSEURS.md`, non inclus dans cette copie de livraison). Le bucket B2 privé de préproduction existe depuis le 2026-10-16.

## Entrées et commandes

Installer les dépendances verrouillées, PostgreSQL client **17** et restic **0.19.1** vérifié contre les sommes officielles. Copier `backup-config.example.json` hors Git, remplacer ses valeurs, conserver `enabled:false` et `allowPause:false` tant que l’activation externe n’est pas autorisée. Le workflow `.github/workflows/backup-preproduction.yml` ne fait rien tant que la variable de dépôt `MIAOU_REMOTE_BACKUP_ENABLED` ne vaut pas `true`.

Les chemins doivent être absolus et canoniques : répertoires mode 700, fichiers de configuration et secrets mode 600. Staging, journaux, ancres et répertoire de clé journal sont distincts, sans imbrication. La clé journal contient exactement 32 octets et diffère du mot de passe restic, d’au moins 32 octets. Conserver séparément les deux clés de récupération hors du runner ; sans elles, les archives correspondantes sont inutilisables.

`source.env` contient uniquement les accès opérateur prévus : `DATABASE_URL` Neon directe (sans `-pooler`, `sslmode=verify-full`), `MIAOU_STORAGE_URL` HTTPS, `MIAOU_STORAGE_SECRET` et `MIAOU_STORAGE_BUCKET`. Ce mode refuse `MIAOU_TERMS_VERSION` et les identifiants Google, ainsi que les comptes admis et invitations actives en DB. L’absence de variables dans ce fichier ne prouve pas la configuration effective du service Render : sa fermeture reste une condition à qualifier avant activation. `b2.json` contient un objet JSON avec exactement `AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY`. Le token Render reste dans son fichier dédié. Ne jamais joindre ces fichiers ou clés aux artefacts.

Après autorisation et configuration externes seulement :

```sh
npm run backup:remote -- init /chemin/canonique/config.json
npm run backup:remote -- backup /chemin/canonique/config.json --allow-service-pause
npm run backup:remote -- status /chemin/canonique/config.json
```

`init` initialise le dépôt chiffré. `backup` vérifie la cible fermée et son digest, suspend Render jusqu’à disparition des instances, capture le snapshot PostgreSQL et les WebP conservés, copie le journal chiffré indépendant, puis reprend Render avant archivage restic. Le staging en clair est retiré avant publication du succès. `status` signale absence, échec ou succès de plus de 24 h ; un appel effectif et un canal d’alerte restent nécessaires pour en faire une surveillance. Le fichier optionnel `alertWebhookFile` contient une URL HTTPS ; seul un code technique est envoyé.

## Exercice synthétique

Les fixtures utilisent exclusivement des données synthétiques, une DB PostgreSQL jetable loopback `_test`, et un conteneur PostgreSQL 17 dédié dont le nom commence par `miaou-backup-test-`. Elles créent et suppriment leurs bases aléatoires. Le nom de conteneur et l’URL doivent désigner le même serveur, avec le rôle synthétique `miaou_test`. Elles ne ciblent ni Neon ni Supabase. Le workflow CI `backup-rehearsal.yml` exécute cet exercice sous Linux, sans accès fournisseur et sans activer le workflow de sauvegarde distant.

```sh
TEST_DATABASE_URL='postgresql://…@127.0.0.1:PORT/admin_test' \
MIAOU_BACKUP_TEST_CONTAINER=miaou-backup-test-IDENTIFIANT \
MIAOU_RESTIC_BINARY=/chemin/canonique/restic \
npm run backup:rehearse
```

La restauration opérationnelle n’est pas exposée par ce lanceur. `restoreQuarantine` est exercée sur PostgreSQL local : base vide `_quarantine`, connexion de contrôle superutilisateur séparée, stockage isolé, contrôles SHA256 et journal indépendant. Après restauration, les admissions sont fermées, sessions/liens/exports/OAuth neutralisés, restrictions rejouées et nouvelles connexions DB interdites. Aucune API n’est rouverte automatiquement.

## Limites avant activation

- Compte/bucket B2, cadre contractuel, accès restreints et gestion des versions à configurer et vérifier. `forget --prune` ne prouve pas la disparition physique des versions B2 ; rétention cible des snapshots 28 jours, maximum opérationnel 30 jours.
- Aucun flux réel Neon/Supabase/B2, pause Render, alerte distante ou exécution GitHub validé. Le client dump est borné ; la mort brutale du runner pendant la pause peut laisser Render suspendu. Une reprise externe doit être qualifiée avant exploitation. La disparition des instances ne prouve pas le drainage des requêtes Storage déjà reçues ; ce point reste à qualifier.
- Le modèle GitHub est quotidien et indépendant du Mac, mais un cron GitHub peut être retardé ou omis. Un planning seul ne garantit ni RPO 24 h, ni détection d’un lancement absent. Le modèle ne recharge pas le statut du lancement précédent : son historique reste dans les artefacts, sans surveillance inter-exécutions qualifiée.
- Le journal copié concerne la nouvelle base au moment de sa capture. Il ne rafraîchit pas les journaux des anciennes bases retenues. `uncopiedAfterCut:"unknown"` reste exact ; une restauration ancienne ne prouve pas l’application de restrictions plus récentes. Cette préparation fermée ne constitue pas un système de sauvegarde du pilote ouvert.
