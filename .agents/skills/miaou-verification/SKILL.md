---
name: miaou-verification
description: Vérifier les parcours, le rendu mobile ou les permissions API/images de Miaou Club après un changement ; exclut les retouches documentaires.
---

# Vérification Miaou Club

## Choisir la preuve utile

Depuis la racine, charger AGENTS et NEXT_SESSION seulement s'ils ne sont pas déjà disponibles dans cette reprise. Consulter la règle concernée dans `docs/CADRAGE.md`. Rendu/parcours : maquette concernée ; permissions/cache/persistance : section pertinente d'ARCHITECTURE ; stories/E2E : `docs/DEVELOPPEMENT.md#frontend`. Ne pas charger les maquettes pour un contrôle exclusivement serveur.
Déterminer si la cible est prototype simulé, catalogue ou application réelle : un résultat du prototype ne prouve pas le backend. Lister comportements modifiés et risques à couvrir ; ne pas relancer une batterie complète sans changement ou doute justifiant ce coût. Choisir les commandes dans les `package.json` et vérifier leurs configurations/prérequis via `docs/DEVELOPPEMENT.md#ci` ; une commande déclarée n'est pas une preuve d'exécution.

## Parcours et rendu

- Parcours réel demandé : vérifier succès, erreur/refus pertinent, persistance et retour/navigation. Si auth concernée : destination interne reprise après login ; pas d'ouverture automatique de caméra.
- Rendu : mobile 390 px puis largeur complémentaire pertinente ; vérifier débordement, photo, titre/légende, navigation fixe, formulaires/dialogues. Comparer aux maquettes approuvées sans redesign.
- Clavier/focus et dialogues, labels, erreurs lisibles, permissions caméra/localisation refusées. Si PWA touchée : mode installé/non installé et guide, sur appareils pertinents ; émulation desktop ne prouve pas caméra/installation mobile.
- La photo reste fixe après publication ; l'aperçu montre la visibilité et la zone réellement enregistrées. Contrôler les modifications autorisées.

## Confidentialité si touchée

Vérifier propriétaire, autre membre admis, visiteur anonyme et compte non admis/retiré, puis admin/suspendu selon changement. Tester réponse API et image par URL directe, pas seulement disparition de bouton.
Scénarios utiles selon CADRAGE : contenus du pilote refusés sans admission/session ; retrait préserve les droits personnels ; privé jamais partagé ; public → privé ; masquage avec motif propriétaire ; édition ne lève pas masquage ; suspension retire contenu public et limite actions ; réactivation respecte masquages ; suppression bloque image ; zone seulement agrandie/retirée, pas GPS précis.
Inspecter listes, profil, carte et cache lorsqu'ils partagent les données affectées. Sur publication/reprise/purge, vérifier doublons et fichiers orphelins après panne pertinente.

## Compte rendu

Génération assistée Playwright : suivre `docs/DEVELOPPEMENT.md#ia`, employer les fixtures isolées existantes et relire les assertions. Le vérificateur attribué travaille seul, sans redélégation ; ne pas lancer automatiquement planner/generator/healer ni installer leurs définitions. Une réparation doit conserver le comportement attendu, sans désactivation de test ou réessais masquant un défaut.
Rapporter cible/version (branche et état local si non commité), contrôles exécutés, résultats, défauts et limites (notamment tests seulement simulés ou mobiles non vérifiés). Chaque défaut précise scénario, fichier/ligne, conséquence et contrôle de détection. Ne pas qualifier un build réussi de preuve visuelle ou de sécurité. Conserver les preuves utiles avec données synthétiques, sans photos personnelles, tokens ou données sensibles ; contrôler traces/rapports avant partage. Actualiser NEXT_SESSION après un lot réel.
