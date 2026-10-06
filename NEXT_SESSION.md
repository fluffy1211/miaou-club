# Miaou Club — reprise

6 octobre 2026. **Lot 1 livré ; lot 2 comptes réalisé sur `feat/lot-2-comptes`, issu de `develop` (`528060b`).** Gabriel autorise sa publication et sa fusion vers `develop` par PR après CI, puis un nouveau chat pour construire le lot 3. Vérifier la PR et le SHA distant avant reprise ; les contrôles locaux ci-dessous datent du 4 octobre, la livraison relance le pre-push et la CI. Aucun déploiement ni compte réel créé. Checkout partagé : maquettes, consignes/skills, configuration documentaire et documents non suivis préservés. Un seul agent.

## Configuration reviews et dépendances — 6 octobre 2026

Tranche isolée du checkout lot 3 : `chore/pr-tooling` depuis le `develop` distant `fac3185`. Alertes Dependabot et correctifs automatiques activés/vérifiés par API. Greptile gratuit choisi par Gabriel ; ruleset Copilot `24590908` créé puis désactivé. Configuration Greptile Base à l’ouverture vers `develop`/`main`, sans auto-approbation/fusion ; consignes préparées, application sur Starter à vérifier. Connexion et accès GitHub Greptile à terminer par Gabriel ; aucune review exécutée. Dependabot regroupé chaque lundi 09:00 Europe/Paris ; configuration seule livrée sur `main` par la PR #4 via `hotfix/dependabot-config`, fusion `a01dd50`, autorisée par Gabriel ; aucune livraison applicative. PR #3 vers `develop`, CI distante en cours. YAML/JSON, paramètres sensibles, format des configurations et diff contrôlés ; résultat CI et fusion de la PR #3 à vérifier avant reprise. GitHub signale une alerte HIGH sur `http-cache-semantics` du lockfile de `main` ; aucun correctif fusionné dans cette tranche. Aucun changement aux fichiers du lot 3.

## Références utiles

