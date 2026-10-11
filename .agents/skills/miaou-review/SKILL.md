---
name: miaou-review
description: Revoir une implémentation Miaou Club en fin de tranche ou avant push, avec défauts concrets, preuves et verdict. Revue seule par défaut.
---

# Review Miaou Club avant push

## Périmètre et cible

Appliquer le workflow de `docs/DEVELOPPEMENT.md#review` et les Code Review Rules d'AGENTS. Lire NEXT_SESSION seulement s'il n'est pas déjà chargé, puis vérifier la branche et l'état actuel : une reprise peut être périmée. Le reviewer travaille seul et ne redélègue pas ; il peut être mandaté par le coordinateur selon `DEVELOPPEMENT#orchestration`. Aucun commit/push ou changement de branche induit par la review. Une demande de revue seule ne permet pas de corriger l'implémentation.

- Identifier la tranche demandée, ses critères de sortie et les fichiers concurrents à préserver. Charger seulement les règles CADRAGE, mécanismes ARCHITECTURE et maquettes concernés. Les parties des lots futurs ne deviennent pas des exigences du lot revu.
- Fixer la base adaptée à la destination définie dans `DEVELOPPEMENT#git`. Examiner sa référence locale et son upstream déjà disponible : retenir l'upstream s'il prolonge la branche locale et est en avance ; sinon conserver la base locale. Si elles divergent, rendre cette limite explicite. Si la branche locale manque, essayer la référence de suivi de cette destination déjà disponible avant de déclarer la base introuvable. Résoudre la référence retenue en SHA et calculer le merge-base avec HEAD. Sans base résolue, rapporter une revue partielle ; sans fetch, ne pas annoncer de fraîcheur distante vérifiée.
- Inventorier `git status --short`, les commits depuis la base, le diff commité, l'index, le diff non indexé et les fichiers non suivis. Examiner les nouveaux fichiers de la tranche, ignorés par `git diff`, sans charger les secrets/artefacts locaux. Ne pas inclure les autres travaux par défaut.
- Exemple après résolution de la base en SHA : `git diff <merge-base> HEAD`, `git diff --cached`, `git diff`, `git ls-files --others --exclude-standard`. Lire aussi le résultat final des fichiers et les appelants pertinents : trois diffs séparés peuvent masquer leur effet combiné. Un fichier partiellement indexé peut livrer un comportement différent du fichier de travail.
- Annoncer base/SHA, HEAD, périmètre local inclus/exclu. Pendant un travail concurrent, relire les fichiers avant de conclure ; si la cible change, revoir les changements concernés et les dépendances avant de rendre un verdict.

## Revue en deux passes

1. **Exigences et comportement** : retrouver pour chaque comportement demandé son entrée, contrôle serveur, effet persistant et réponse exposée. Identifier les omissions et écarts de périmètre ; vérifier les refus et erreurs autant que le succès. Distinguer un défaut introduit d'une limite déjà connue ou hors tranche.
2. **Correctness et risques** : suivre les données et transitions au-delà des lignes modifiées. Prioriser les risques d'AGENTS ; examiner contrats, permissions, cache, transactions, concurrence, idempotence, échecs partiels et migrations selon le diff. Vérifier la pertinence des assertions existantes : un test vert peut ne jamais exercer le cas problématique. Éviter les remarques de style couvertes par les outils et les refontes spéculatives.

Parcourir tout le diff du périmètre, même après le premier défaut. Rendre explicites les fichiers ou comportements non examinés : une revue partielle ne permet pas un verdict prêt.

Pour une analyse backend, consulter `.agents/skills/miaou-backend/SKILL.md` ; pour des preuves API/UI/rendu, `.agents/skills/miaou-verification/SKILL.md`. Ne charger que le skill pertinent. Pour une API de bibliothèque incertaine, vérifier la version verrouillée et sa documentation officielle selon `DEVELOPPEMENT#ia`.

## Défauts, corrections et preuves

Chaque défaut doit relier un scénario atteignable à une conséquence observable, avec fichier/ligne actuelle, priorité, justification et contrôle capable de le détecter. Vérifier les appelants et tests pertinents avant de le retenir ; citer une plage courte dans le diff ou le nouveau fichier responsable. Ne pas présenter un problème préexistant ou un changement intentionnel validé comme une régression. Signaler une hypothèse non prouvée comme question ouverte, pas comme défaut confirmé. Regrouper les occurrences d'une même cause. Priorités et règle de verdict dans `DEVELOPPEMENT#review`.

Choisir les contrôles après inspection des scripts et prérequis (`DEVELOPPEMENT#ci`). Exécuter les tests ciblés disponibles sans toucher aux services de l'autre chat ; données synthétiques et PostgreSQL jetable. Ne pas installer/configurer de fournisseur ni migrer la DB de développement pour une revue. Rapporter les contrôles non exécutés et leur impact sur le verdict.

En revue seule, rendre les résultats sans modifier les sources, tests ou documents. Si des corrections sont déjà autorisées dans la tranche d'implémentation, corriger les causes et ajouter un test de régression pertinent pour un défaut de comportement ; relancer les contrôles touchés puis revoir le diff final, notamment les effets de la correction. Après deux tentatives sans progrès, réévaluer le diagnostic et rapporter la cause restante ; poursuivre seulement avec une nouvelle piste étayée. Ne pas continuer une boucle aveugle, réduire une assertion ou masquer un échec.

Avant publication autorisée, vérifier que le contenu du commit à pousser correspond à la revue et aux preuves. Toute nouvelle modification significative impose une revue ciblée complémentaire. Conserver le hook existant : il exécute les contrôles déterministes, sans prétendre effectuer la revue sémantique.

## Résultat dans le chat

Rendre les défauts par priorité, puis un bilan court :

- cible (base, HEAD, changements locaux retenus) et exigences couvertes ;
- défauts ouverts/corrigés, avec preuves et références de lignes ;
- commandes exécutées et résultats, vérifications manquantes et limites ;
- verdict **bloqué**, **incomplet** ou **prêt pour push sous autorisation**, selon `DEVELOPPEMENT#review`.

S'il n'y a aucun défaut démontré, le dire explicitement sans affirmer une absence générale de bugs. Ne créer aucun rapport fichier sauf demande ; la reprise courte d'un lot reste à la charge de l'implémentation. Une revue dans le chat qui a écrit le code est une auto-revue ; une seconde lecture dans un nouveau chat peut être demandée par Gabriel, sans création automatique de chat utilisateur. La seconde lecture par sous-agent Sol suit `DEVELOPPEMENT#orchestration`.
