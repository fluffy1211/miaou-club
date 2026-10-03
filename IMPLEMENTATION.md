# Miaou Club — plan d’implémentation

Établi avec Gabriel le 1er octobre 2026. Ce document transmet les décisions du chat de conception au chat d’implémentation.

## Objectif et référence

Construire un catalogue de races de chats fun, coloré, avec une identité scrapbook handmade. Les maquettes HTML appréciées par Gabriel sont la référence visuelle et fonctionnelle : `mockups/index.html`, `mockups/styles.css`, `mockups/app.js` et `mockups/README.md`. Les préserver pour comparer avec le site en cours de développement.

Pour les consulter : depuis `mockups/`, lancer `python3 -m http.server 4173 --bind 127.0.0.1`, puis ouvrir http://127.0.0.1:4173. Vérifier si le serveur existe déjà avant de le relancer. La route `#/design-system` présente les fondations. Le fichier Figma initial est une référence secondaire : https://www.figma.com/design/AozmnEcVBNze5LzjtuRSdw ; sa progression a été limitée par le quota, les maquettes HTML sont plus complètes.

Papier #FFF8ED, violet #49366D, corail #F47C67, jaune #F4D978, menthe #BCDCCB, lilas #E2D8F0. Fredoka pour les titres, DM Sans pour la lecture, Caveat pour les annotations. Réutiliser les fondations, les proportions, les photographies et les états des maquettes. Centraliser les styles et composants communs. Garder les textes courts : ne pas réintroduire « Une page trouvée au détour d’une recherche. » ni « Un peu de papier. Beaucoup de chats. ».

## Périmètre V1

- Accueil : recherche avec suggestions, races à découvrir, découverte aléatoire.
- Catalogue : recherche par nom et alias, filtres de pelage, tri A–Z/Z–A, état sans résultat.
- Fiches de races : photo, présentation, apparence, caractère, anecdote, sources, favoris.
- Favoris : stockage dans le navigateur, ajout/retrait, états vide et rempli.
- À propos et sources : présentation, références et crédits des images.
- Figue : page publique accessible par URL et recherche « Figue », absente de la navigation.
- Page 404 ; menu mobile ; agrandissement des photos accessible au clavier.

Comparateur, articles, comptes utilisateurs, administration et backend restent hors V1. Le premier lot de cinq races a servi à construire l’interface. À la demande de Gabriel le 2 octobre 2026, le catalogue couvre désormais les races exploitables de TheCatAPI, sans limite arbitraire à ce lot.

## Architecture retenue

Astro + TypeScript, Tailwind, collections de contenu et génération statique. Hébergement Cloudflare prévu. Pas de base de données ni de serveur applicatif au départ. React peut servir aux interactions qui le justifient ; les comportements simples peuvent rester en TypeScript côté navigateur. Vérifier les versions et intégrations dans les documentations officielles avant installation.

Utiliser de vraies URL de pages, sans le routeur hash de la maquette. Structurer les races avec identifiant stable, nom, alias, pelage, image et crédit/licence, textes et sources. Séparer les données des composants. Le domaine et la mise en ligne ne sont pas encore décidés : ne pas inventer de domaine canonique ni déployer.

## Ordre de réalisation

1. Inspecter le dépôt et les maquettes, puis installer le socle Astro/TypeScript/Tailwind. Créer le layout, les styles communs, les polices locales, les composants de navigation et le modèle de contenu. Préserver `mockups/` et les originaux.
2. Réaliser une tranche complète catalogue → fiche avec les cinq races : vrais liens, photos, contenus et sources. Comparer visuellement au prototype avant de généraliser les composants.
3. Ajouter l’accueil, la recherche avec suggestions, les filtres, le tri et la découverte aléatoire. Traiter accents, casse, espaces et état sans résultat.
4. Ajouter les favoris persistants, leur compteur et leurs états vide/rempli. Prévoir le stockage absent ou invalide.
5. Ajouter Figue, À propos/sources et la 404. Conserver les crédits, intégrer les photos remplaçables et les dialogues.
6. Vérifier le site et corriger les écarts. Compléter les métadonnées pertinentes sans domaine fictif. Documenter les commandes et ce qui reste avant publication.