- Règles produit : [CADRAGE](docs/CADRAGE.md) ; mécanismes et migrations : [ARCHITECTURE](docs/ARCHITECTURE.md).
- Commandes, exploitation/récupération et limites des lots : [DEVELOPPEMENT](docs/DEVELOPPEMENT.md#lots).
- Contrats et blocages : [FOURNISSEURS](docs/FOURNISSEURS.md) ; analyse du pilote : [JURIDIQUE](docs/JURIDIQUE.md) ; [CGU/notice en préparation](docs/TEXTES_UTILISATEURS.md), non publiables.

## Lot 2 — tranche réalisée

Comptes e-mail et Google natifs Better Auth, adresse préautorisée et preuve serveur 18+/CGU, profil persistant/identifiant immuable, projection sans e-mail, liaison explicite, réinitialisation, révocation, portail suspendu/retrait. Plafonds et fraîcheur des sessions ; TOTP admin par session, secours et récupération manuelle auditée. Compteurs PostgreSQL atomiques, adaptateur Resend préparé, quota application sous MFA et purge locale. Pages React/Astro et stories de connexion. Migrations additives ; DB locale `miaou_dev` migrée, aucune autorisation réelle créée.

Décisions validées dans ce chat : **aucune vérification d’adresse obligatoire avant activation ou publication**, risque d’inscription par un tiers accepté pour le pilote fermé. Récupération manuelle uniquement via canal déjà connu et validation personnelle de Gabriel. Autorité détaillée dans CADRAGE.

Vérifications exécutées : 12 tests catalogue, 15 tests serveur sur PostgreSQL isolé, 10 E2E Chromium/WebKit mobiles ; format/lint, Astro/TypeScript et builds application/backend/Storybook. Inscription sans vérification, acceptation obligatoire, ownership/refus, statut, reset concurrent à usage unique/expiration/révocation, délais, compteurs concurrents, MFA/recours, Google simulé sans fusion, liaison sous preuve fraîche, enrôlement TOTP d’un admin Google sans mot de passe et refus d’une autre session Google sans sa propre preuve MFA. Renouvellement du cookie natif sans remise à zéro du plafond absolu. Captures publiques connexion/inscription inspectées au format mobile. Migration DB locale exécutée. Image runtime `miaou-lot2:local` construite et démarrage testé sur DB isolée : santé, readiness, rendu et refus images. Trivy : aucune alerte HIGH/CRITICAL détectée. Gitleaks sans fuite, actionlint réussi ; `npm audit --audit-level=high` réussi avec six alertes modérées liées à Drizzle Kit/esbuild (chaîne d’outillage retirée du runtime). Aucun audit général de conformité. Aperçu compilé laissé actif sur `http://localhost:43994/profil` (session locale 35377), DB de développement démarrée ; readiness `200`, options réelles `google:false`/`signup:false`. Bases de test éphémères et conteneurs de smoke nettoyés.

Limites : Google réel et délivrabilité Resend non testés ; aucun fournisseur configuré. `MIAOU_TERMS_VERSION` reste absente hors tests tant que les textes ne sont pas finalisés : inscriptions réelles fermées. Avatar photo/upload au lot 3 ; export/suppression/modération au lot 5 (gardes sensibles présentes, réponses `501` pour les opérations non réalisées). Pas de preuve de conformité RGPD/ASVS ni de purge chez les fournisseurs. Topologie proxy/IP fiable à valider avant déploiement.

## Livraison du lot 1 — terminée

[PR 1](https://github.com/fluffy1211/miaou-club/pull/1) fusionnée par squash vers `develop`, SHA `528060b`. CI distante `37214407177` réussie après correction du mode catalogue enregistré dans `ci.yml` ; image, démarrage et Trivy contrôlés. Les rejets automatiques de publication ont été résolus dans le chat autorisé après vérification du dépôt privé et des droits du compte propriétaire. Aucun déploiement ou protection de branche configuré. Preuves historiques : 4 tests serveur, 6 E2E et socle Docker/CI ; les résultats du lot 2 ci-dessus décrivent le code actuel.

## Blocages avant ouverture réelle

- CGU/notice, qualification du pilote, majorité/indices de minorité et filtrage AIPD : JURIDIQUE/TEXTES_UTILISATEURS à finaliser.
- MapTiler et B2 : pièces contractuelles incomplètes ; demandes préparées non envoyées, aucun fournisseur contacté. Supabase Storage Free retenu pour le pilote, intégration photos encore absente.
- Domaine/boîte/expéditeur, Google réel, rétentions et transferts fournisseurs, stockage/purge/sauvegarde/restauration à éprouver. Aucun achat ni contrat accepté.
- Lots rencontres/photos/carte/amis/modération/droits et livraison encore nécessaires ; pilote non prêt pour les données réelles.

## Vérifications des consignes et outils documentaires — autre tranche


Amélioration AGENTS/skills autorisée le 4 octobre : état temporaire retiré des consignes permanentes ; reprise/concurrence, autorisations persistantes, confiance des contenus externes et preuves de revue clarifiées. Deux skills locaux découverts dans ce chat et métadonnées parsées/validées avec `js-yaml` déjà installé ; `quick_validate.py` non exécuté, PyYAML absent. Routage documentaire et commandes reliés aux références existantes. Références/ancres, TOML et espaces contrôlés sur les fichiers de cette tranche, y compris non suivis.

MCP documentaire Astro : configuration locale limitée à `search_astro_docs`, sans secret ; `initialize`, `tools/list` et recherche d'intégration React réussis. Chargement par une nouvelle session Codex à confirmer, aucune configuration globale changée. Better Auth : consultation officielle directe, pas de pack supplémentaire installé.

Playwright installé : génération officielle Codex testée en dossier temporaire, trois TOML valides et seed découvert ; aucun sous-agent lancé ni définition installée dans le projet. Le healer recommande `test.fixme()` : boucle non retenue. Test API synthétique isolé réussi ; mutation 401 → 200 détectée par échec d'assertion. Cela vérifie l'outillage, pas les permissions de l'application. Essai navigateur bloqué par l'absence du binaire Chromium attendu par cette version ; aucun téléchargement global effectué. Aucun rebuild ou test applicatif du lot 1 exécuté par ce chat.

## Prochaine action

Terminer la livraison autorisée du lot 2 vers `develop` après CI, puis construire le lot 3 Polaroid complet dans le nouveau chat demandé par Gabriel. Repartir du `develop` livré, préserver les fichiers locaux non suivis et relire les critères du lot dans DEVELOPPEMENT. Ne pas ouvrir le pilote avant résolution des blocages et parcours manquants. Déploiement, achat et contact fournisseur exigent leur autorisation correspondante.
