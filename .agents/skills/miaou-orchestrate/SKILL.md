---
name: miaou-orchestrate
description: Planifier et conduire les tranches autorisées de Miaou Club en choisissant des modèles adaptés aux tâches, avec délégation ciblée, contrôles et revue finale.
---

# Orchestration Miaou Club

Appliquer `docs/DEVELOPPEMENT.md#orchestration` dès qu'une demande porte sur une tranche d'implémentation. Le périmètre reste celui demandé : cette consigne n'autorise pas à réaliser tous les lots, à publier ou à déployer. Une question simple ou une retouche triviale peut être traitée directement.

## Plan et choix du modèle

Le coordinateur utilise GPT-6.1 Sol pour analyser les exigences actuelles et établir un plan court dans le chat : résultat attendu, tâches, fichiers attribués, dépendances, risques et contrôles de réussite. Aucun fichier de plan par défaut. Si le chat utilise un autre modèle, ne pas prétendre le changer : confier la planification et la revue à un sous-agent Sol si disponible, puis appliquer son plan vérifié.

Choisir le modèle selon la catégorie et les résultats consultés dans `docs/benchmarks/model-routing.md`. Les résultats synthétiques sont exploratoires ; vérifier chaque production sur le code réel. Ne pas assimiler ancienneté du modèle, coût API, tokens et consommation d'abonnement. Une absence de résultat ou une erreur d'accès n'est pas un succès.

- Extraction ou tâche mécanique complètement spécifiée et couverte par un contrôle déterministe : essayer GPT-5.6 Luna seulement pour une catégorie dont tous les essais consignés réussissent ; sinon GPT-6 Luna. Ne pas extrapoler la réussite d'une extraction à la génération de code, ni la réussite d'une pagination à tout le frontend.
- Composant ou service limité, tests ciblés, correctif à plusieurs fichiers dont les contrats sont établis : GPT-6 Luna ; Sol lorsque les résultats ou la difficulté ne justifient pas Luna.
- Décision produit/architecture, diagnostic ambigu, permissions, auth, médias privés, concurrence, migration ou perte de données : Sol. Ne pas router ces implémentations vers un petit modèle sur la seule réussite d'une fixture.
- Revue finale : Sol, avec `miaou-review`, lecture de la cible réelle et contrôles requis. Ses conclusions ne remplacent pas les preuves exécutées.

## Délégation bornée

Utiliser les outils de sous-agents de la session (`collaboration` ou leur équivalent Codex), sans créer de chat utilisateur. Définir explicitement `model` et l'effort adapté ; transmettre un contexte ciblé (`fork_turns: "none"` ou quelques tours lorsque l'outil le permet). Ne pas transmettre tout l'historique par défaut. Les agents TOML de `.codex/agents/` offrent les mêmes rôles aux clients qui les découvrent.

Chaque mission contient : objectif et critères vérifiables, fichiers possédés, dépendances/symboles utiles, règles pertinentes à lire, contrôles attendus et limites d'autorisation. Le sous-agent lit AGENTS et les références utiles, respecte les changements concurrents et ne délègue pas à son tour. Il rapporte fichiers modifiés, commandes/résultats et incertitudes.

Un seul sous-agent actif par défaut. Paralléliser seulement des tâches réellement indépendantes avec fichiers distincts, dans la limite de la session. Le coordinateur ne modifie pas les fichiers attribués pendant leur édition. Ne pas créer de branche/worktree sans l'autorisation Git correspondante ; si l'isolation est nécessaire et manque, avancer en lecture seule et signaler le besoin.

Après un échec, donner au worker le diagnostic et un correctif ciblé. Après deux tentatives infructueuses ou une nouvelle incertitude de sécurité/contrat, arrêter le worker et reprendre avec Sol. Une indisponibilité du modèle impose de signaler le repli réellement utilisé ; ne jamais lancer de boucles de réessais aveugles.

## Vérification et fin de tranche

Le coordinateur lit les modifications et leurs appelants, vérifie que les contrôles du worker ont réellement été exécutés sur la cible, et complète les contrôles pertinents selon les scripts existants. Appliquer `miaou-verification` lorsque la tâche touche les parcours ou permissions ; respecter l'exécution Playwright hors sandbox.

Faire la revue Sol sur le diff complet de la tranche ; fournir base, changements locaux inclus/exclus et critères, sans présenter les conclusions du worker comme des preuves. Corriger les défauts confirmés, vérifier puis revoir les parties affectées. La livraison suit exclusivement `DEVELOPPEMENT#git` et `#review`, sous les autorisations déjà données.

Actualiser NEXT_SESSION avec preuves et limites de la tranche, sans prétendre qu'un benchmark synthétique garantit la qualité, un gain de tokens ou l'activation du workflow dans un autre chat. Ne relancer les benchmarks que sur demande ou lorsqu'un changement de routage doit être évalué dans une tâche autorisée ; aucun benchmark payant automatique à chaque demande.