Un seul agent pilote l’implémentation au départ pour maintenir la cohérence. Pas de sub-agents sans demande explicite. Avancer de façon autonome dans ce périmètre, sans redemander validation pour chaque étape. Ne pas créer de branche, commit, push ou déploiement sans instruction.

## Figue — données validées

Chat noir mâle, très intelligent ; 6 mois au 1er octobre 2026. Date de naissance inconnue : ne pas inventer un anniversaire ni afficher un âge figé comme actuel. Surnoms « Figue le chat figue », « Figolu », « Guff ». Il rapporte son jouet quand on le lance ; son endroit préféré est son hamac.

Gabriel autorise une page publique, tant qu’elle est cachée de la navigation. Éviter aussi de la révéler via les crédits généraux ou une liste de pages ; la recherche doit permettre sa découverte. La cacher de la navigation ne constitue pas une protection d’accès.

Photos originales : `/Users/gabriel/Downloads/Gmail`. Copies utilisées : `mockups/assets/figue-cover.jpg`, `figue-guff.jpg`, `figue-sieste.jpg`. Elles pourront changer. Ne pas modifier les originaux. Attention : un redimensionnement avec `sips` de IMG_2994.jpeg avait produit une image noire ; vérifier visuellement les conversions, la copie actuelle de la sieste est correcte.

## Critères de fin

- Toutes les pages du périmètre fonctionnent, y compris leurs états vides et la 404.
- Rendu fidèle aux maquettes à 390, 768 et 1440 px, sans débordement horizontal ni image cassée ; contrôle supplémentaire sur petit mobile à 375 px.
- Recherche, filtres, tri, navigation mobile, hasard, découverte de Figue et favoris vérifiés ; persistance après rechargement.
- Navigation clavier, focus visible, libellés accessibles, fermeture des dialogues avec Échap et mouvements réduits vérifiés.
- Images optimisées sans perte visible ni mauvaise conversion. Crédits/licences conservés depuis `mockups/assets/image-sources.json`. Vérifier les exigences d’attribution avant publication.
- Affirmations sur les races vérifiées auprès de sources identifiables ; les liens CFA présents dans la maquette constituent le point de départ.
- Vérification TypeScript/Astro et build de production réussis ; contrôle du rendu produit, pas seulement de la compilation. Tests ciblés sur les comportements utiles, sans multiplier les tests qui recopient l’implémentation.
- README avec commandes et limites connues. Site prêt à être revu localement ; aucun déploiement requis.

## État de départ

Le dépôt contient une maquette vanilla HTML/CSS/JS, pas encore l’application Astro. Les pages et interactions du prototype ont été contrôlées sur mobile/tablette/ordinateur. L’implémentation doit produire une structure maintenable tout en conservant le rendu approuvé. Mettre à jour ici l’avancement et les décisions utiles au fur et à mesure.

## Avancement — 1er octobre 2026

- [x] Étape 1 : socle Astro 7.3.5, TypeScript strict, Tailwind 4.3.3 via `@tailwindcss/vite` ; layout, polices locales, navigation et composants communs.
- [x] Étape 2 : collection `breeds` validée par schéma, cinq fiches générées et catalogue à vraies URL. Première comparaison visuelle du catalogue avec la maquette : couleurs, typographies, dimensions et grille conservées.
- [x] Étape 3 : accueil, suggestions, hasard, recherche normalisée, alias, filtres, tri et état vide. Paramètres du catalogue conservés dans l’URL.
- [x] Étape 4 : favoris sous la clé `miaou-club-favorites`, compteur, synchronisation entre onglets, stockage invalide ignoré et mode session si stockage inaccessible.
- [x] Étape 5 : Figue, sources et 404 ; dialogues natifs. Figue sans âge figé, absent du menu et des crédits généraux.
- [x] Étape 6 : V1 locale utilisable ; contrôles du build, du rendu de production et des interactions terminés. README ajouté avec commandes et limites avant publication.

