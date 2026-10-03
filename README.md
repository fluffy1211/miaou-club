# Miaou Club

V1 locale d’un catalogue de races de chats, fidèle aux maquettes scrapbook approuvées. Astro 7, TypeScript strict, Tailwind 4 via Vite, génération statique et collections de contenu. Aucun backend.

## Lancer

Node.js **22.12 minimum** (vérifié avec Node 26.8.1) et npm 9.6.5 minimum.

```sh
npm ci
cp .env.example .env
# Renseigner CAT_API_KEY dans .env
npm run dev
```

Ouvrir http://127.0.0.1:4321. Avec Astro 7, le serveur continue en arrière-plan : `npx astro dev status`, `npx astro dev logs` et `npx astro dev stop` permettent de le gérer.

```sh
npm run verify   # tests ciblés, diagnostic Astro/TypeScript et build
npm run preview -- --port 4322
```

Le rendu de production est alors disponible sur http://127.0.0.1:4322. Gestion du serveur : `npx astro preview status` et `npx astro preview stop`. Les fichiers statiques sont dans `dist/`.

## Pages et comportements

- `/` : accueil, recherche avec suggestions et découverte aléatoire.
- `/races/` : catalogue étendu, recherche par nom français/anglais et alias, filtres de pelage, tri, état vide. Les paramètres `q`, `pelage` et `tri` sont conservés dans l’URL. Recherche locale après 250 ms sans frappe.
- `/race/maine-coon/` (et les quatre autres identifiants de la collection) : présentation, apparence, caractère, anecdote, source et favoris.
- `/favoris/` : carnet persistant dans ce navigateur sous `miaou-club-favorites`. Stockage invalide ignoré ; favoris limités à la session si le stockage est inaccessible.
- `/a-propos/` : présentation, références CFA et crédits des photographies de races.
- `/figue/` : page publique absente de la navigation et des crédits généraux, découverte par recherche « Figue ». Aucun âge actuel inventé.
- `404.html` : page d’erreur. Une URL inconnue est servie en 404 par le serveur de prévisualisation.

Les pages et liens restent lisibles sans JavaScript ; recherche, filtres, hasard, favoris et agrandissement des photos demandent JavaScript. Les dialogues natifs se ferment avec Échap et rendent le focus au bouton. Les suggestions sont des liens accessibles par Tab ou Flèche bas, puis Entrée.

## Modifier le contenu

La collection `breeds` est alimentée par deux API réelles au build :

- **TheCatAPI** (`GET https://api.thecatapi.com/v1/breeds`) fournit la liste des races, le pays, le groupe de pelage, le caractère, la longévité indicative, le poids et les portraits disponibles. La clé `CAT_API_KEY` est lue dans `.env`, envoyée dans l’en-tête `x-api-key` et reste côté build. Aucune variable `PUBLIC_` ni clé dans le HTML ou le JavaScript du site.
- **Wikimedia Commons** (`action=query&prop=imageinfo`) fournit les URL des cinq photos approuvées, leurs dimensions, auteurs et licences. Astro récupère et optimise les images distantes lors de la génération du site.

Le catalogue suit désormais la liste API, sans limite à cinq. `src/data/breed-editorial.json` conserve les cinq fiches initiales, leurs URL et leurs textes CFA. `src/data/breed-localizations.json` contient les noms et présentations françaises résumés des descriptions TheCatAPI pour les autres races. Les nouvelles fiches ne reçoivent pas d’anecdote inventée. Le caractère est traduit via un dictionnaire local. Figue reste un contenu personnel local.

Au 2 octobre 2026 : 95 races, dont 66 avec portrait. Les autres affichent un dessin « Portrait à venir ». Un doublon, les types de chats sans race/polydactylie et les fiches API mal formées sont écartés. Les champs numériques sont contrôlés pour éviter d’afficher les réponses corrompues du fournisseur. Les catégories de pelage et leurs couleurs sont communes aux cartes, fiches, suggestions et filtres dans `src/lib/coats.ts` et `src/styles/global.css`.

Les réponses sont validées avant de créer les entrées de la collection. Le cache `.cache/miaou-api/`, ignoré par Git, conserve les réponses API pendant 24 heures. Si une API tombe en panne, une réponse précédemment validée de moins de sept jours peut servir avec un avertissement explicite. Sans cache valide, le build échoue ; il ne remplace pas les données par des mocks. Pour forcer de nouveaux appels (et refuser le repli sur cache en cas d’erreur) :

```sh
npm run data:refresh
npm run build
```

La documentation d’API est disponible sur [TheCatAPI](https://docs.thecatapi.com/docs/examples/breeds) et [MediaWiki Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo). Le premier build nécessite la clé et une connexion réseau ; les pages construites se consultent ensuite sans appels API côté navigateur. L’option `lang=fr` exige un accès supérieur sur le compte testé : elle n’est pas utilisée et ne génère donc pas d’erreur 403.

Les composants partagés sont dans `src/components/`, le layout dans `src/layouts/`, les styles et tokens dans `src/styles/global.css`. Les interactions sont en TypeScript dans `src/scripts/app.ts`, avec logique de recherche et validation des favoris dans `src/lib/catalog.ts`.

Les copies originales de travail sont conservées dans `src/assets/`. Les photos des races affichées viennent désormais de Wikimedia via les métadonnées API ; celles de Figue restent locales. Astro génère des WebP de 1000 px maximum, sans agrandir les images. Pour remplacer une photo de Figue, remplacer la copie correspondante `figue-cover.jpg`, `figue-guff.jpg` ou `figue-sieste.jpg`, puis reconstruire. Les polices sont locales dans `public/fonts/`. `mockups/` et les photos originales sont conservés.

## Vérification et limites avant publication

Les interactions principales ont été contrôlées dans le navigateur, ainsi que les 11 pages de production à 375, 390, 768 et 1440 px. Les neuf tests ciblés portent sur recherche/filtres/favoris, cache des réponses API, panne et rafraîchissement forcé, validation des données, absence de clé dans le cache et traduction des libellés. Après extension : 101 pages générées et neuf tests réussis. Le catalogue et des fiches représentatives sont contrôlés sur ordinateur et petit mobile. Ce contrôle ne remplace pas un audit exhaustif d’accessibilité sur plusieurs navigateurs.

Domaine, canonicals, sitemap et hébergement Cloudflare restent à décider. Aucun déploiement n’a été effectué. Les références des photos sont affichées avec indication de la conversion WebP. Commons fournit les licences individuelles ; TheCatAPI ne les précise pas dans sa réponse : le site indique cette absence sans inventer d’auteur ou de licence. Le crédit du Maine Coon reste incomplet à la source Commons. Ces points restent à revoir avant publication.

Voir `IMPLEMENTATION.md` pour le périmètre, les décisions et les résultats de vérification.
