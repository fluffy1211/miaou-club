# Miaou Club

Un petit club privé pour photographier les chats croisés en chemin et les partager entre amis : carnet de rencontres, carte par zones approximatives, amis et profil. Astro 7 avec îlots React, serveur Node, PostgreSQL et Better Auth.

## Lancer

Node.js selon `.node-version`, puis :

```sh
npm ci
cp .env.example .env
npm run db:up && npm run db:migrate
npm run dev
```

Commandes de contrôle, Docker et E2E : [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md#ci). Règles produit : [docs/CADRAGE.md](docs/CADRAGE.md). Architecture : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Figue

`/figue` est la page de Figue, le chat de Gabriel, réservée aux membres et absente de la navigation. On la trouve en cherchant « figue » dans la recherche d’amis, ou en cliquant le petit chat de la page 404. À l’ouverture, une animation (Motion) et des confettis (canvas-confetti) l’accueillent ; le bouton « Lancer son jouet » relance la fête. Les animations sont coupées si le système demande moins de mouvement. Ses photos sont dans `src/assets/figue-*.jpg` ; Astro les convertit en WebP de 1000 px maximum au build.

Le catalogue des races de la première version a été retiré le 26 octobre 2026 : le site est centré sur les photos de chats prises par les membres.
