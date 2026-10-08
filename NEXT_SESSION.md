# Miaou Club — reprise orchestration locale

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
