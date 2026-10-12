# Miaou Club — reprise workflow de modèles

11 octobre 2026. Publication autorisée par Gabriel ; checkout isolé `model-orchestration/cats`, branche `chore/model-orchestration`, base develop `29556d7`. Vérifier branche et status à chaque reprise. Cette tranche ne modifie pas les sources applicatives ni la CI.

### Workflow de modèles et benchmark — publication autorisée, 11 octobre

Gabriel autorise l'orchestration des prochaines tranches demandées et la comparaison de modèles, y compris plus petits. Routage dans [DEVELOPPEMENT#orchestration](docs/DEVELOPPEMENT.md#orchestration), skill `miaou-orchestrate`, configuration projet et trois rôles TOML : Sol planifie/revoit, Luna implémente les tâches délimitées, GPT-5.6 Luna réservé aux extractions simples vérifiables à titre provisoire. Aucune autorisation de lancer tous les lots ou de publier n'en découle.

27 appels CLI synthétiques (3 modèles × 3 cas × 3 essais), puis réévaluation des réponses avec oracles corrigés sans nouvelle inférence. [Résultats et limites](docs/benchmarks/model-routing.md), données JSONL conservées. Contrôles locaux : syntaxe/lint du script, self-test avec mutants, replay et conservation des mesures, frontmatter YAML et TOML valides. Validation YAML native du skill indisponible avec le Python courant (PyYAML absent), parser YAML du projet utilisé. Le skill apparaît dans le prompt natif ; `codex exec --strict-config` réussit un smoke sans outil. Délégation réelle GPT-5.6 Luna via les outils de ce chat : extraction exacte réussie. Invocation des rôles TOML dans le CLI non confirmée : smoke arrêté après erreurs réseau. Un essai d'extraction CLI supplémentaire n'a pas démarré, revue automatique d'autorisation expirée ; aucun score ni usage inventé.

Revue indépendante : deux défauts des oracles détectés puis corrigés et vérifiés (tri numérique, taille par défaut) ; retour shell du replay corrigé également. Publication autorisée par Gabriel dans ce chat ; worktree isolé `model-orchestration`, branche `chore/model-orchestration`, base develop `29556d7`. Travail applicatif/CI concurrent préservé, aucun déploiement. **Suite :** appliquer le workflow sur la prochaine tranche explicitement demandée, contrôler le code réel et consigner qualité/corrections/usage disponible ; aucun gain global de tokens établi. Les résultats à trois essais restent exploratoires.

### Correctif de vérification — autorisé le 12 octobre 2026

Le premier hook complet avait réussi les contrôles statiques/builds et 84 tests serveur, puis échoué sur un E2E WebKit de reprise de zone (39/40). Reproduction isolée : attente de l’interception après navigation, pas une panne du workflow. Gabriel autorise explicitement la correction de cette fixture et la poursuite de la publication.

Une seule route réseau est maintenant installée avant la première navigation puis armée après sélection ; téléchargement retardé/avorté et assertions de protection inchangés. Quatre régressions Chromium/WebKit réussies sans réessai (24,4 s), ESLint et diff check réussis ; seconde lecture sans défaut démontré. Aucun changement applicatif. La première route stable suffisait aux quatre tests ciblés, mais pas toujours à la batterie complète. La fixture sert désormais le vrai module géographique avec `Cache-Control: no-store` pour exercer le téléchargement à froid ; seuls les headers de cette réponse de test changent. Batterie complète E2E : 40/40 réussis, sans réessai (2,6 min). Seconde lecture du complément sans défaut démontré. Un test journal inchangé avait aussi échoué ponctuellement puis réussi isolément et dans la nouvelle batterie de 84 tests serveur ; sa cause reste non confirmée. Le hook complet du prochain push, la CI et Greptile sur le SHA publié restent requis avant fusion.

### Review Greptile PR #17 — 12 octobre 2026

CI `38232387387` réussie sur `d0bd9c1`, Greptile 4/5 sur ce SHA avec un P2 confirmé : le replay retournait 0 pour une entrée vide ou une tâche sans observation. Le défaut a été reproduit avant correction. Filtre et rejet explicite avant création de sortie ; quatre régressions CLI passent (vide, sous-ensemble absent, succès et échec archivés). Tests sans modèle externe, mesures/réponses conservées ; lint/format/syntaxe et seconde lecture réussis. Nouveau hook, CI et review du prochain SHA requis avant fusion.

## Historique conservé de la tranche précédente

Les notes ci-dessous sont datées et ne décrivent pas le checkout courant.

### Orchestration locale — notes du 8 octobre

