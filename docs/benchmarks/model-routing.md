# Modèles Miaou Club — premiers essais

11 octobre 2026. Routage exploratoire pour le [workflow du projet](../DEVELOPPEMENT.md#orchestration), révisable selon les résultats des vraies tranches. Les essais ne qualifient ni l'architecture complète, ni les permissions de Miaou Club.

## Résultats exécutés

27 appels Codex CLI : 3 modèles × 3 tâches × 3 essais, effort `low`, nouveaux contextes temporaires, mêmes consignes utilisateur. CLI `0.162.0-alpha.2`. Réponses structurées évaluées automatiquement ; erreurs et timeouts conservés. Une première passe de 9 appels, puis 2 répétitions par modèle ; les numéros de run redémarrent dans la seconde invocation, les dates distinguent les observations.

| Tâche synthétique                             | GPT-5.6 Luna | GPT-6 Luna | GPT-6.1 Sol            |
| --------------------------------------------- | ------------ | ---------- | ---------------------- |
| Filtre, premier doublon et tri numérique JSON | 2/3          | 3/3        | 3/3                    |
| Pagination : bornes et valeurs invalides      | 2/3          | 3/3        | 3/3                    |
| Revue de deux contournements de suspension    | 3/3          | 0/3        | 2 réussites, 1 timeout |

Défauts observés : GPT-5.6 Luna conserve une fois le dernier doublon plutôt que le premier ; une réponse de pagination fournit une déclaration `const` malgré le contrat « expression de fonction » (code non conforme au format d'exécution, pas un bug de pagination démontré). GPT-6 Luna manque les trois fois le contournement de suspension sur les objets publics. Le timeout Sol de 90 secondes laisse la qualité de cette réponse inconnue.

La revue indépendante du harness a détecté deux oracles trop permissifs : tri lexicographique et taille par défaut `100` acceptés. Ils sont corrigés, leurs mutants sont maintenant refusés. Les 27 réponses ont été réévaluées sans réinférence avec les nouveaux oracles ; le tableau ci-dessus utilise ces résultats. Les consignes des trois tâches n'ont pas changé. Les premières lignes n'ayant pas d'empreinte de prompt, le replay les marque `legacy_unverified` ; la compatibilité a été vérifiée par lecture des consignes initiales, pas par comparaison d'empreintes. Les prochaines inférences enregistrent séparément les empreintes de prompt et d'oracle.

Les [résultats JSONL](model-routing-2026-10-11.jsonl) conservent réponses, évaluations initiales/finales, durées et usage reçu. Ce sont des fixtures synthétiques, sans membre réel ni secret. Le cas « permissions » suit les règles explicites de sa fixture, pas une copie des règles métier du pilote.

## Consommation reçue du CLI

| Modèle       | Appels avec usage reçu | Tokens entrée | Dont entrée en cache | Tokens sortie |
| ------------ | ---------------------- | ------------: | -------------------: | ------------: |
| GPT-5.6 Luna | 9/9                    |       161 495 |               27 136 |         1 236 |
| GPT-6 Luna   | 9/9                    |       162 608 |               17 152 |           865 |
| GPT-6.1 Sol  | 8/9                    |       198 596 |                    0 |           815 |

Les tokens en cache sont inclus dans l'entrée, pas à additionner. L'usage du timeout n'a pas été reçu : le total Sol est incomplet. Les modèles ont des instructions système différentes malgré les mêmes consignes utilisateur ; les entrées comprennent le contexte Codex, pas seulement les quelques lignes de la tâche. Les durées incluent initialisation, réseau et CLI ; des ralentissements et erreurs de découverte réseau ont été observés. Aucun classement de latence, de coût monétaire ou de consommation d'abonnement n'est établi. GPT-5.6 Luna n'a pas produit moins de tokens de sortie que GPT-6 Luna dans cette série.

## Routage retenu

| Besoin                                                                                           | Choix initial                  | Limite                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------ |
| Extraction exacte de données synthétiques avec vérification déterministe                         | GPT-5.6 Luna, essai provisoire | Smoke isolé réussi une fois ; pas de qualification répétée               |
| Transformation JSON ou pagination entièrement spécifiées et testables                            | GPT-6 Luna                     | 3/3 sur chaque fixture ; généralisation au code réel à vérifier          |
| Composant/service limité avec contrats établis                                                   | GPT-6 Luna supervisé           | Pas encore benchmarké sur une vraie tranche du projet                    |
| Plan, architecture, diagnostic ambigu, permissions, auth, médias privés, migrations, concurrence | GPT-6.1 Sol                    | Choix conservateur ; pas une supériorité universelle démontrée           |
| Revue finale du diff réel                                                                        | GPT-6.1 Sol                    | Complétée par les contrôles du projet et la CI si livraison autorisée |

Smoke de délégation séparé : sous-agent `gpt-5.6-luna`, effort `low`, contexte `fork_turns: none`, via les outils de ce chat ; extraction exacte `M-8`, `M-21` réussie parmi cinq statuts. Aucun usage tokens reçu pour ce smoke, donc exclu du tableau et des 27 appels. Le test CLI natif de délégation aux rôles TOML a été arrêté après des erreurs réseau ; leur invocation native n'est pas confirmée par ce test. Le CLI accepte la configuration projet en mode strict et le skill est présent dans son prompt natif ; la délégation avec choix explicite du modèle fonctionne dans ce chat.

Un essai CLI du quatrième cas `status-extraction` n'a pas démarré : la revue automatique d'autorisation a dépassé son délai avant création du processus. Ce n'est ni un échec de ce modèle ni une preuve de qualité. Les 9 échecs d'initialisation du premier lancement sous sandbox sont également exclus des scores : aucun appel modèle n'était démontré.

## Réutilisation

`node scripts/model-benchmark.mjs --self-test` valide les oracles avec candidats corrects et mutants. `--dry-run` expose tâches, schéma et empreintes sans appel modèle. `--tasks status-extraction` permet une mesure ciblée. `--replay INPUT.jsonl --output OUTPUT.jsonl` réévalue sans réseau ; un changement de prompt est signalé et ne reçoit pas de score. Live et replay retournent un code non nul en cas d'échec ou d'indisponibilité. Une entrée replay vide ou sans observation correspondant aux tâches sélectionnées est refusée avant toute création de sortie ; quatre régressions CLI sont intégrées aux tests du projet, sans appel de modèle.

Une relance live consomme de l'usage et doit être demandée ou liée à une évaluation autorisée. Elle n'est pas déclenchée à chaque tâche. Avant d'étendre le routage à d'autres modèles, comparer des tâches et risques pertinents, avec critères fixes et plusieurs observations ; conserver aussi les échecs. Contrôler chaque production réelle, puis juger les économies sur la tranche complète, corrections et revue incluses.
