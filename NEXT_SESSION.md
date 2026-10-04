# Miaou Club — reprise

4 octobre 2026. **Lot 1 : socle local réalisé et vérifié dans le chat `01a1073d-d232-7092-a03b-dba0efbe8b15`, sur `feat/lot-1-socle` depuis `develop`.** Livraison Git autorisée le 4 octobre par Gabriel via le chat de recette du lot 2 : commit du socle, publication de `develop` et de la branche, PR puis squash vers `develop` après contrôles réussis. Livraison en cours ; aucun déploiement autorisé. Checkout partagé : documents/skills/configuration documentaire de l’autre chat et maquettes non suivies préservés. Versions/montage : ARCHITECTURE ; commandes et limites CI/CD : DEVELOPPEMENT#ci.

Périmètre du lot 1 autorisé le 4 octobre : compatibilité et socle backend/qualité/sécurité/livraison, Docker local, pre-push, CI et préparation CD dans les fichiers du dépôt, intégration frontend minimale. Critères dans DEVELOPPEMENT#lots. Lots fonctionnels suivants et déplacement de `src/` hors de cette livraison. Publication des workflows et exécution CI autorisées pour la PR ; protections/environnements et déploiement restent hors périmètre. L’autre tranche a modifié les consignes et l’outillage documentaire ; ses vérifications restent distinguées ci-dessous.

## Lire seulement selon la tâche

| Besoin | Référence |
| --- | --- |
| Règles produit validées | [CADRAGE](docs/CADRAGE.md) |
| Socle, modèle/API proposés, photos et export | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Environnements, sécurité, sauvegardes, lots | [DEVELOPPEMENT](docs/DEVELOPPEMENT.md) |
| Contrats, offres, sources et demandes fournisseurs | [FOURNISSEURS](docs/FOURNISSEURS.md) |
| Cartographie et analyse juridique | [JURIDIQUE](docs/JURIDIQUE.md) |
| Notice et CGU de travail | [TEXTES_UTILISATEURS](docs/TEXTES_UTILISATEURS.md), non publiables |

Cible actuelle : pilote fermé entre amis majeurs connus, admis personnellement par Gabriel ; contenus réservés aux membres admis, connectés et autorisés. « Public » = groupe. Déclaration obligatoire 18+/CGU pour Google et e-mail ; déclaration ≠ preuve d’âge, GPS séparé. Règles détaillées uniquement dans CADRAGE ; admission par adresse vérifiée proposée dans ARCHITECTURE.

## Blocages à conserver

