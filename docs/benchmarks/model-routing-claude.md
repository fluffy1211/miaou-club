# Modèles Claude pour Miaou Club — premiers essais

26 octobre 2026. Calibrage exploratoire du routage de [CLAUDE.md](../../CLAUDE.md), même méthode que [model-routing.md](model-routing.md) (fixtures synthétiques, oracles déterministes, aucune donnée réelle).

## Exécution

54 appels : 3 modèles (alias `haiku`, `sonnet`, `opus`, soit Haiku 5.5, Sonnet 5.5, Opus 5.5) × 6 tâches × 3 essais, effort `low`, Claude Code 2.1.310 en `-p`, sans outils, sans réglages ni skills, répertoire temporaire vide. Deux tâches ajoutées : revue d'un `publish` non idempotent (`publish-race-review`) et normalisation de slug (`slug-normalisation`). Commande : `node scripts/model-benchmark.mjs --models haiku,sonnet,opus --runs 3 --output PATH`. Les modèles `haiku|sonnet|opus|claude-*` passent par `claude -p`, les autres par `codex exec`.

| Tâche | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
| --- | --- | --- | --- |
| Filtre, premier doublon et tri JSON | 3/3 | 3/3 | 3/3 |
| Pagination : bornes et valeurs invalides | 2/3 | 0/3 (format) | 3/3 |
| Revue de deux contournements de suspension | 3/3 | 3/3 | 3/3 |
| Revue de `publish` : course, atomicité, portée du propriétaire | 0/3 | 3/3 | 3/3 |
| Slug : diacritiques, troncature, repli | 2/3 | 3/3 | 3/3 |
| Extraction exacte de statuts | 3/3 | 3/3 | 3/3 |
| Total | 13/18 | 15/18 | 18/18 |

Coût API cumulé reçu du CLI (hors abonnement) : Haiku environ 0,011 $, Sonnet environ 0,145 $, Opus environ 0,200 $. Durée médiane de 3 à 5 s par appel pour tous.

## Lecture

- Le 0/3 de Sonnet en pagination est un défaut de format : il rend `const paginate = function…` au lieu d'une expression de fonction, alors que la logique est correcte. Même défaut que celui noté pour GPT-5.6 Luna. Sur du vrai code, c'est sans effet ; sur une sortie à format strict, le préciser ou vérifier.
- Haiku rate la revue de concurrence (course entre vérification et insertion, absence de transaction) trois fois sur trois : ne pas lui confier de revue ni de code touchant à l'idempotence, aux permissions ou aux migrations. Il réussit l'extraction et la transformation simple.
- Sonnet réussit toutes les tâches de raisonnement, y compris la revue de `publish`.
- Sur ces tâches courtes en effort `low`, Opus ne gagne rien sur Sonnet à part le format ; son surcoût est d'environ 40 % de plus en API. Ces fixtures ne mesurent pas les tâches longues ni ambiguës, où il reste réservé.

## Routage retenu

Inchangé dans [CLAUDE.md](../../CLAUDE.md), avec cette précision : Haiku seulement pour extraction et transformation entièrement spécifiées avec contrôle déterministe ; Sonnet pour l'implémentation et les revues ciblées ; Opus pour la planification, les décisions ambiguës et la revue finale du diff. Échantillon de 3 essais par cellule : une différence d'un essai n'est pas significative. L'effort `low` est mesuré ; medium et high ne le sont pas. La consommation d'un abonnement n'est pas le coût API.
