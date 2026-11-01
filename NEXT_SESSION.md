# Miaou Club — reprise

## Passe de design systématique — 1er novembre 2026

Branche `fix/design-review-polish` (worktree `cats-design-review`), non poussée. Grille de huit règles consignée dans [DEVELOPPEMENT#grille-design](docs/DEVELOPPEMENT.md#grille-design) et appliquée à toutes les pages (390 et 1280 px) : espacements mobiles fixés sur la grille de 8 px, liens de connexion groupés, `/acces` sur le gabarit de connexion avec logo, colonnes étroites alignées sur le logo, une seule action principale (sécurité du profil en secondaire), cibles de 44 px (logo, contrôles et repères de carte), `--muted` assombri (≥ 4,5:1 sur tous les fonds), textes de `/donnees` raccourcis. Contrôles : Prettier, ESLint, `astro check`, E2E Chromium mobile locaux 21/21. Reste : revue, push et PR sur accord de Gabriel.

## Catalogue des races retiré — 26 octobre 2026

Sur décision de Gabriel, le site se recentre sur les photos de chats : `/races`, `/race/*`, `/favoris`, `/a-propos`, l’ancien gabarit `Layout.astro`, la collection `breeds` (TheCatAPI, Wikimedia), `CAT_API_KEY`, `MIAOU_OFFLINE_CATALOG`, `build:offline` et `data:refresh` sont supprimés. `/figue` et la page 404 passent sur le gabarit du club. Suite (PR Figue) : recherche « figue » sur `/amis` et petit chat de la 404 mènent à `/figue`, animée avec `motion` et `canvas-confetti` (respect de `prefers-reduced-motion`), E2E `e2e/figue.test.ts`.

## Suite Claude Code — 25 octobre 2026 (soir)

Fusionnées : Effect 4 (#34, remplace #29), TypeScript 7 ignoré par Dependabot (#35, #30 fermée : typescript-eslint < 6.1 et `@astrojs/check` ^5 || ^6 ne supportent pas encore TS 7), Node 26.12.0 dans Docker et `.node-version` (#36, remplace #26). #31 (vite sur `main`) fermée sur décision de Gabriel. Charte courte pour les amis sur `/conditions` (#37). Domaine souhaité : `miaou-club.fr`, `miaou.club` ou `miaouclub.fr`, disponibilité non vérifiée. Astro reste en 7.3.5 / `@astrojs/node` 11.1.6 : le correctif `security.allowedDomains` attend le domaine choisi (liste explicite des hôtes, pas de joker). Blocages lot 6 inchangés : domaine, compte B2, qualification proxy Render, protections GitHub.

## Reprise sous Claude Code — 25 octobre 2026

Gabriel passe de Codex à Claude Code. Cadre juridique allégé pour un site réservé à quelques amis ([CADRAGE#cercle-prive](docs/CADRAGE.md#cercle-prive)) : AIPD, DSA, CGU/notice juridiques, contrats MapTiler/B2 et suivi formel des demandes retirés ; une courte charte reste à rédiger. Dépendances : PR #32 remplace les PR Dependabot #27/#28 sans `oxc-transform-react`, `@vitejs/plugin-react`, `astro` et `@astrojs/node` (conflit de peers ; contrôle d'origine d'Astro ≥ 7.3.8 en 403 derrière `server/start.mjs`, à corriger via `security.allowedDomains`). Restent : Node 26 (#26), Effect 4 (#29), TypeScript 7 (#30), #31 vise `main`. Blocages lot 6 inchangés : compte B2, qualification proxy Render, protections GitHub.


## Sauvegardes distantes — préparation à livrer, 16 octobre 2026

Gabriel autorise la poursuite après le patch local revu. Livraison bornée à la préparation technique, sans activation externe. Branche `feat/remote-backup-preparation` depuis `origin/develop` `0bea46df13eff0aa9f46d0a7c2f9d3f60b3d55b4`, dont le contenu est identique à la base initialement testée `dab0f0a`. Worktree dédié ; checkout partagé et autres services préservés.

Capture snapshot PostgreSQL 17 et WebP, dépôt restic chiffré, journal indépendant, restauration locale en quarantaine, lanceur avec pause/reprise Render et exemples privés préparés. Le workflow de sauvegarde reste un exemple **inactif** dans `ops/` ; seule la CI synthétique dédiée est ajoutée. Documentation d’usage et limites : [ops/backup-remote.md](ops/backup-remote.md).

Preuves avant intégration : 40/40 tests synthétiques (vrais pg_dump/pg_restore/restic, perte de source et restrictions ; Render simulé), TypeScript, ESLint, formatage, actionlint/ShellCheck, Gitleaks et revue indépendante Sol favorables. Contrôles sur la branche de livraison, SHA publié, CI/Greptile et état de fusion à consigner après exécution. La suite locale spécialisée exige son conteneur jetable et son binaire restic explicites ; elle ne rejoint pas implicitement `test:server`.

Aucun compte B2, secret GitHub, sauvegarde réelle Neon/Supabase/B2, pause Render, planning distant ni alerte activé. Gabriel n’a pas encore de compte B2 et demande une exécution indépendante du Mac. Cadre fournisseur, accès restreints et qualification externe restent nécessaires avant exploitation. Journaux anciens non rafraîchis, décisions après coupe inconnues, surveillance inter-exécutions, mort du runner et drainage Storage non qualifiés ; aucun RPO/RTO ni effacement physique des versions B2 démontré. La restauration exposée par le module reste locale et fermée, sans réouverture de l’application. Le report de la qualification proxy et les CIDR vides restent inchangés.

## État actuel — sonde proxy temporaire, 14 octobre 2026

Gabriel autorise « oui » après proposition de livraison Git puis déploiement temporaire sur la seule préproduction fermée après contrôles, sans activation CIDR. Worktree isolé depuis develop distant relu `ccedfefd712d4592d735e66ff819598e1e8e07b3`, branche `chore/proxy-chain-qualification`. Checkout partagé historique et changements/services concurrents préservés.

Sonde désactivée par défaut : paire SHA256 du bearer synthétique hex ASCII + échéance absolue millisecondes Unix ≤15 minutes, validée explicitement ; configuration invalide/expirée sans impact readiness. Seul GET readiness exact sans credentials, budget 16 par processus, HMAC des adresses et ordre XFF dans les logs privés ; aucun changement de resolver/auth/DB. CIDR fiables restent vides. Préparation précédente sous `/tmp/miaou-proxy-qualification-ccedfefd`. Sur cette cible isolée : revue Sol sémantique favorable, `verify:full` hors sandbox réussi (46 tests outillage, 84 serveur, 40 E2E sans réessai, contrôles statiques/builds/audits), image complète locale construite, trois branches smoke runtime/proxy/diagnostic réussies et Trivy HIGH/CRITICAL réussi. Base synthétique isolée 54346 ; preuves `/tmp/miaou-probe-delivery`. Hook et preuves Git/CI/candidate/déploiement encore à établir, aucune protection IP distante supplémentaire annoncée.

Suite autorisée : revue Sol, contrôles complets/hook, PR/CI/Greptile et fusion, post-fusion/candidate exacte, publication privée GHCR puis déploiement temporaire et observations bornées. Retrait des paramètres de sonde à la fin. Support non contacté, aucun achat/changement d'offre/activation CIDR/ouverture du pilote induit.

## Livraison précédente — correctif IP, 14 octobre 2026

PR #23 fusionnée en squash `ccedfefd` vers develop ; CI post-fusion `38579187347` réussie et candidate produite, preuves datées dans la reprise du checkout partagé. Render demeure sur la candidate `236d221` et le digest `8057d54…` lors du début de cette tranche. La nouvelle source rend explicites les CIDR fiables et ignore les en-têtes forgés ; liste vide conserve le socket. Chaîne/plages Render non qualifiées, aucune protection IP distante supplémentaire établie.

## Préparation locale de préproduction — 12 octobre 2026

Gabriel autorise cette tranche locale dans une branche isolée, sans activation fournisseur ni déploiement. Worktree `/Users/gabriel/.codex/worktrees/preproduction-local/cats`, branche `chore/preproduction-local`, base/HEAD `62800434380b141d6097bcfca2162270f33761c1` (develop distant vérifié au démarrage ; état fixé, pas promesse de fraîcheur ultérieure). Checkout partagé, configuration Greptile et autres worktrees préservés.

Modèles `deploy/render-preproduction.yaml.example` et `deploy/preproduction.env.example` volontairement incomplets ; CLI `npm run preproduction:check -- --preproduction-env-file <fichier-privé>` : validation hors ligne, environnement ambiant ignoré, sorties codes seulement, TLS/HTTPS, stockage distinct à renseigner, inscription/fournisseurs fermés, refus variables supplémentaires. Procédure unique : [DEVELOPPEMENT — préparation préprod](docs/DEVELOPPEMENT.md#préproduction--préparation-locale-du-lot-6-12-octobre-2026). Render Free : migration externe avant activation depuis la même image, migrateur compilé/verrou existants ; contrôle zéro comptes admis et zéro invitations actives sur DB dédiée neuve. Aucun runtime ou migration modifié.

Preuves exécutées dans ce worktree : `npm ci` verrouillé ; `npm test` **26/26** et self-test existant du benchmark ; six tests du nouveau validateur dont refus TLS/activation/variables inconnues et absence de valeurs dans les sorties ; ESLint ciblé, Prettier ciblé et YAML, `git diff --check` réussis. Modèle de variables incomplet refusé comme attendu (exit 1). YAML parsé localement et invariants image/Free/Francfort/readiness/secrets vérifiés ; aucune validation API Render. Gitleaks final réussi, également exécuté indépendamment par le reviewer sans réseau. `candidate:verify` réussi sur archive CI existante `6280043` : SHA, checksum et ID Docker concordants. Métadonnées authentifiées obtenues dans la reprise précédente ; aucun nouveau téléchargement ou preuve de CI pour cette nouvelle tranche. Aucun rebuild, smoke, test serveur ou E2E relancé : runtime inchangé, anciennes preuves datées séparément.

Revue finale indépendante Sol terminée sur les huit fichiers et les contrôles exécutés : aucun défaut bloquant démontré, verdict prêt pour push sous autorisation ; Gabriel autorise le 12 octobre la livraison vers develop (« livre sur develop ») : commit, hook complet hors sandbox, push, PR, suivi CI/Greptile et fusion. Publication en cours ; vérifier ensuite la CI du squash. Aucun fournisseur ni déploiement autorisé. Registre privé, digest publié, environnements, DB/bucket/secrets réels, HTTPS/proxy, migrations distantes, OAuth/e-mails, mobiles/PWA et sauvegardes distantes restent à configurer et éprouver sous leurs autorisations. La configuration statique ne prouve ni isolation/région réelle, ni bucket privé, ni fermeture des admissions existantes.

## Préparation locale du lot 6 — 12 octobre 2026

Gabriel autorise cette tranche et sa livraison vers `develop` le 12 octobre (« push ») : commit, hook complet, PR, suivi CI/Greptile puis fusion selon DEVELOPPEMENT#review. Aucun déploiement ni fournisseur activé. Checkout isolé `/Users/gabriel/.codex/worktrees/lot-6-local-preparation/cats`, branche `chore/lot-6-local-preparation`, base `develop` `bcd22495f5ad2f25c2d789daf7880b4131f5599c`. Le checkout partagé et ses changements concurrents sont préservés.

Périmètre : contrôle préalable de promotion. Le CLI `--run-only` vérifie la source CI, son état terminé/réussi, sa branche/cible et le SHA attendu avant le téléchargement. La vérification complète de l’archive reste obligatoire ensuite ; `run_verified` ne signifie pas `candidate_verified`. Le défaut corrigé était un téléchargement inutile avant rejet d’un SHA différent, sans contournement de la validation finale démontré.

Inspection GitHub en lecture seule le 12 octobre : `develop` et `main` renvoient `Branch not protected` ; seul ruleset observé, « Miaou Club — Copilot PR review », désactivé ; seul environnement déclaré, `copilot`, sans règle de protection. Aucune protection de livraison active démontrée. Run de base `38236047728`, tentative 3 : terminé/réussi sur le SHA de base ; ses métadonnées réelles sont acceptées par `--run-only`, sans télécharger l’archive ni charger l’image.

Vérifications finales : `npm test` réussi (20 tests et self-test du benchmark, sans appel de modèle), trois tests de promotion réussis aussi sous Node 24.21.0 dans un conteneur temporaire avec sources en lecture seule ; Prettier des cinq fichiers, ESLint du script/test, actionlint/ShellCheck et `git diff --check` réussis. Le test shell échoue sur une copie temporaire de l’ancien workflow : un SHA différent atteint le faux téléchargement (exit 73) au lieu du refus attendu (exit 1). Il réussit sur le workflow corrigé. Revue indépendante Sol des cinq fichiers et de l’appelant de chargement terminée : aucun défaut bloquant démontré, verdict **prêt pour push sous autorisation** pour cette tranche locale. Le reviewer a aussi exécuté les trois tests sous Node 26.8.1 et 24.21.0, ainsi que format/lint/actionlint/diff check. Aucun build, test serveur, E2E, chargement d’image candidate ni contrôle distant du diff local exécuté : application et schéma inchangés. Le lot 6 global reste incomplet : protections GitHub, environnements préprod/prod, infrastructure, migrations distantes verrouillées, Google/e-mails réels, restauration distante, vrais mobiles/PWA et conditions d’ouverture. Prochaine action : publier cette correction après le hook complet hors sandbox, puis obtenir CI et Greptile sur le dernier SHA avant fusion ; aucune activation externe induite.

### Transmission du diagnostic E2E — 12 octobre 2026

Commit local `33723d33f2f95f550f3cc44c961ea65a280b78dc`, branche `chore/lot-6-local-preparation`, non publiée et aucune PR. Premier hook : format/lint/types/builds, 20 tests outillage et 84 serveur réussis ; 39/40 E2E, échec WebKit `restored photo protects its location when the selected-zone download is failed`, `e2e/discovery.test.ts:547`, `requested` reste false après 5 s. Le formulaire montre le brouillon restauré ; l’abandon réseau n’a pas été injecté. Test et application inchangés par cette tranche. Cause non confirmée ; trois répétitions ciblées inchangées réussies (17,6 s).

Seconde exécution du hook interrompue proprement pour transférer le diagnostic au nouveau chat demandé par Gabriel : 24 E2E réussis, un interrompu, quinze non exécutés ; ce résultat n’est pas une validation. Aucun délai, assertion ni réessai modifié. Tous les serveurs de test de cette exécution doivent être revérifiés arrêtés avant une nouvelle batterie. PostgreSQL dédié `miaou-lot6-preflight-db-test-1` au port loopback 54338 reste disponible ; override temporaire `/tmp/miaou-lot6-compose.yaml`. Services `miaou-local-*` concurrents à préserver. Ne pas relancer la livraison dans ce chat en parallèle du diagnostic transféré.

### Diagnostic géographique — correction locale du 12 octobre 2026

Gabriel autorise le diagnostic et les corrections locales dans ce checkout existant, puis la publication du périmètre étendu le 12 octobre (« push ») : commit, hook complet, PR vers develop, CI/Greptile et fusion selon DEVELOPPEMENT#review. HEAD `33723d33` et préflight committé préservés ; seuls `e2e/discovery.test.ts` et cette reprise sont modifiés, sans commit/push/PR. La transmission précédente ci-dessus est conservée.

Cause reproduite deux fois dans la seconde séquence discovery WebKit, sur failed puis delayed : événement `request` pour `location.CRDOXONl.js` au retour, sans invocation de la route. La réponse réutilise le même `x-request-id` que le GPS initial malgré `Cache-Control: no-store`, avec `transferSize: 0` et réponse quasi immédiate. Le cache mémoire réutilise donc la ressource et l'injection réseau n'est pas exercée ; la sélection est consommée, le brouillon restauré. Instrumentation synthétique retirée après diagnostic.

Correction de fixture uniquement : réécriture contrôlée de l'unique import dynamique géographique du vrai module PhotoFlow, avec une query UUID propre à chaque test. GPS/carte restent sur l'URL originale ; l'import de reprise est froid et sa requête doit commencer après armement. Gate/abort portent seulement sur cette URL ; le cas delayed charge le vrai module. Assertions de protection du lieu/brouillon, délais, absence de retries et sources applicatives inchangés.

Preuves hors sandbox avec DB dédiée loopback 54338 : quatre cas delayed/failed Chromium/WebKit × cinq, **20/20** (1,4 min) ; batterie complète **40/40** (2,6 min) ; discovery WebKit seul × deux, **14/14** (41,7 s), tous sans réessai. Commandes : `npm run test:e2e -- e2e/discovery.test.ts --grep 'restored photo protects' --repeat-each=5 --max-failures=1`, `npm run test:e2e`, puis `npm run test:e2e -- e2e/discovery.test.ts --project=webkit-mobile --repeat-each=2 --max-failures=1`, avec le TEST_DATABASE_URL dédié. Deux essais de répétition multi-projets ont atteint la limite horaire du compte synthétique reader partagé (10 envois, `service.ts`) et ne sont pas des succès de batterie ; deux séquences Chromium complètes avaient réussi avant le refus. Pour répéter discovery, utiliser une base neuve par navigateur et au plus deux séquences avec les fixtures actuelles ; aucun quota/assertion modifié. Format, ESLint ciblé et diff check réussis ; aucun rebuild/test serveur requis pour ce changement E2E seul.

Revue indépendante Sol : diff et appelants relus, transformation vérifiée sur le bundle construit (exactement un import, seul le specifier change), aucun défaut bloquant démontré. Sorties E2E brutes et reprise finale vérifiées personnellement par le reviewer ; verdict **prêt pour push sous autorisation**, publication du correctif étendu désormais autorisée. Prochaine action : commit du correctif, hook normal, PR, CI et Greptile sur le dernier SHA avant fusion. Preuves locales macOS uniquement ; elles ne garantissent pas l'absence de tout flake sur toutes les plateformes.

## Historique des tranches précédentes

Les notes ci-dessous sont conservées telles qu’elles étaient consignées ; elles ne décrivent pas le checkout actuel. Les livraisons PR #14, #15 et #17 sont présentes dans la base `bcd2249` ; leurs mentions anciennes de travaux en cours restent historiques.

11 octobre 2026. Publication autorisée par Gabriel ; checkout isolé `model-orchestration/cats`, branche `chore/model-orchestration`, base develop `29556d7`. Vérifier branche et status à chaque reprise. Cette tranche ne modifie pas les sources applicatives ni la CI.

### Workflow de modèles et benchmark — publication autorisée, 11 octobre

Gabriel autorise l'orchestration des prochaines tranches demandées et la comparaison de modèles, y compris plus petits. Routage dans [DEVELOPPEMENT#orchestration](docs/DEVELOPPEMENT.md#orchestration), skill `miaou-orchestrate`, configuration projet et trois rôles TOML : Sol planifie/revoit, Luna implémente les tâches délimitées, GPT-5.6 Luna réservé aux extractions simples vérifiables à titre provisoire. Aucune autorisation de lancer tous les lots ou de publier n'en découle.

27 appels CLI synthétiques (3 modèles × 3 cas × 3 essais), puis réévaluation des réponses avec oracles corrigés sans nouvelle inférence. [Résultats et limites](docs/benchmarks/model-routing.md), données JSONL conservées. Contrôles locaux : syntaxe/lint du script, self-test avec mutants, replay et conservation des mesures, frontmatter YAML et TOML valides. Validation YAML native du skill indisponible avec le Python courant (PyYAML absent), parser YAML du projet utilisé. Le skill apparaît dans le prompt natif ; `codex exec --strict-config` réussit un smoke sans outil. Délégation réelle GPT-5.6 Luna via les outils de ce chat : extraction exacte réussie. Invocation des rôles TOML dans le CLI non confirmée : smoke arrêté après erreurs réseau. Un essai d'extraction CLI supplémentaire n'a pas démarré, revue automatique d'autorisation expirée ; aucun score ni usage inventé.

Revue indépendante : deux défauts des oracles détectés puis corrigés et vérifiés (tri numérique, taille par défaut) ; retour shell du replay corrigé également. Publication autorisée par Gabriel dans ce chat ; worktree isolé `model-orchestration`, branche `chore/model-orchestration`, base develop `29556d7`. Travail applicatif/CI concurrent préservé, aucun déploiement. **Suite :** appliquer le workflow sur la prochaine tranche explicitement demandée, contrôler le code réel et consigner qualité/corrections/usage disponible ; aucun gain global de tokens établi. Les résultats à trois essais restent exploratoires.

### Correctif de vérification — autorisé le 12 octobre 2026

Le premier hook complet avait réussi les contrôles statiques/builds et 84 tests serveur, puis échoué sur un E2E WebKit de reprise de zone (39/40). Reproduction isolée : attente de l’interception après navigation, pas une panne du workflow. Gabriel autorise explicitement la correction de cette fixture et la poursuite de la publication.

Une seule route réseau est maintenant installée avant la première navigation puis armée après sélection ; téléchargement retardé/avorté et assertions de protection inchangés. Quatre régressions Chromium/WebKit réussies sans réessai (24,4 s), ESLint et diff check réussis ; seconde lecture sans défaut démontré. Aucun changement applicatif. La première route stable suffisait aux quatre tests ciblés, mais pas toujours à la batterie complète. La fixture sert désormais le vrai module géographique avec `Cache-Control: no-store` pour exercer le téléchargement à froid ; seuls les headers de cette réponse de test changent. Batterie complète E2E : 40/40 réussis, sans réessai (2,6 min). Seconde lecture du complément sans défaut démontré. Un test journal inchangé avait aussi échoué ponctuellement puis réussi isolément et dans la nouvelle batterie de 84 tests serveur ; sa cause reste non confirmée. Le hook complet du prochain push, la CI et Greptile sur le SHA publié restent requis avant fusion.

### Review Greptile PR #17 — 12 octobre 2026

CI `38232387387` réussie sur `d0bd9c1`, Greptile 4/5 sur ce SHA avec un P2 confirmé : le replay retournait 0 pour une entrée vide ou une tâche sans observation. Le défaut a été reproduit avant correction. Filtre et rejet explicite avant création de sortie ; quatre régressions CLI passent (vide, sous-ensemble absent, succès et échec archivés). Tests sans modèle externe, mesures/réponses conservées ; lint/format/syntaxe et seconde lecture réussis. Nouveau hook, CI et review du prochain SHA requis avant fusion.

## Historique conservé de la tranche précédente

Les notes ci-dessous sont datées et ne décrivent pas le checkout courant.

### Orchestration locale — notes du 8 octobre

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
## Optimisation CI Playwright — 8 octobre 2026

Livraison vers develop autorisée par Gabriel. Branche isolée `chore/ci-playwright-image` depuis `2f811c4` ; aucun fichier concurrent du checkout principal inclus. E2E dans l’image officielle Playwright Noble correspondant à la version installée, avec Node du runner ; toutes les commandes de `verify:full` conservées en étapes nommées. Pic APT de 6 min 51 s confirmé dans la CI `37691534731`. Vérifications préalables : YAML/actionlint/diff, builds et 26 E2E sur copie Linux du précédent HEAD. Le hook complet du develop actuel et la CI/review du dernier SHA restent à obtenir avant fusion. Gain distant à mesurer ; aucun déploiement.


## Intégration du develop concurrent — 8 octobre 2026

CI `37756395363` sur `9a5dacc` entièrement réussie (attempt 2) ; attempt 1 annulée après diagnostic de téléchargements Ubuntu Azure très lents avant les tests, aucun contrôle modifié. Greptile 5/5 terminé sur `9a5dacc`, deux discussions résolues, aucun nouveau défaut actionnable. Develop a avancé à `c967e45` (PR #16, optimisation CI Playwright) : fusion de cette base, seul conflit documentaire NEXT_SESSION résolu en conservant les deux reprises. Aucun changement applicatif induit ; hook et nouvelle CI/review sur le SHA de fusion à obtenir avant fusion de PR #14.


## Chargement géographique différé — 8 octobre 2026

Tranche autorisée par Gabriel, reportée dans le worktree isolé `lazy-geography` sur `fix/lazy-geographic-loading` depuis develop `2f811c4`. Création de PR vers develop demandée ; aucun déploiement. Les changements/configurations/maquettes du checkout principal restent préservés.

Carte et géographie chargées à la demande : accueil/carnet/formulaire sans lieu sans JavaScript géographique ; aperçu, GPS et reprise manuelle conservent les validations existantes. Imports indisponibles : message lisible, publication sans lieu possible et retrait disponible. Aucune modification backend, migration ou seuil d’avertissement. Les chunks géographiques et MapLibre restent lourds mais différés ; aucun gain de latence mesuré.

Auto-revue miaou-review : base/HEAD `2f811c4`, quatre composants modifiés, nouveau wrapper et régressions E2E relus ; travaux antérieurs exclus. Vérifications complètes sur cette base réussies : 14 tests catalogue/outillage, 76 tests serveur, 36 E2E Chromium/WebKit, format/lint/types et builds application/backend/Storybook, audit high, Gitleaks/actionlint. Le nouveau test utilise une fixture amie distincte par navigateur après avoir reproduit un dépassement du quota du compte reader partagé ; aucune limite/assertion affaiblie. Verdict : prêt pour push sous autorisation, auto-revue uniquement. Prochaine action : publier la PR après hook réussi, puis vérifier CI/Greptile sur son SHA. Aucun fournisseur activé ni ouverture pilote.


## Reprise de livraison — 11 octobre 2026

PR #14 fusionnée vers develop en `8353b66` après CI complète et Greptile sur `404605f`, deux discussions résolues. CI de fusion `38162858525` en cours. PR #16 déjà fusionnée. PR #15 : intégration de develop `8353b66`, seul conflit documentaire résolu en conservant les reprises. Deux défauts Greptile corrigés : formulaire bloqué pendant la reprise de zone ; échec du téléchargement explicite, lieu précédent conservé et sélection non appliquée supprimée. Quatre régressions ciblées réussies sur Chromium/WebKit après build, cache désactivé dans le test pour exercer la requête réelle. Auto-revue du diff applicatif complet sans autre défaut démontré ; hook complet, CI et nouvelle review du SHA publié restent requis. Aucun déploiement ou service externe activé.