Les maquettes et photos originales sont conservées. Copies de travail dans `src/assets/`, WebP générés par Astro au build (largeur maximale 1000 px, sans agrandissement, qualité 88). Les cinq fiches CFA ont été consultées le 1er octobre 2026 pour confirmer les résumés. Le crédit du Maine Coon est incomplet à la source Commons : auteur non renseigné ; ne pas inventer d’auteur et clarifier ce point avant publication.

Références techniques consultées : [collections Astro](https://docs.astro.build/en/guides/content-collections/) et [Tailwind pour Astro](https://tailwindcss.com/docs/installation/framework-guides/astro). Le skill local évoquait l’ancienne intégration Tailwind ; l’intégration Vite actuelle a été retenue selon la documentation officielle.

### Vérification finale

- `npm run verify` : 3 tests ciblés réussis ; `astro check` sans erreur, avertissement ni hint ; 11 pages statiques et 8 WebP générés. Vérification finale Astro/build répétée après les dernières corrections de suggestions.
- Rendu de production sur `http://127.0.0.1:4322` : 44 contrôles DOM (11 pages × 375/390/768/1440 px) sans débordement horizontal, image chargée cassée ni lien Figue dans la navigation. Inspection visuelle des écrans principaux mobile/tablette/ordinateur, ainsi que de la photo de sieste agrandie.
- Recherche avec accents, casse, espaces multiples et alias ; aucun résultat ; suggestions par Flèche bas/Entrée ; recherche Figue depuis accueil et catalogue ; hasard ; filtres mobiles et tri Z–A ; paramètres conservés après rechargement.
- Ajout/retrait de favoris, états rempli/vide, compteur, persistance après rechargement et mise à jour au retour arrière. Les données corrompues et identifiants inconnus sont couverts par les tests de validation ; le mode sans stockage est prévu dans le code.
- Menu mobile ouvert/fermé avec Échap ; agrandissement par Entrée, fermeture par Échap et restitution du focus ; focus clavier visible contrôlé. Règles CSS `prefers-reduced-motion` conservées ; pas d’audit multi-navigateur exhaustif.
- URL inconnue : statut HTTP 404 confirmé. Liens et ressources internes du build contrôlés ; copies des photos et polices comparées octet par octet aux fichiers des maquettes. Console navigateur sans erreur ni avertissement pendant le parcours final.
- Correction issue du rendu : `height: auto` sur les images pour laisser les ratios des polaroids prendre effet malgré les dimensions HTML. Les hauteurs des cartes et portraits restent celles du design approuvé.

V1 prête à être revue localement. Aucune branche, aucun commit, push ou déploiement. Avant publication : choix du domaine et de l’hébergement, canonicals/sitemap, revue des licences et clarification du crédit incomplet du Maine Coon. Le catalogue a été étendu le 2 octobre 2026, voir ci-dessous.


## Intégration des API — 2 octobre 2026

Demande de Gabriel : remplacer les données de démonstration par de vraies API. Les cinq races restent la sélection initiale, avec les mêmes URL et favoris. Le design approuvé, `mockups/` et les photos originales sont conservés.

- [x] TheCatAPI : clé fournie localement dans `.env`, appel authentifié réel à `/v1/breeds`, 107 races reçues. Les cinq entrées retenues utilisent les identifiants `mcoo`, `siam`, `beng`, `pers` et `bsho`.
- [x] Wikimedia Commons : appel réel `imageinfo` groupé pour les cinq fichiers approuvés ; photos distantes optimisées au build et crédits/licences issus de la réponse, sans inventer l’auteur absent du Maine Coon.
- [x] Collection Astro alimentée par un loader API. Les anciens JSON constituant les entrées complètes du catalogue sont remplacés par `src/data/breed-editorial.json`, limité aux textes éditoriaux, noms/alias français, sélection et choix visuels. Pelage, origine, caractère, poids et longévité ne sont plus codés en dur.
- [x] Pays, longévité indicative et poids ajoutés à la carte d’identité. Libellés du caractère traduits en français. Les introductions, apparences et anecdotes CFA restent éditoriales ; les sources distinguent clairement ces contenus des champs API.
- [x] Validation des réponses, délai réseau de 15 secondes, cache API de 24 heures et repli annoncé sur une vraie réponse de moins de sept jours en cas de panne. Sans réponse valide, échec explicite. `npm run data:refresh` force le réseau et refuse le repli.
- [x] `.env` et `.cache/` ignorés par Git ; `.env.example` ajouté. La clé n’est transmise qu’à TheCatAPI dans un en-tête serveur et n’est pas stockée dans le cache.
- [x] Tests API et logique existante : huit tests réussis ; diagnostic Astro sans erreur, avertissement ni hint ; build de 11 pages et 8 images réussi après rafraîchissement réel.
- [x] Rendu de production vérifié sur `http://127.0.0.1:4323` : 44 contrôles DOM (11 pages × 375/390/768/1440 px), sans débordement horizontal ni image chargée cassée. Filtres API, favoris persistants, agrandissement au clavier et restitution du focus vérifiés ; crédits Commons visibles contrôlés. Inspection visuelle mobile et ordinateur terminée.
- [x] Recherche de la valeur exacte de la clé dans les 47 fichiers de `dist/`, `.astro/` et `.cache/` : aucune occurrence. Aucun commit ni push effectué.

Choix final : TheCatAPI + Wikimedia, sans Cat Facts. Cat Facts avait été testé comme option sans clé, puis remplacé lorsque Gabriel a fourni la clé TheCatAPI. L’API répond 403 sans clé et avec `lang=fr` sur le compte actuel ; l’appel authentifié sans paramètre de traduction répond 200. Certaines races non sélectionnées ont des champs `origin`/`breed_group` nulls : le schéma les accepte dans la liste complète, puis exige les données nécessaires sur les cinq races affichées.

## Extension du catalogue — 2 octobre 2026

À la demande de Gabriel, la sélection initiale n’est plus une limite : le loader parcourt toutes les races exploitables du fournisseur. Réponse actuelle : 107 entrées, 95 races uniques affichées, dont 66 avec photo. Un doublon, les trois types de chats domestiques sans race, la polydactylie et sept entrées aux champs mal formés sont écartés. Aucun nombre maximal n’est codé en dur.

Les cinq URL et favoris initiaux sont conservés. Les 90 autres présentations françaises résument les descriptions reçues dans `src/data/breed-localizations.json`. Les nouvelles fiches affichent le pays, le pelage, le caractère traduit, la longévité et le poids ; aucune anecdote ajoutée sans source. Les 29 races sans image reçoivent un dessin « Portrait à venir ». Les photos API sont optimisées en WebP comme celles de Commons ; les crédits distinguent les fournisseurs et n’inventent pas de licence individuelle pour TheCatAPI.

Labels et types de pelage centralisés dans `src/lib/coats.ts`, couleurs dans les variables CSS communes aux badges, suggestions et filtres desktop/mobile. Les groupes « Hybrid » n’étant pas une longueur de poil, leur pelage est affiché comme non renseigné. Les catégories API combinées restent « Pelage variable ».

Vérification : neuf tests, contrôle Astro sans erreur et build de 101 pages. Catalogue à 95 cartes, recherche Sphynx, fiche avec photo, fiche sans photo, favoris persistants après rechargement puis restauration de l’état initial. Contrôle visuel desktop, 375 px et 768 px sans débordement horizontal. Pas de branche, commit, push ou déploiement.
