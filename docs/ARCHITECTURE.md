# Miaou Club — architecture et données

Lecture ciblée : [Socle](#socle) · [Structure](#structure) · [Migrations](#migrations) · [Modèle](#modele) · [Admission](#admission) · [API](#api) · [Photos](#photos) · [Export](#export) · [Capture/GPS](#carte)

Socle validé, détails proposés pour revue. L'état daté de réalisation et les preuves figurent dans [NEXT_SESSION.md](../NEXT_SESSION.md) ; vérifier le code, les migrations et les versions verrouillées avant d'annoncer une intégration disponible. Métier : [CADRAGE.md](CADRAGE.md) ; exploitation/lots : [DEVELOPPEMENT.md](DEVELOPPEMENT.md).

<a id="socle"></a>
## Socle validé

Astro + React + TypeScript ; Node.js + Effect ; Better Auth ; PostgreSQL. Méthodes de connexion : CADRAGE ; fournisseurs/environnements : DEVELOPPEMENT. Monolithe modulaire, un service Render pour commencer. Astro catalogue/editorial, React parcours interactifs ; styles communs fidèles aux maquettes.
Même origine frontend/API retenue pour le lot 1. Astro utilise l’adaptateur Node et délègue `/api/*` à `HttpApp.toWebHandlerLayer` d’Effect ; Le module comptes contrôle les requêtes `/api/auth/*` avant le handler Better Auth natif. Sessions Astro désactivées : Better Auth reste la seule autorité. `HttpApi` sera réévalué avec les contrats fonctionnels, sans Express/Hono ajouté.

Montage local éprouvé le 4 octobre 2026 : Node 24.21.0 dans Docker/CI préparée (hôte 26.8.1), Astro 7.3.5, React 19.3.0, TypeScript 6.0.3, Effect 3.22.2 + `@effect/platform` 0.97.2, Better Auth/adaptateur Drizzle 1.7.7, Drizzle ORM 0.45.3/Kit 0.31.11 et pg 8.23.1. Lockfile et `.node-version` font autorité pour les commandes. [Effect 4 est désormais stable](https://effect.website/blog/releases/effect/40) ; la v3 verrouillée est retenue avec son package HTTP compatible, sans mélange d’API v3/v4. [API HTTP v3](https://effect.website/docs/v3/api/platform/HttpApp), [adaptateur Node](https://docs.astro.build/en/guides/integrations-guide/node/) et [Better Auth Drizzle](https://better-auth.com/docs/adapters/drizzle) vérifiés le 4 octobre. Preuves datées : NEXT_SESSION.
Playwright (E2E) et Storybook (design system) validés ; Plop optionnel. Périmètre et CI : section « Outillage frontend et uniformité » de `DEVELOPPEMENT.md`.

<a id="structure"></a>
## Structure validée

Conserver Astro à la racine, ajouter un package backend isolé ; pas de déplacement gratuit de `src/`. Espaces npm recommandés avec le gestionnaire existant.

```text
src/                       Astro actuel, futurs composants React
server/src/
  http/                    routes, validation, traduction erreurs
  modules/                 profiles, encounters, moderation, account-data
  infrastructure/          auth, db, images, storage, logs
  jobs/                    tâches persistantes purge/export/reprise
server/drizzle/            migrations SQL et métadonnées
packages/contracts/        contrats partageables sans imports serveur
```

Dossiers créés seulement au lot autorisé. Contrats navigateur sans schéma SQL, clés du stockage ou Better Auth serveur. HTTP → service métier → adaptateur ; éviter des interfaces/classes sans besoin réel. Client API frontend commun, validations serveur autoritaires.

<a id="migrations"></a>
## PostgreSQL/migrations — outils validés, modalités proposées

**Drizzle ORM + Drizzle Kit + `pg` validés par Gabriel le 3 octobre 2026**, avec migrations SQL versionnées et historique commun auth/métier. Compatibilité minimale éprouvée au lot 1 ; cela ne valide pas les futurs parcours fonctionnels. Appels asynchrones enveloppés dans des services Effect avec erreurs typées ; `@effect/sql-drizzle` reste une alternative à tester, pas une dépendance obligatoire.
Un pipeline de migrations pour auth et métier. Générer le schéma Better Auth de la version verrouillée, intégrer à Drizzle, générer/revoir SQL ; pas deux moteurs concurrents ni tables auth inventées.
Transactions avec la même connexion et contexte ; des appels indépendants ne font pas une transaction.

- SQL/métadonnées versionnés ; migration appliquée immuable, correction par nouvelle migration.
- Pas de `drizzle-kit push` en préprod/prod. Migration relue exécutée une fois, par étape de livraison verrouillée.
- CI : DB vide → toutes migrations ; version précédente → nouvelles migrations avec fixtures.
- Compatibilité ascendante d'abord, migration données ensuite, suppressions après. Rollback applicatif ≠ rollback SQL automatique.
- Contraintes PostgreSQL d'unicité/relations/domaines ; SQL paramétré et transactions métier.

Migrations livrées au lot 1 : `0000_auth.sql` issu du schéma généré par la CLI `auth` 1.7.7, puis `0001_policy.sql` ajoutant `user_policy` (FK unique, admission refusée par défaut, statut contraint). Un historique Drizzle commun ; génération/revue séparées de l’application des migrations. Tests sur bases PostgreSQL jetables distinctes, car le SQL généré référence explicitement `public` : base vide, auth avec fixture → politique, répétition sans doublon et contraintes/cascade. Le migrateur compilé et le SQL sont inclus dans le build ; Drizzle Kit reste un outil de génération local/CI, exclu de l’image runtime.

<a id="modele"></a>
## Modèle logique proposé — à valider

| Entité | Champs/contraintes essentiels |
| --- | --- |
| Auth Better Auth | User, identités Google/credentials, sessions/vérifications selon schéma généré ; mots de passe gérés par Better Auth |
| `profile` | FK unique user, handle normalisé unique, nom, bio, couleur, avatar |
| `user_policy` | FK unique user, rôle, actif/suspendu/suppression, motif/dates |
| `encounter` | ID stable, auteur, titre non vide, description facultative, date locale, public/private, visible/hidden, révision, timestamps UTC |
| `media` | Propriétaire, usage rencontre/avatar, clés internes, dimensions/format/taille, pending/ready/deleting/failed ; une photo publiée par rencontre |
| `location_zone` | Grille/projection, niveau 500/1000/2000, cellule et bornes/géométrie dérivées ; relation facultative unique rencontre |
| `report` | Signalant, rencontre, catégorie, commentaire éventuel, open/resolved/dismissed, traitement/motif/date |
| `moderation_action` | Admin, cible, action/motif/date ; pas de tokens/copies systématiques du contenu |
| `operation` | Idempotence liée au compte/type, empreinte requête, résultat/état |
| `job` | Purge/export/reprise, cible/état/tentatives/prochaine exécution |

IDs opaques proposés, sans remplacement des permissions. Handle/nom jamais clé auteur ; handles système réservés. Contrainte empêchant deux rencontres de partager la même photo. Identifiant public immuable selon CADRAGE ; contrôler côté serveur le refus de modification, même lors de la mise à jour du nom affiché. Longueurs/index/normalisation restent à préciser.
Amis inclus dans la V1 selon CADRAGE ; tables demandes/relations à concevoir au lot amis, absentes de ce premier modèle proposé. Aucune entité « chat identifié » ou reconnaissance de race introduite implicitement.
Projection **Lambert-93** validée le 3 octobre 2026 ; mettre en œuvre les niveaux emboîtés de CADRAGE avec origine commune fixe. Conversion position → cellule côté navigateur ; serveur valide l'identifiant/niveau/périmètre et dérive la géométrie. Élargir depuis cellule stockée, pas depuis GPS secret ; ne pas arrondir les degrés comme des mètres. Périmètre et rencontres sans lieu définis dans CADRAGE. La taille au sol reste approximative du fait de la projection. Référence [IGN consultée le 3 octobre 2026](https://geodesie.ign.fr/que-sont-les-projections-lambert-93-et-coniques-conformes-9-zones). Lot 4 : grille `location-v1`, origine projetée commune (0 m, 0 m), définition EPSG:2154 (Lambert-93/GRS80) avec Proj4 2.22.0 ; indices entiers calculés par plancher. Carrés 500/1000/2000 m emboîtés, géométrie dérivée depuis ces seuls indices. Les cellules doivent intersecter les contours continentaux retenus ; les positions ponctuelles sont filtrées avant conversion. [Contours Etalab 2026 à généralisation 100 m](https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2026/geojson/regions-100m.geojson), plus grand polygone de chacune des douze régions continentales, trous conservés, Corse/outre-mer/îles exclus. Métadonnées du [jeu source](https://www.data.gouv.fr/datasets/contours-administratifs) : ODbL ; provenance, attribution et empreinte SHA256 conservées dans `mainland.ts`. Les données dérivées restent sous cette licence, distincte du code applicatif ; téléchargement GeoJSON proposé dans l’attribution via `/api/v1/map/contours`, réservé au groupe et sans données de rencontres. Ce périmètre généralisé ne garantit pas une frontière cadastrale ni une exactitude GPS ; une rencontre refusée peut être publiée sans lieu. Pas de PostGIS.

<a id="admission"></a>
## Admission au pilote fermé — règle validée, mécanisme proposé

Périmètre métier unique : CADRAGE, section Comptes. Lot 2 : `admission` porte les adresses normalisées autorisées par Gabriel. Les hooks natifs de création vérifient cette autorisation et la preuve signée 18+/CGU (cookie HttpOnly, version et expiration 10 minutes) ; aucune vérification obligatoire de l’adresse. `user_policy` conserve date/version d’acceptation, rôle, statut et récupération MFA. Création du profil unique rattaché à l’ID auth ; handle unique et immuable. Google/credentials ne sont jamais fusionnés implicitement.

`session_security` porte les délais absolu/inactivité, fraîcheur et MFA par session ; aucun cache de cookie ne dispense du contrôle DB. Liaison explicite sous réauthentification ; création d’un mot de passe pour Google exige encore une preuve fraîche lors de la consommation du lien. Exception manuelle : autorisation temporaire en table native `verification`, liée au jeton par HMAC et issue uniquement de l’opération d’exploitation après validation humaine. Les liens natifs restent à usage unique. MFA TOTP natif avec `allowPasswordless` ; preuve complémentaire côté serveur pour empêcher une session Google ordinaire d’accéder à l’administration. Récupération par secours ou opérateur révoque les anciennes sessions et bloque les privilèges jusqu’au nouveau facteur vérifié.

Implémentation : `server/src/accounts/`, exposée via le service HTTP Effect ; migration additive `0002_hesitant_xorn.sql` et schéma natif régénéré. Compteurs PostgreSQL atomiques/HMAC, audit et traces d’envoi sans lien ni contenu. Commandes d’exploitation, rétention et configurations : DEVELOPPEMENT. Aucun compte réel créé ; Google réel et délivrabilité restent à éprouver.

Contrôler admission + session + statut avant les routes de contenu, listes, profils, carte, catalogue du pilote et images ; contrôler ensuite les droits propres à chaque ressource. OAuth/email ne doivent pas créer une admission en contournant ce contrôle. Les clés `public/private` existantes peuvent désigner les visibilités internes : `public` = membres admis autorisés, jamais accès anonyme Internet. Aucun fichier photo servi directement par un chemin statique public. Distinguer accès aux contenus du groupe et portail restreint des droits sur ses propres données après suspension/retrait ; contact hors connexion conservé.

<a id="api"></a>
## API proposée — contrats à préciser

API du socle et du lot 2 : `/api/health`, `/api/ready`, `/api/v1/access` (session → admission → statut → acceptation en base à chaque demande), `/api/v1/me`, `/api/v1/me/profile`, `/api/v1/profiles/:handle`, `/api/v1/reauth`, révocation des autres sessions et routes admin admission/quota sous MFA. Profil partagé : projection sans adresse ni identifiant auth. Suspendu/retrait : portail propre conservé, groupe refusé. Export et suppression : garde sensible exécutée puis `501`, réalisation au lot 5.

Pages React/Astro : `/profil`, `/compte`, `/mot-de-passe-oublie`, `/reinitialisation` et informations `/conditions`. Inscriptions refusées tant que `MIAOU_TERMS_VERSION` n’est pas configurée après finalisation des CGU. Aucun endpoint de fournisseur simulé livré ; doubles réservés aux tests.

Le middleware protège les pages du catalogue. Pour le build exécuté par `npm run start`, `server/start.mjs` contrôle aussi les images avant le serveur statique Astro, y compris chemins encodés et `/_image`, puis impose `no-store`. Ne pas démarrer directement `dist/server/entry.mjs` : cela contournerait cette garde des fichiers statiques. Il s’agit des images du catalogue historique ; les photos de rencontres nécessiteront leurs propres permissions de ressource et leur stockage privé. `astro dev`/preview ne prouvent pas cette protection des fichiers : développement avec fixtures uniquement.

Better Auth : `/api/auth/*`. API métier : `/api/v1/`, JSON validé, listes paginées/plafonnées, tri stable. Appliquer la distinction des dates de CADRAGE, y compris après édition/réessai idempotent ; timestamps serveur UTC distincts de la date locale saisie.

| Groupe | Opérations |
| --- | --- |
| Identité/profil | Lire session/politique/admission, profil partagé autorisé ; modifier son profil |
| Rencontres | Partagé dans le groupe/carnet/détail autorisé ; créer, modifier champs autorisés, supprimer |
| Médias | Upload/traitement ; lecture variante autorisée ; pas de remplacement photo publiée |
| Carte | Membres admis uniquement ; emprise bornée, rencontres partagées/regroupements, pas de GPS brut |
| Signalements/admin | Signaler rencontre publique accessible ; traiter, masquer/rétablir, suspendre/réactiver, audit |
| Données personnelles | Export et suppression avec confirmation/réauthentification |

Erreurs stables : validation, authentification, permission, introuvable, conflit, limite, dépendance indisponible. Ne pas révéler une rencontre privée à un tiers, y compris par son existence. Clés stockage/données privées exclues des réponses publiques. Retour login limité aux routes internes autorisées.
HTTP Effect HttpApi recommandé à évaluer, avec délégation native du handler Better Auth ; Express/Hono non ajoutés sans besoin constaté. Éviter de réimplémenter OAuth.

<a id="photos"></a>
## Photos/cohérence — tranche locale du lot 3

Règles et formats : [Photos](CADRAGE.md#photos). Pipeline local JPEG/PNG/WebP implémenté avec Sharp 0.35.5 ; HEIC refusé explicitement par le binaire distribué, compatibilité sur vrais téléphones restant à éprouver. Supabase Storage 2.117.2 intégré comme adaptateur serveur, sans activation externe. Preuves datées et limites dans NEXT_SESSION.

Vérification du 3 octobre 2026 : poids variable selon scène/format, pas de moyenne universelle établie. [Apple](https://support.apple.com/en-ie/119916) indique environ 25 Mo en ProRAW 12 MP et 75 Mo en 48 MP, avec des fichiers RAW 10 à 12 fois plus lourds que HEIF/JPEG. Des [photos iPhone 17 Pro Max publiées par leur auteur](https://www.kenrockwell.com/tech/2025-10.htm) atteignent 21–25 Mo en JPEG 48 MP ; ces exemples ne constituent pas une moyenne. [Pixel Pro](https://support.google.com/pixelcamera/answer/14106982?hl=en-GB) propose le mode 50 MP ; [Samsung](https://semiconductor.samsung.com/technologies/image-sensor/ultra-high-resolution/) explique qu'un capteur 200 MP peut produire 12,5 MP par défaut.

Les limites de CADRAGE laissent une marge aux JPEG 48 MP et aux dimensions réelles des modes annoncés 50 MP, sans couvrir tous les modes haute résolution. Vérifier fichiers réels et ressources serveur au lot images.

1. Upload authentifié borné, temporaire privé : contrôler décodage/contenu, octets/pixels/durée/concurrence, pas seulement MIME déclaré.
2. Orientation/réencodage/métadonnées supprimées, variantes. Appliquer les formats/limites de CADRAGE ; HEIC et bibliothèque à éprouver sur iPhone/Android. Original temporaire purgé après succès/expiration.
3. Média prêt appartenant au compte → création transactionnelle avec clé idempotence. Même clé/contenu : même résultat ; même clé/contenu différent : conflit.
4. Échec stockage/DB : état récupérable, fichiers orphelins purgés, pas de succès fictif. Réessais bornés seulement si idempotents.
5. Suppression : accès bloqué en DB immédiatement, tâche durable purge variantes avec reprise. SQL et le stockage de fichiers ne partagent pas une transaction atomique. Pour le pilote Supabase, supprimer les objets via API Storage, jamais par suppression SQL de leurs seules métadonnées ; contrôler les réessais et fichiers orphelins. Les sauvegardes DB Supabase ne couvrent pas les objets photo. Sources et limites dans [FOURNISSEURS.md](FOURNISSEURS.md) ; purge locale éprouvée au lot 3, purge/restauration chez Supabase non éprouvées.

Mise en œuvre de la politique [Photos](CADRAGE.md#photos) : bucket Supabase privé et passerelle backend `/media/...` avec `Cache-Control: no-store`. Les nouvelles demandes respectent public → privé, masquage et suspension ; cela ne retire pas une image déjà reçue ou affichée. Le transfert Render doit être mesuré et budgété ; les quotas de trafic Supabase et Render sont distincts et doivent tous deux être mesurés. CDN/Worker avec contrôle droits à évaluer avant toute optimisation, en préservant cette politique.
Vérification documentaire du 3 octobre 2026 : [R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) permet de réutiliser une URL présignée jusqu'à expiration ; un changement de visibilité en PostgreSQL ne modifie pas cette autorisation. [Render](https://render.com/docs/outbound-bandwidth) comptabilise le trafic sortant vers les clients ; la passerelle doit être mesurée. [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control) documente `no-store`. Politique d’accès validée ; références R2 historiques. Accès privé et absence de cache vérifiés localement au lot 3 ; intégration Supabase réelle restant à éprouver.
Listes/carte/profils appliquent admission + session + public + visible + auteur actif + média prêt. Carnet propriétaire et exception administrative selon CADRAGE ; contrôle serveur commun aux données et images, contexte de signalement et audit requis pour la consultation exceptionnelle. Pas de cache PWA des photos ; absence de cache PWA des données privées également proposée.

### Mécanismes réalisés du lot 4

`GET /api/v1/encounters`, `/api/v1/profiles/:handle/encounters` et `/api/v1/map` : même sélection des rencontres publiques, non masquées/non supprimées, média prêt et auteur actif/admis avec admission et acceptation valides. L’appelant doit aussi accéder au groupe. Trente rencontres par page, tri publication/ID ; curseur date UTC à six décimales + ID, sans lookup d’une ressource privée, encore utilisable après retrait du point de pagination. Listes partagées sans lieu ; carte limitée aux rencontres avec cellule, détail et passerelle images soumis aux droits existants. Les profils publics existants sont réutilisés sans e-mail. Migration `0007` : index partiels `encounter_feed` (public, non masqué/non supprimé) et `encounter_map` (mêmes conditions, cellule présente), sur `(published_at,id)` pour le tri et le curseur. Les prédicats média prêt/auteur actif/admission restent contrôlés par les jointures, hors index partiels. Plan SQL vérifié sur 5 000 rencontres synthétiques : utilisation des index et absence de tri global, sans garantie de coût constant lorsque beaucoup d’auteurs ne sont plus admissibles.

Migrations additives `0005`/`0006` : cellule facultative unique portée directement par `encounter.location_size/x/y` (pas de table physique `location_zone`) et contexte `location_context` (méthode position/carte, version `location-v1`, date serveur de réception, sans GPS). Ce contexte enregistre un choix déclaré et sa réception, pas une certification juridique du consentement. Publication incluse dans l’empreinte d’idempotence ; empreintes sans lieu du lot 3 préservées. Édition sous verrou/révision : conservation, élargissement contenant la cellule précédente ou retrait ; ajout/déplacement/réduction refusés. Retrait/suppression effacent aussi le contexte.

Accueil, listes et profils React/Astro avec Polaroids existants ; carte MapLibre GL 6.13.0, worker empaqueté localement, géométries et regroupements par cellule dans le navigateur. Carte de contours locale disponible sans service tiers, sélection manuelle (clic ou centre au clavier), liste alternative toujours accessible ; seules les pages déjà chargées sont représentées, « Voir la suite » ajoute aussi les zones. Acquisition ponctuelle au clic depuis la description, pas à l’ouverture ; précision supérieure à la moitié du côté refusée, aperçu de la zone, retrait et publication sans lieu. Callbacks abandonnés à la sortie/retrait. Le brouillon garde seulement la cellule et la méthode, jamais les coordonnées précises.

MapTiler préparé derrière `PUBLIC_MIAOU_MAPTILER_APPROVED=1` et une clé navigateur publique limitée aux domaines autorisés, **désactivé par défaut**. Raster direct, logo/attributions MapTiler et OpenStreetMap ; géocodage ville/quartier seulement pour déplacer la vue, résultats en mémoire, sans cookies/référent/cache ni biais de proximité GPS. Aucun contenu, profil, identifiant ou photo ajouté aux requêtes. Double HTTP vérifie ce contrat ; fournisseur réel, quota et réseau réel non éprouvés. [Blocage contractuel](FOURNISSEURS.md#maptiler) et autorisation d’activation séparée toujours requis. Documentation consultée le 6 octobre 2026 : [Proj4](https://proj4js.org/), [MapLibre](https://maplibre.org/maplibre-gl-js/docs/API/), [MapTiler géocodage](https://docs.maptiler.com/cloud/api/geocoding/). Preuves d’exécution et limites dans NEXT_SESSION.

### Mécanismes réalisés du lot 3

`server/src/encounters` porte HTTP, service/pipeline et adaptateurs. Migrations additives `0003`/`0004` : média et propriétaire liés par FK composite, photo unique par rencontre, clé de publication unique par propriétaire, état et dimensions contraints. Les lectures JSON et `/media/:id/{image|thumb}` emploient le même prédicat de visibilité ; aucun privilège de lecture du carnet privé induit par le rôle admin. Accès personnel conservé après suspension/retrait, édition/publication interdites. L'exception administrative de signalement attend le lot 5.

Upload brut par passerelle, quota réservé en PostgreSQL avant lecture, taille effectivement lue comptabilisée ; verrou partagé par compte et une réception/un traitement à la fois au niveau de la base. Lecture interrompue au délai, décodage borné, deux variantes WebP (1920 px et 480 px, sans agrandissement). `media` est créée avant toute écriture objet ; ses états font office de tâches durables. Trois tentatives maximum de traitement ; reprise sous verrou après arrêt, purge idempotente avec délai croissant après panne. Les fichiers temporaires locaux ont un chemin déterministe couvert par la purge. Suppression : retrait immédiat et effacement du texte/date de rencontre ; trace minimale de publication supprimée sous sept jours, conservée dans cet intervalle pour les réessais, puis retrait des références médias purgées. Une indisponibilité durable du stockage reste une limite opérationnelle à traiter avant ouverture.

Publication : transaction PostgreSQL, sérialisation du quota et de l'idempotence, média prêt du propriétaire, présence des deux variantes vérifiée, empreinte du contenu et réponse stable pour un réessai identique. Édition sous révision : titre/description/date de rencontre/visibilité uniquement, sans remplacement photo ni changement de la date de publication ou des masquages. Carnet personnel paginé ; découverte et localisation ajoutées ensuite au lot 4 selon la section précédente.

Brouillon : reprise dans le même onglet annoncée dans l'écran, champs/ID/clé dans `sessionStorage` lié au compte, sans image binaire ni GPS ; expiration à celle du média, fermeture de l'onglet/déconnexion et bouton d'effacement. Aucun service worker ni publication hors connexion. Si ce stockage navigateur est refusé, le parcours connecté reste utilisable sans reprise après rechargement.

Documentation primaire consultée le 6 octobre 2026 : [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/), [output](https://sharp.pixelplumbing.com/api-output/), [installation et limites HEIC](https://sharp.pixelplumbing.com/install/), [Supabase téléchargements privés](https://supabase.com/docs/guides/storage/serving/downloads), [upload](https://supabase.com/docs/reference/javascript/storage-from-upload) et [suppression](https://supabase.com/docs/reference/javascript/storage-from-remove). SDK et code verrouillés inspectés ; contrat de l'adaptateur testé avec un double HTTP, stockage local éprouvé dans les E2E. Ces preuves ne valident pas le fournisseur réel.

## Sources officielles consultées le 3 octobre 2026

[Better Auth Drizzle](https://better-auth.com/docs/adapters/drizzle), [sessions](https://better-auth.com/docs/concepts/session-management), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [génération SQL](https://orm.drizzle.team/docs/drizzle-kit-generate), [Effect SQL Drizzle v3](https://effect.website/docs/v3/api/sql-drizzle), [HTTP v3](https://effect.website/docs/v3/api/platform/HttpApiBuilder), [v4 bêta](https://effect.website/blog/releases/effect/40-beta), [Astro React](https://docs.astro.build/en/guides/integrations-guide/react/).
Ces capacités documentées ne prouvent pas l'intégration locale. Premier lot : compiler auth + migration + opération Effect + rendu Astro avant de figer les versions/montages.

<a id="export"></a>
## Export des données — inventaire proposé le 4 octobre 2026

Formats et règles de droits/conservation validés : CADRAGE, sections « Accès et export » et « Conservation ». Cartographie : [JURIDIQUE.md](JURIDIQUE.md#cartographie) ; contrats : [FOURNISSEURS.md](FOURNISSEURS.md). Ce contrat documentaire prépare le lot données ; aucun schéma SQL/API/générateur existant, noms et champs à ajuster au schéma réel. Couvrir tous les champs personnels réellement traités ; inventaire de conception non exhaustif tant que les migrations/dépendances/flux ne sont pas inspectés.

### Structure de l'archive proposée

| Élément du ZIP | Contenu attendu |
| --- | --- |
| `README.txt` | Mode d'emploi, date et périmètre de la copie, signification des dates/statuts, informations sur données non conservées et complément d'accès, contact |
| `manifest.json` | Version du schéma, date UTC de génération, identifiant de demande non secret, période/état de référence, inventaire fichiers et nombre d'enregistrements ; pas de clé ni lien réutilisable |
| `data.json` | Données structurées de référence ; catégories du tableau suivant, liens cohérents entre enregistrements et fichiers photo |
| `tables/*.csv` | Tables équivalentes pour lecture dans Excel : profil, comptes liés (métadonnées), rencontres, médias, amis/demandes et décisions accessibles ; tables supplémentaires selon données réelles |
| `photos/` | Fichiers traités encore conservés, y compris rencontres privées ou masquées du propriétaire ; variantes documentées, sans EXIF/GPS ni originaux déjà purgés |
| `informations-traitement.txt` | Version/date de notice et informations requises pour droit d'accès applicables ; catégories/sources/destinataires/durées/transferts et possibilité de complément, cohérentes avec réponse effective |

### Inventaire par catégorie

| Catégorie | Données à restituer ou examiner | Modalité prévue et précautions |
| --- | --- | --- |
| Compte/profil | Identifiant public, nom, e-mail et vérification, avatar/bio/couleur, dates du compte, rôle/statut et données de profil réellement stockées | JSON/CSV ; avatar conservé à inclure ou expliquer sa source externe, pas simple lien temporaire à un fichier qui disparaîtra |
| Comptes liés/sessions | Fournisseurs liés, dates/états de liaison et sessions, métadonnées de sécurité concernant la personne réellement conservées | Métadonnées utiles dans copie ; jamais jetons, cookies de session, secrets OAuth/TOTP, codes de secours ni hachages de mot de passe. Complément sécurisé si d'autres données personnelles existent, sans exclusion globale des logs/sessions |
| Rencontres | Identifiant export, titre/description, auteur, date de rencontre, publication, modification si conservée, visibilité, masquage et références médias | Toutes les rencontres encore conservées du propriétaire ; masquage/suspension n'empêchent pas accès à ses données. Pas de recréation de rencontre supprimée |
| Localisation | Identifiant/niveau de cellule, zone représentative/géométrie dérivable et contexte de choix réellement conservé | Approximation uniquement, jamais GPS précis ; preuve de consentement minimale si conservée, pas géocodage non conservé |
| Photos/médias | Fichier conservé, type, dimensions et relation à rencontre/avatar, variantes effectivement conservées | Chemins relatifs sûrs dans ZIP ; médias appartenant au demandeur ; pas de clé de stockage brute ni URL signée. Distinguer variante disponible de l'original détruit |
| Amis/demandes | Relations actuelles, demandes entrantes/sortantes et états/dates encore conservés concernant le demandeur | Informations nécessaires à comprendre sa relation, identifiants publics ; pas e-mail/carnet privé de l'autre personne. Examiner droits tiers avant copie ; rétention/suppression selon CADRAGE, aucun historique purgé reconstitué |
| Signalements/décisions | Signalements émis/reçus, décisions/motifs de masquage/suspension concernant la personne et événements d'accès admin à ses privés, lorsqu'ils sont conservés | Revue adaptée avant restitution ; décision accessible automatiquement si sûre, autres éléments via complément. Pas de divulgation automatique du déclarant, des données de tiers ou des détails qui compromettraient une enquête ; toute limitation d'accès doit être justifiée, pas exclusion de catégorie |
| Sécurité/limites techniques | Événements concernant le demandeur, identifiants protégés et compteurs personnels encore actifs | Analyse dans réponse d'accès/complement ; minimiser divulgation de détails exploitables et tiers ; traitement automatisé de limitation expliqué selon comportement réel |
| Support/droits/e-mails | Messages de la personne, demandes d'export/suppression/récupération, suivi/réponses et traces d'envoi qui la concernent | Inventorier aussi boîte OVHcloud/Resend et données conservées hors DB ; complément manuel protégé si absent de l'export autonome. Pas de pièce d'identité créée pour l'export |
| Sauvegardes | Catégories de données sauvegardées et critères de conservation, suppressions en attente d'expiration | Pas de restauration automatique de données supprimées dans ZIP courant ; identifier toute donnée encore traitée uniquement en sauvegarde pour répondre aux droits, sans exclure globalement l'accès |
| Favoris du catalogue | Identifiants de races du navigateur | Actuellement localStorage, absents de DB ; expliquer cette limite et suppression locale, éventuelle collecte locale pour téléchargement à décider lors du parcours, aucune synchronisation implicite |

### Contrat et preuves à produire au lot données

- JSON UTF-8 de référence ; schéma versionné et dictionnaire des champs (sens, type, nullabilité, source, base/finalité). Dates de rencontre civiles `YYYY-MM-DD` ; événements serveur en ISO 8601 UTC ; ne pas confondre les deux.
- Tables CSV UTF-8 avec en-têtes explicites, séparateur/encodage annoncés dans README, accents/dates testés dans Excel. Neutraliser les formules dans cellules issues des utilisateurs ; JSON conserve les valeurs de référence. Échapper guillemets, séparateurs et retours à la ligne.
- Identifiants export stables dans une archive, liens entre photos/rencontres/relations vérifiables. Noms de fichiers générés sans texte utilisateur/chemin système ; prévenir traversée de chemins et collisions, y compris pendant création et décompression.
- Génération durable avec état cohérent DB/photos ; définir instant de référence et comportement si suppression/modération survient pendant génération. Vérifier les droits à la demande et au téléchargement ; invalider archive devenue non autorisée (notamment compte supprimé), réauthentification selon CADRAGE.
- Autoriser compte suspendu à obtenir ses données, aucun accès à une archive d'autrui par URL/devinette ; téléchargement via contrôle serveur, pas de bearer public permanent ni pièce jointe par e-mail. Reprise et expiration selon CADRAGE, purge tâche/fichier et liens effectifs à tester.
- Confronter inventaire à chaque table, objet, journal, fournisseur et stockage local ; tests d'exhaustivité, droits tiers, suppression en cours, fichiers manquants, échec/reprise, cohérence JSON/CSV/photos et quotas. Si un élément ne peut être fourni automatiquement, l'indiquer et organiser le complément ; pas de succès complet fictif.

<a id="carte"></a>
## Capture et géolocalisation — mécanismes à éprouver

Parcours géolocalisation contextuelle validé dans CADRAGE le 4 octobre 2026. Références consultées : [CNIL permissions et consentement](https://www.cnil.fr/fr/permissions-applications-mobiles-recommandations-de-la-cnil-pour-respecter-la-vie-privee), [MDN acquisition ponctuelle](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition). Au lot photos/carte, mettre en œuvre une acquisition ponctuelle après action éclairée, sans suivi ; consentement à documenter (finalité/information présentée/action/version), sans conserver le GPS dans la preuve. Vérifier si l'information au bouton suffit réellement au consentement et compléter le parcours si nécessaire ; aucune certification par le seul clic. Permission mémorisée/refusée, HTTPS, délai d'attente et erreur à prendre en compte. Traiter la position précise temporairement côté téléphone puis ne transmettre que la cellule ; pas de GPS précis dans les appels géocodage, logs, télémétrie ou stockage navigateur. Une position trop imprécise pour la cellule choisie ne doit pas être présentée comme fiable : solution manuelle/sans lieu. Tester refus/annulation, nouvelle rencontre avec permission déjà accordée, photo ancienne, aperçu, retrait du lieu et absence de fuite GPS dans les requêtes effectivement émises. Parcours mobiles émulés et flux sans fournisseur contrôlés au lot 4 (preuves dans NEXT_SESSION) ; vrais téléphones, rôles MapTiler et conditions réelles des flux restent à vérifier dans [FOURNISSEURS.md](FOURNISSEURS.md).

Parcours appareil photo/galerie précisé dans CADRAGE le 4 octobre 2026. Sources [MDN capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) et [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) consultées le même jour : capture native via sélecteur et accès direct au flux caméra sont deux mécanismes distincts. Une capture native ne garantit ni la même interface ni une permission navigateur dédiée sur tous les téléphones ; `getUserMedia` nécessite une permission et fournit un flux, pas l'ouverture de l'application caméra native. Choisir le mécanisme au lot photos, en visant ouverture immédiate au clic, sans étape applicative intermédiaire ; tester iPhone/Android, navigateur/PWA, permissions accordées/refusées, annulation et retour à la galerie. Ne pas demander de microphone pour une photo. Aucun mécanisme choisi/implémenté/testé à ce stade ; géolocalisation et consentement suivent le parcours distinct validé dans CADRAGE, avec contrôles ci-dessus.
