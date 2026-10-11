---
name: miaou-backend
description: Modifier ou revoir les services Effect, permissions serveur, migrations PostgreSQL ou cohérence des médias de Miaou Club.
---

# Backend Miaou Club

## Contexte ciblé

Trouver la racine contenant `AGENTS.md` ; charger les consignes et `NEXT_SESSION.md` seulement s'ils ne sont pas déjà disponibles dans cette reprise. Lire uniquement les sections pertinentes de `docs/ARCHITECTURE.md`. Pour une règle produit, consulter `docs/CADRAGE.md` ; pour une migration livrée, la CI ou l'exploitation, `docs/DEVELOPPEMENT.md`.
Contrôler code, scripts des `package.json`, lockfile et configurations avant d'annoncer une commande ou une intégration disponible. État daté dans NEXT_SESSION ; décisions dans ARCHITECTURE. Ce skill ne fournit aucune autorisation supplémentaire d'installation ou de déploiement.
Documentation de bibliothèque : suivre la section « Développement avec l'IA » de `docs/DEVELOPPEMENT.md#ia`, en ciblant la version verrouillée ; ne pas charger un manuel ou installer un skill fournisseur par défaut.

## Réaliser une tranche

- Identifier entrée HTTP, service métier, dépendances et effet observable ; suivre les conventions déjà établies plutôt que produire un framework interne.
- Employer Effect pour erreurs/dépendances/ressources ; vérifier la version installée avant les imports. Convertir les Promises aux frontières des adaptateurs, sans perdre connexion transactionnelle, annulation ou erreurs.
- Better Auth est l'autorité de session ; politique applicative distincte pour suspension et accès personnel limité. Vérifier admission/session/statut/rôle/ownership côté serveur avant données et médias.
- La visibilité partagée au groupe admis et les transitions métier sont définies dans CADRAGE ; ne pas recopier leur définition dans chaque route. Utiliser un contrôle commun vérifié sur listes/détail/carte/médias.
- Publication : média prêt appartenant au compte, une photo fixe, idempotence de création ; visibilité et modération indépendantes.
- DB/stockage objet : traiter explicitement les échecs partiels et tâches de purge durables. Une transaction SQL ne couvre pas le stockage objet. Borner les réessais et ne répéter que les opérations idempotentes.
- Contrats publics sans clés de stockage/secrets/données privées. Logs avec codes/ID/durée, pas corps utilisateur ou GPS exact.

## Persistance et validation

Si le lot touche le schéma, utiliser le moteur de migration retenu, relire le SQL et tester base vide + version précédente. Ne pas réécrire une migration appliquée ; pas de synchronisation directe du schéma en préprod/prod.
Tester les refus d'accès et les effets persistants avec PostgreSQL jetable pour contraintes/transactions ; contrôler la cible de connexion avant migration ou test. Doubles stockage/OAuth et données synthétiques pour tests déterministes ; le vrai fournisseur se vérifie séparément. Tests choisis selon les risques modifiés, pas selon le nombre de fonctions. Utiliser les commandes réelles du dépôt et leurs prérequis dans `docs/DEVELOPPEMENT.md#ci`.
Relire le diff final. Un défaut de revue doit préciser scénario, fichier/ligne, conséquence et contrôle de détection ; ne pas affaiblir les tests pour faire passer un résultat. Terminer avec cible/version, commandes réellement exécutées, résultat/limitation et prochaine action. Actualiser la référence affectée et l'état court de reprise sans recopier toute l'architecture.