8 octobre 2026. Checkout isolé `2c34/cats`, HEAD détachée `2f811c4ef4272a57639404b6ecbc83dc15f3c4cb`, changements locaux non committés. PR #13 fusionnée ; CI post-fusion `37693421976` vérifiée réussie sur ce SHA (verify:full, Docker/smoke/Trivy). Autorisation de cette tranche : code, références affectées, vérification et auto-revue locales uniquement. Autres checkouts/configurations préservés.

Livré localement : `recovery:local -- manage-<backup|copy|status|rotate> <répertoire-géré>`, catalogue chiffré/authentifié durable, verrou de session, reprise des publications/suppressions interrompues, détection de copie absente/retardée, rotation selon date initiale du backup avec conservation de sa dernière paire utilisable. Usage et limites : [DEVELOPPEMENT — sauvegardes](docs/DEVELOPPEMENT.md#sauvegardes). Aucun schéma modifié, scheduler/automation activé ou règle produit ajoutée.

Preuves : `verify` réussi (14 tests catalogue, format/lint/types, builds application/backend/Storybook), 83 tests serveur réussis, puis sept scénarios d’orchestration revérifiés après corrections finales. Fixtures synthétiques, PostgreSQL 18 jetable loopback `_test`, UTF-8/UTC ; instance arrêtée/nettoyée en fin de travail. Service PostgreSQL 17/Docker OrbStack sans réponse : aucun redémarrage ni modification de sa configuration. Deux échecs d’expiration initiaux causés par la configuration Europe/Paris de notre fixture, résolus en alignant celle-ci sur UTC, assertions inchangées. Audit high réussi : six alertes modérées préexistantes d’outillage avec lockfile inchangé.

Auto-revue `miaou-review` : base/merge-base/HEAD `2f811c4`, index vide, diff local et nouveau module examinés. Reprise après SIGKILL, pannes backup/copie/empreinte, réessais, concurrence, état incohérent, borne de trente jours et restauration après destruction de source vérifiés. Aucun défaut démontré restant. Verdict initial **incomplet**, remplacé par la validation complémentaire ci-dessous. Publication non autorisée, aucun commit/push/PR.

Suite : livraison Git sous autorisation distincte ; validation locale complémentaire terminée ci-dessous. Les commandes de gestion exigent une source disponible ; seuls les événements déjà copiés survivent (`uncopiedAfterCut: "unknown"`). Clés/empreintes intactes requises ; rollback simultané copie/empreinte indétectable localement. État/CLI ne constituent ni alertes ni sauvegardes distantes. Planification/rétention distante, RPO/RTO, fournisseurs et ouverture pilote restent hors preuve ; lot 6 et pilote non complets.


## Validation complémentaire — 8 octobre 2026

Gabriel autorise la fin de validation locale. Docker répond à nouveau ; PostgreSQL **17.7** jetable dédié, tmpfs et port loopback 54338, sans toucher aux services/base de développement. `test:server` : **83/83 réussis**, dont les sept scénarios d’orchestration (échecs I/O, concurrence, SIGKILL, rotation/reprise et restauration après destruction de source). `verify` : format/lint/types, **14 tests catalogue/outillage**, builds application/backend/Storybook réussis. `test:e2e` hors sandbox : **34/34 Chromium/WebKit réussis, zéro réessai**, 2,3 min ; attente des exports conforme au passage de maintenance toutes les minutes. Composants de `verify:full` exécutés séparément, tous réussis.

Gitleaks : aucune fuite détectée ; actionlint réussi ; audit npm high réussi avec **quatre alertes modérées d’outillage** (lockfile inchangé). Image `miaou-orchestration:local` construite, SHA `67b17ee03454cae2080ae687c88d63406901c6fe1b08dec4a664c3ba357ea909` ; smoke avec migrations compilées, santé/readiness PostgreSQL, rendu et refus API/images réussi ; Trivy HIGH/CRITICAL réussi. PostgreSQL jetable et serveurs E2E arrêtés après validation.

Revue finale selon miaou-review : base/merge-base/HEAD `2f811c4`, index vide ; diff local complet, nouveau module et appelants examinés, aucune modification applicative nécessaire dans cette reprise. Aucun défaut bloquant démontré ; diff sans erreurs. Verdict : **prêt pour push sous autorisation**. Aucun commit/push/PR/déploiement ; prochaine étape : livraison Git si autorisée, puis CI/review distante. Limites opérationnelles ci-dessus inchangées : exercice synthétique local, pas de scheduler/alertes/sauvegardes distantes ni preuve RPO/RTO.


## Livraison autorisée — 8 octobre 2026

Gabriel demande « push » : branche `feat/local-recovery-orchestration` depuis develop `2f811c4`, commit/push et PR vers develop, suivi CI/Greptile puis fusion selon DEVELOPPEMENT#review. Aucun déploiement ni activation fournisseur. Validation complète ci-dessus ; hook normal conservé.


## Correctifs de review PR #14 — 8 octobre 2026

PR #14 sur `49af5f2`, première CI `37754665761` entièrement réussie ; Greptile terminé sur ce SHA, deux défauts confirmés. Régressions rouges exécutées : statut d’archive absente ENOENT, réessai d’archive partielle bloqué par digest mismatch. Correction : résolution des seules intentions non publiées sans copie/empreinte avant rotation, aucun écrasement d’archive retenue ; statut interrupted pour intention non publiée. Huit tests ciblés orchestration réussis, corruption retenue toujours refusée et paire existante préservée. Revue du diff ciblé sans autre défaut démontré ; hook complet et CI/review dernier SHA requis avant fusion.
## Optimisation CI Playwright — 8 octobre 2026

Livraison vers develop autorisée par Gabriel. Branche isolée `chore/ci-playwright-image` depuis `2f811c4` ; aucun fichier concurrent du checkout principal inclus. E2E dans l’image officielle Playwright Noble correspondant à la version installée, avec Node du runner ; toutes les commandes de `verify:full` conservées en étapes nommées. Pic APT de 6 min 51 s confirmé dans la CI `37691534731`. Vérifications préalables : YAML/actionlint/diff, builds et 26 E2E sur copie Linux du précédent HEAD. Le hook complet du develop actuel et la CI/review du dernier SHA restent à obtenir avant fusion. Gain distant à mesurer ; aucun déploiement.


## Intégration du develop concurrent — 8 octobre 2026

CI `37756395363` sur `9a5dacc` entièrement réussie (attempt 2) ; attempt 1 annulée après diagnostic de téléchargements Ubuntu Azure très lents avant les tests, aucun contrôle modifié. Greptile 5/5 terminé sur `9a5dacc`, deux discussions résolues, aucun nouveau défaut actionnable. Develop a avancé à `c967e45` (PR #16, optimisation CI Playwright) : fusion de cette base, seul conflit documentaire NEXT_SESSION résolu en conservant les deux reprises. Aucun changement applicatif induit ; hook et nouvelle CI/review sur le SHA de fusion à obtenir avant fusion de PR #14.


## Chargement géographique différé — 8 octobre 2026

Tranche autorisée par Gabriel, reportée dans le worktree isolé `lazy-geography` sur `fix/lazy-geographic-loading` depuis develop `2f811c4`. Création de PR vers develop demandée ; aucun déploiement. Les changements/configurations/maquettes du checkout principal restent préservés.

Carte et géographie chargées à la demande : accueil/carnet/formulaire sans lieu sans JavaScript géographique ; aperçu, GPS et reprise manuelle conservent les validations existantes. Imports indisponibles : message lisible, publication sans lieu possible et retrait disponible. Aucune modification backend, migration ou seuil d’avertissement. Les chunks géographiques et MapLibre restent lourds mais différés ; aucun gain de latence mesuré.

Auto-revue miaou-review : base/HEAD `2f811c4`, quatre composants modifiés, nouveau wrapper et régressions E2E relus ; travaux antérieurs exclus. Vérifications complètes sur cette base réussies : 14 tests catalogue/outillage, 76 tests serveur, 36 E2E Chromium/WebKit, format/lint/types et builds application/backend/Storybook, audit high, Gitleaks/actionlint. Le nouveau test utilise une fixture amie distincte par navigateur après avoir reproduit un dépassement du quota du compte reader partagé ; aucune limite/assertion affaiblie. Verdict : prêt pour push sous autorisation, auto-revue uniquement. Prochaine action : publier la PR après hook réussi, puis vérifier CI/Greptile sur son SHA. Aucun fournisseur activé ni ouverture pilote.


## Reprise de livraison — 11 octobre 2026

PR #14 fusionnée vers develop en `8353b66` après CI complète et Greptile sur `404605f`, deux discussions résolues. CI de fusion `38162858525` en cours. PR #16 déjà fusionnée. PR #15 : intégration de develop `8353b66`, seul conflit documentaire résolu en conservant les reprises. Deux défauts Greptile corrigés : formulaire bloqué pendant la reprise de zone ; échec du téléchargement explicite, lieu précédent conservé et sélection non appliquée supprimée. Quatre régressions ciblées réussies sur Chromium/WebKit après build, cache désactivé dans le test pour exercer la requête réelle. Auto-revue du diff applicatif complet sans autre défaut démontré ; hook complet, CI et nouvelle review du SHA publié restent requis. Aucun déploiement ou service externe activé.