- MapTiler Free : DPA/rôles API-CDN/pays/garanties/rétentions incomplets. B2 : contradiction DPA 2022/liste 2025 et politique 2026 pour l’exploitant individuel. [Deux demandes rédigées](docs/FOURNISSEURS.md#demandes), **non envoyées** ; autorisation et canal requis pour contacter les fournisseurs, sans reprendre indéfiniment la recherche publique.
- Qualification du pilote fermé, suffisance 18+/indices de minorité, filtrage AIPD et textes à terminer : JURIDIQUE. DPF Resend/Render annoncé mais fiche active/périmètre non vérifiés ; SCC ≠ analyse terminée.
- Montage gratuit, HEIC, quotas/purge et sauvegarde/restauration non éprouvés. Domaine/boîte non achetés/créés. Aucun contrat accepté ni conformité acquise.

## Vérifications du lot 1

- `npm run verify:full` puis exécution directe de `.githooks/pre-push` réussis : format/lint, 12 tests catalogue, diagnostics Astro/TypeScript sans erreur/avertissement, builds application/backend et Storybook, 4 tests serveur PostgreSQL, 6 E2E Chromium/WebKit mobiles. Hook activé localement (`core.hooksPath=.githooks`), testé sans push.
- Schéma auth généré par Better Auth 1.7.7 ; SQL Drizzle relu. Bases vides, auth avec fixture → ajout politique, réapplication, FK/unicité/domaines/cascade testés en bases distinctes. Migration de la DB locale de développement exécutée.
- Sessions/cookies Better Auth réels ; refus anonyme, non admis, adresse non vérifiée, suspension/retrait/suppression, révocation et origine non autorisée. Double Google déterministe : session native, jeton invalide refusé, collision avec compte credentials sans liaison automatique. **Pas d’échange réel Google vérifié.** Inscriptions désactivées dans l’application ; aucun compte du pilote créé.
- Pages du catalogue réservées par middleware. Build Node : images directes, chemin encodé et `/_image` refusés sans autorisation, `no-store` vérifié ; fixture image synthétique seulement. `AccessNotice` partagé Astro/Storybook rendu ; aucun audit visuel général des maquettes ni test caméra/PWA réel.
- Docker : DB locale persistante et DB test séparée en tmpfs ; application de développement testée sur 43993 (4321 déjà utilisé par un autre serveur). `docker build --target runtime -t miaou-lot1:local .` et `npm run test:image` réussis : Node 24.21.0, utilisateur `node`, santé/readiness PostgreSQL, rendu et refus. Tests et conteneurs éphémères nettoyés ; DB de test arrêtée (tmpfs effacé), application Docker sur 43993 et DB de développement laissées actives, volume conservé. `.env` local complété avec un secret privé généré, sans affichage ni suivi Git.
- Gitleaks sans fuite détectée dans le périmètre des sources et actionlint/ShellCheck réussis. Trivy 0.75.0 sur l’image : aucune alerte HIGH/CRITICAL détectée, sans exclusion de CVE. `npm audit --audit-level=high` réussit mais signale **4 alertes modérées** dans les outils Drizzle Kit/esbuild ; outils exclus du runtime, suivi requis.
- CI et contrôle préalable de promotion préparés dans `.github/workflows`, actions verrouillées ; aucune exécution GitHub, protection de branche, préprod automatique ou livraison réelle validée. Une candidate est construite, testée et scannée ; la promotion préparée vérifie son SHA/checksum, sans déployer.

Commandes, prérequis, mode catalogue enregistré et restrictions d’usage de `astro dev`/preview : [DEVELOPPEMENT#ci](docs/DEVELOPPEMENT.md#ci). Démarrer le build avec `npm run start`, pas directement l’entrée Astro qui contourne la garde statique. Sécurité fonctionnelle, admission/18+/CGU, plafond absolu des sessions, MFA, photos/ownership, modération et droits restent aux lots suivants ; pilote **non prêt pour des données réelles**.

## Vérifications des consignes et outils documentaires — autre tranche


Amélioration AGENTS/skills autorisée le 4 octobre : état temporaire retiré des consignes permanentes ; reprise/concurrence, autorisations persistantes, confiance des contenus externes et preuves de revue clarifiées. Deux skills locaux découverts dans ce chat et métadonnées parsées/validées avec `js-yaml` déjà installé ; `quick_validate.py` non exécuté, PyYAML absent. Routage documentaire et commandes reliés aux références existantes. Références/ancres, TOML et espaces contrôlés sur les fichiers de cette tranche, y compris non suivis.

MCP documentaire Astro : configuration locale limitée à `search_astro_docs`, sans secret ; `initialize`, `tools/list` et recherche d'intégration React réussis. Chargement par une nouvelle session Codex à confirmer, aucune configuration globale changée. Better Auth : consultation officielle directe, pas de pack supplémentaire installé.

Playwright installé : génération officielle Codex testée en dossier temporaire, trois TOML valides et seed découvert ; aucun sous-agent lancé ni définition installée dans le projet. Le healer recommande `test.fixme()` : boucle non retenue. Test API synthétique isolé réussi ; mutation 401 → 200 détectée par échec d'assertion. Cela vérifie l'outillage, pas les permissions de l'application. Essai navigateur bloqué par l'absence du binaire Chromium attendu par cette version ; aucun téléchargement global effectué. Aucun rebuild ou test applicatif du lot 1 exécuté par ce chat.

<a id="historique"></a>
## Choix remplacés

Catalogue uniquement (`IMPLEMENTATION.md`) → V1 rencontres ; Google seul → Google + e-mail ; inscriptions ouvertes/mineurs → pilote fermé 18+ ([archive parentale hors cible](docs/archives/MINEURS.md)) ; R2 pilote → Supabase Storage Free, R2 option ultérieure ; e-mails de confirmation sécurité → états dans l’application, exception avertissement d’inactivité conservée ; push reporté après V1. Les références actuelles priment.

## Prochaine action

Sur demande du prochain lot : comptes/admission/18+/CGU, Google réel et e-mail, permissions/portail restreint, sessions/MFA, selon CADRAGE et [lot 2](docs/DEVELOPPEMENT.md#lots). Ne pas ouvrir le pilote avant les lots fonctionnels, modération, livraison et résolution des blocages ci-dessus. Finaliser la livraison Git du lot 1 avant toute modification par le chat du lot 2 ; ne pas créer sa branche ici. Déploiement, achat et contact fournisseur attendent leur autorisation correspondante. À la reprise, vérifier l’état partagé et les scripts réels ; garder les preuves du socle distinctes des essais documentaires de l’autre chat.

## Livraison Git du lot 1 — 4 octobre 2026

Revue finale : migrations additives, refus serveur et garde des images, configuration CI et absence de secrets examinés. Périmètre du commit : socle applicatif, outillage/tests et références ARCHITECTURE/DEVELOPPEMENT/NEXT_SESSION. Maquettes, AGENTS, skills, configuration `.codex` et autres documents non suivis préservés hors commit. GitHub Actions déjà actif ; aucun ruleset configuré, dépôt administrable par le compte connecté. PR et contrôles distants à vérifier avant fusion.

Blocage de publication : la revue automatique a rejeté deux fois le commit/push, y compris après lecture du « Oui » de Gabriel dans le chat de recette `01a10752-6805-7ed1-b767-15729cb42796`. Elle exige une autorisation utilisateur directement dans ce chat et refuse cette preuve inter-chat. Aucun commit/push/PR/fusion exécuté. Les 67 fichiers du lot 1 sont indexés ; branche `feat/lot-1-socle`, HEAD `1d5f5e1`, distant uniquement `main`. Demander ici l’autorisation de commit/push/PR/squash vers `develop`, puis exécuter le hook et les contrôles distants avant fusion. Le chat du lot 2 doit attendre.
