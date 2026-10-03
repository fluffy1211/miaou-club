# Miaou Club — maquette HTML

Prototype de design local pour valider les pages, les composants et les interactions avant le développement du site Astro. Aucun backend ni déploiement.

## Ouvrir

Depuis ce dossier : `python3 -m http.server 4173 --bind 127.0.0.1`

Puis ouvrir http://127.0.0.1:4173.

## Pages et états

- `#/` : accueil, suggestions de recherche et découverte aléatoire.
- `#/races` : catalogue, filtres de pelage et tri alphabétique.
- `#/race/maine-coon` : exemple de fiche ; les cinq races ont une fiche.
- `#/favoris` : carnet vide ou rempli, enregistré dans ce navigateur.
- `#/a-propos` : présentation, sources et crédits des photos.
- `#/figue` : carnet secret, absent de la navigation ; accessible en recherchant Figue.
- `#/design-system` : palette, typographies et composants ; page de travail absente de la navigation.
- Toute route inconnue montre une page introuvable.

Les photos s’agrandissent dans une boîte de dialogue. Les mises en page s’adaptent à l’ordinateur, la tablette et au téléphone. Les états de focus et les mouvements réduits sont pris en compte.

## Contenu de Figue

Informations fournies par Gabriel : 6 mois au 1er octobre 2026, petit chat noir très intelligent ; surnoms « Figue le chat figue », « Figolu », « Guff » ; rapporte son jouet et aime son hamac. La date de naissance exacte n’est pas connue ; l’âge n’est pas recalculé automatiquement dans cette maquette.

Copies de travail des photos de `/Users/gabriel/Downloads/Gmail` dans `assets/figue-*.jpg`. Les originaux sont conservés. Les trois fichiers peuvent être remplacés indépendamment de la mise en page.

## Fondations

Papier `#FFF8ED`, violet `#49366D`, corail `#F47C67`, jaune `#F4D978`, menthe `#BCDCCB`, lilas `#E2D8F0`. Titres Fredoka ; lecture DM Sans ; annotations Caveat. Variables et composants communs dans `styles.css`.

Les textes de race sont des résumés courts de la Cat Fanciers’ Association, avec liens sur chaque fiche. Les photographies de races proviennent de Wikimedia Commons ; références et licences dans `assets/image-sources.json`. Polices Google Fonts conservées localement pour la maquette. Les images sont réduites pour l’affichage et créditées sur la page Sources.

Ce prototype valide le design et les interactions : le catalogue exhaustif, la rédaction complète, les métadonnées SEO, les URL définitives et la transposition en composants Astro restent à préparer après validation.
