@AGENTS.md

# Claude Code : modèles et économie d'outils

Complète AGENTS.md pour Claude Code. En cas de conflit, les consignes de Gabriel dans le chat priment, puis AGENTS.md. Équivalent des rôles `.codex/agents/` et du skill `.agents/skills/miaou-orchestrate/SKILL.md`.

## Orchestration des modèles

Le chat principal (Opus 5.5, réglé dans `.claude/settings.json`) planifie, tranche les cas ambigus, contrôle les résultats et fait la revue finale. Il délègue le reste via l'outil Agent aux sous-agents de `.claude/agents/` :

| Tâche                                                                                                               | Sous-agent (modèle)                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Extraction, renommage, transformation mécanique, tâche entièrement spécifiée avec contrôle déterministe             | `miaou-small` (Haiku 5.5)                               |
| Composant ou service limité, correctif multi-fichiers aux contrats établis, tests ciblés, exploration de code       | `miaou-worker` (Sonnet 5.5, défaut)                     |
| Revue du diff avant push, second avis                                                                               | `miaou-reviewer` (Opus 5.5, effort high, lecture seule) |
| Plan, architecture, diagnostic ambigu, permissions, auth, médias privés, migrations, concurrence, décisions produit | Reste dans le chat principal (Opus)                     |

Règles :

- Le niveau d'effort se choisit avec le modèle (champ `effort` de chaque agent, `/effort` pour le chat principal). Par défaut le plus bas qui passe les contrôles : l'effort coûte des tokens de réflexion, donc de l'usage sur un abonnement limité. Monter d'un cran seulement après un échec, jamais par précaution.

- Une question simple ou une retouche triviale se traite directement, sans sous-agent : déléguer a un coût fixe de contexte.
- Chaque mission précise objectif vérifiable, fichiers attribués, règles à lire, contrôle attendu. Un seul sous-agent actif par défaut ; en parallèle seulement pour des fichiers distincts.
- Après deux tentatives infructueuses d'un sous-agent, le chat principal reprend. Ne jamais présenter le rapport d'un sous-agent comme une preuve : relire le diff et relancer le contrôle sur la cible.
- Échelle d'escalade pour une correction précisément énoncée et couverte par un test : essayer `miaou-small` (Haiku, effort low), lancer le test, passer à `miaou-worker` seulement en cas d'échec, puis reprendre en Opus. Ne pas appliquer l'échelle aux revues, permissions, auth, médias privés, migrations ni concurrence.
- Un sous-agent ne délègue pas, ne touche pas à Git et ne publie pas.
- Les modèles se choisissent par alias (`haiku`, `sonnet`, `opus`) ; ils suivent la dernière version disponible. Routage calibré le 26 octobre 2026 sur des fixtures synthétiques ([résultats Claude](docs/benchmarks/model-routing-claude.md), [résultats Codex](docs/benchmarks/model-routing.md)) : Haiku échoue la revue de concurrence, ne pas lui confier de revue.

## Économie d'outils

Choisir l'outil le moins coûteux qui répond à la question :

1. Fichiers et Git : `Read` avec `offset`/`limit`, `Grep` avec `glob` ou `type`, `git diff --stat`, `git log -n`. Ne pas relire un fichier déjà lu ni un fichier qu'on vient d'éditer.
2. GitHub : CLI `gh` (ou l'outil MCP GitHub quand `gh` est refusé), avec `--json` et `--jq` pour ne garder que les champs utiles.
3. Sorties longues (tests, build, logs) : rediriger vers un fichier temporaire et n'afficher que le résumé ou les lignes en échec (`| tail`, `grep -n`).
4. Navigateur : lire le DOM ou le texte (`read_page`, `get_page_text`, `find`, `javascript_tool`, requêtes réseau, console) avant toute capture. Les captures et le contrôle de l'écran (`computer`) sont réservés à ce que le texte ne montre pas : rendu visuel, mise en page, animation. Une capture ciblée et réduite, jamais en boucle de sondage.
5. Playwright et E2E : suivre les traces et rapports texte ; ouvrir une capture seulement sur échec visuel.
6. Montage réseau `/mnt/project-files/` : pas de recherche sur tout le dossier, chemins explicites avec `/` final.
7. Documentation en ligne : une question précise sur la version du lockfile (voir `docs/DEVELOPPEMENT.md#contexte`) ; déléguer la lecture de longues pages à un sous-agent qui ne renvoie que la conclusion.
8. Ne pas charger d'outils MCP non nécessaires à la tâche, et ne pas lancer de recherche large quand un chemin est connu.
