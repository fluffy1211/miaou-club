# Miaou Club — cadrage V1

Lecture ciblée : [Comptes](#comptes) · [Abus](#abus) · [Rencontres](#rencontres) · [Photos](#photos) · [Localisation](#localisation) · [Amis](#amis) · [E-mails](#emails) · [Modération](#moderation) · [Export](#export) · [Conservation](#conservation)

Décisions produit des 3–4 octobre 2026. Référence unique des règles de la V1 cible ; état des parcours implémentés et preuves dans NEXT_SESSION. État actuel et choix remplacés : [NEXT_SESSION.md](../NEXT_SESSION.md).

## Produit et expérience — validé

Photographier les chats croisés et créer un carnet de souvenirs Polaroid. Catalogue et favoris de races secondaires. Web app mobile first, installable ; aucun fonctionnement hors connexion demandé pour la V1.
Référence : `mockups/rencontres/index.html`, `app.js`, `styles.css`, `base.css`, `catalogue.js`. Crème, violet, boutons corail, Polaroids, légendes manuscrites et échelle typographique cohérente. Ne pas reprendre le routeur hash ni les simulations comme architecture de production.

- Navigation : Accueil, Carte, Photo, Profil, Carnet.
- Hors connexion : écran d’accès/connexion, sans photos, profils, carte ni catalogue du pilote. Connecté et admis : bienvenue, section personnelle et dernières photos partagées avec le groupe, sans CTA de connexion. Connexion, acceptation des conditions, informations légales/confidentialité et contact nécessaires restent accessibles sans exposer les contenus.
- Photo : deux boutons distincts, « Prendre une photo » et « Choisir dans la galerie », puis description, aperçu et enregistrement. Navigation seule sans ouverture automatique du sélecteur ni demande de permission.
- Décision Gabriel du 4 octobre 2026 : le clic sur « Prendre une photo » déclenche immédiatement l'ouverture de la capture, avec demande d'autorisation caméra à ce moment si le téléphone/navigateur l'exige ; aucune étape intermédiaire dans l'application. Le clic galerie ouvre le sélecteur d'images. Les permissions système déjà accordées/refusées et le comportement navigateur sont à prendre en compte. Cette autorisation caméra est distincte de la géolocalisation.
- Action protégée : connexion sur Profil puis reprise de la destination interne initiale.
- Guide d'installation directement lisible au premier login hors mode application ; report possible et accès depuis paramètres.

<a id="comptes"></a>
## Comptes — validé

- Pilote fermé validé par Gabriel le 4 octobre 2026 : amis majeurs qu’il connaît et invite personnellement ; remplace les inscriptions ouvertes et l’absence de contrôle d’admission. Gabriel sélectionne chaque personne ; invitation destinée à cette personne, pas d’admission automatique par transfert d’un lien. Aucun membre ne peut inviter d’autres personnes de sa propre initiative. Quatre ou cinq personnes reste l’estimation initiale, pas un plafond de comptes. Les protections contre les abus restent applicables.
- Accès aux contenus réservé aux comptes invités, authentifiés et autorisés : accueil, profils, rencontres/photos, carte, catalogue et API correspondantes. Une URL directe ne donne aucun accès supplémentaire. Les droits « privé », masquage et suspension restent applicables à l’intérieur du groupe. La sélection du public n’autorise pas l’administrateur à lire les carnets privés.
- Retrait d’admission : bloquer les futurs accès aux contenus du groupe et l’activité, sans empêcher les droits sur les données personnelles (contact et accès restreint à ses propres données/export/suppression). Mécanisme du lot comptes : ARCHITECTURE ; preuves : NEXT_SESSION. Aucune admission réelle ni invitation envoyée.

- Public admis : inscription réservée aux personnes de 18 ans ou plus pour le moment, validation Gabriel du 4 octobre 2026 ; remplace l’ouverture aux mineurs décidée plus tôt. Case obligatoire, non précochée : « Je déclare avoir 18 ans ou plus et j’accepte les conditions générales d’utilisation. », avec lien accessible vers les CGU. Même exigence avec Google et e-mail/mot de passe ; refus côté serveur sans acceptation, preuve minimale (compte, date, version des CGU/déclaration), sans date de naissance ou pièce d’identité ajoutée par défaut. Déclaration, pas preuve de l’âge ni conformité acquise ; traitement des indices de minorité à examiner dans [JURIDIQUE.md](JURIDIQUE.md#pilote). Le consentement GPS reste séparé. L’admission personnelle au pilote fermé est une condition supplémentaire à cette déclaration.

- Google et e-mail/mot de passe disponibles au lancement (décision Gabriel du 3 octobre 2026, remplace Google uniquement). Apple reste hors V1.
- Décision Gabriel du 4 octobre 2026 : Gabriel autorise préalablement chaque adresse. Aucune vérification obligatoire de l’adresse avant activation ou publication. Le risque qu’un tiers inscrive cette adresse avant la personne invitée est accepté pour ce pilote fermé. E-mail privé.
- Double authentification admin validée le 3 octobre 2026 : code TOTP via application d'authentification, obligatoire avant accès administratif à chaque nouvelle session, avec Google comme e-mail/mot de passe. Pas de code à chaque action ni d'obligation pour les utilisateurs ordinaires en V1. Codes de secours à usage unique ; une réinitialisation du mot de passe ne désactive pas le second facteur. Durées de session et récupération définies ci-dessous.
- Sessions validées le 3 octobre 2026 : connexion ordinaire expirant après 7 jours sans utilisation, plafond absolu 30 jours depuis authentification interactive. Accès admin : 8 heures maximum depuis vérification MFA, verrouillé après 15 minutes sans activité administrative ; accès ordinaire au carnet conservé si sa session reste valide. Liaison des méthodes, changement des moyens de sécurité, export et suppression du compte : preuve de réauthentification de moins de 5 minutes, avec MFA pour l’admin.
- Identifiant public unique, immuable une fois défini ; nom affiché libre et modifiable depuis le profil (décision Gabriel du 4 octobre 2026). Avatar, biographie courte et couleur personnalisables.
- Liaison explicite Google/e-mail validée dès la V1 : depuis les paramètres du compte, ajouter Google après réauthentification du compte existant et preuve de contrôle Google, ou créer un mot de passe sur un compte Google via confirmation par lien e-mail. Conserver le même profil/carnet ; aucune fusion automatique sur adresse identique. Fusion de deux comptes ayant déjà chacun des souvenirs hors V1 ; autres méthodes futures après vérification.
- Utilisateur/admin ; suspendu : accès limité à ses données, motif et suppression du compte. Publication/interactions bloquées, posts publics inaccessibles aux autres.
- Réactivation respecte visibilité initiale et masquages individuels encore actifs.
- Suppression du compte : profil, rencontres et photos supprimés selon la section Conservation et suppression ; mécanisme technique dans [DEVELOPPEMENT.md](DEVELOPPEMENT.md#donnees), copies fournisseurs dans [FOURNISSEURS.md](FOURNISSEURS.md).

### Récupération des comptes ordinaires — validé le 4 octobre 2026

- Mot de passe oublié : lien envoyé à l'adresse du compte, valable 30 minutes et utilisable une seule fois. Après changement, révocation des anciennes sessions et confirmation dans le parcours applicatif, sans e-mail supplémentaire.
- Connexion Google : récupération du compte Google auprès de Google ; une autre méthode déjà liée au même carnet reste utilisable. Aucun rattachement automatique à partir d'une adresse identique.
- Tous les moyens d’accès perdus : contacter Gabriel par un canal déjà connu ; validation personnelle par Gabriel avant récupération. Un simple e-mail reçu, le nom public ou des photos ne suffisent pas. Conserver le compte et le carnet existants, sans fusion avec un autre compte.

Mécanismes et preuves de récupération : DEVELOPPEMENT et NEXT_SESSION. La récupération MFA admin reste soumise à la section suivante.

### Récupération MFA admin — validé le 4 octobre 2026

- TOTP perdu, code de secours disponible : authentification Google ou mot de passe et code de secours, puis configuration d'un nouveau TOTP et renouvellement des codes.
- TOTP et codes tous perdus : récupération manuelle exceptionnelle par un autre admin ou Gabriel comme exploitant. Vérifier par un canal connu à l'avance, avec une nouvelle authentification au compte ; un simple e-mail ne suffit pas. Accès administratif bloqué pendant la récupération.
- Seul admin bloqué : procédure d'exploitation hors interface publique nécessitant l'accès sécurisé à l'hébergement ; aucun bouton public de désactivation du MFA.
- Après récupération : révocation des sessions et anciens moyens de récupération, trace d’audit selon la durée validée, sans e-mail ni notification admin. Accès admin rétabli uniquement après activation et vérification du nouveau TOTP.
- Le carnet reste accessible avec une connexion ordinaire valide ; les actions sensibles exigeant le MFA restent protégées pendant la récupération.

Choix de fonctionnement validé, pas preuve d'intégration. Procédure technique et preuves de contrôle à préparer dans DEVELOPPEMENT.

<a id="abus"></a>
## Protections contre les abus — validé

Base et seuils de départ validés par Gabriel le 3 octobre 2026 ; à ajuster selon l’usage réel. Ces chiffres sont des choix projet, pas des seuils prescrits par OWASP. Contrôles côté serveur ; preuves datées et périmètre réalisé dans NEXT_SESSION.

| Action | Limite initiale |
| --- | --- |
| Connexion par mot de passe | Après 5 échecs en 15 minutes sur une même adresse, attente progressive de 30 secondes à 15 minutes maximum ; protection complémentaire par IP avec tolérance aux réseaux partagés |
| Réinitialisation par e-mail | 1 envoi/minute, 3/heure, 5/jour par destinataire, cumulés entre les parcours ; plafond global adapté au budget fournisseur et état du quota consultable dans l’administration, sans notification admin |
| Upload | 10 tentatives/heure, 30/jour et 600 Mo/jour par compte ; un traitement simultané par compte, en plus des limites par fichier de la section Photos |
| Publication | 30 nouvelles rencontres/jour par compte ; le réessai de la même publication ne crée aucun doublon et ne consomme pas une nouvelle publication |
| Signalement | 5/heure, 20/jour par compte ; un seul dossier ouvert par personne et rencontre ; aucun masquage automatique fondé sur le nombre de signalements |

Limites temporaires par action, récupération automatique et délai de réessai affiché, sans révéler l'existence d'un compte. Aucun verrouillage permanent automatique ; réinitialisation accessible sous ses propres limites, Google utilisable s'il est déjà lié au compte. Le MFA admin reste obligatoire. Récupération admin définie dans la section Comptes. Mécanisme durable et paramètres techniques restant à mesurer : DEVELOPPEMENT.

<a id="rencontres"></a>
## Rencontres — validé

| Champ/action | Règle |
| --- | --- |
| Photo | Une seule ; remplacement impossible après publication |
| Titre | Obligatoire |
| Description | Facultative |
| Date de rencontre | Saisie par l'utilisateur dans le formulaire avec titre/description ; aujourd'hui par défaut, modifiable avant et après publication ; peut précéder la publication de plusieurs jours |
| Date de publication | Date effective de publication, distincte de la date de rencontre ; fixe et non modifiable |
| Visibilité | Public par défaut ; choix public/privé avant publication |
| Modification | Titre, description, date de rencontre et visibilité après publication ; date de publication inchangée |
| Suppression | Auteur autorisé à supprimer sa rencontre |
| Privé | Auteur uniquement, image comprise ; exception administrative liée à un signalement selon la section Modération |
| Public dans le pilote fermé | Partagé avec les membres admis et actifs sur listes/profil/carte ; jamais accessible librement sur Internet ; carte exige un lieu |

Listes partagées : date/auteur, sans localisation. Sans lieu, rencontre dans carnet et surfaces publiques autorisées, pas sur carte. Passer en privé bloque les futurs accès, sans effacer une copie déjà téléchargée.
Distinction des deux dates et modification de la date de rencontre validées par Gabriel le 4 octobre 2026. Identifiant public : règle validée dans la section Comptes.

<a id="photos"></a>
## Photos — validé

- JPEG, PNG et WebP ; HEIC visé, à éprouver sur iPhone. RAW/DNG et photos 200 MP non pris en charge directement en V1.
- Limite par fichier : **30 Mo et 60 millions de pixels**, validée le 3 octobre 2026. Orientation corrigée, métadonnées supprimées, image optimisée et miniature ; original temporaire purgé, réessai possible après échec.
- Photos conservées en stockage privé, y compris celles partagées dans le groupe. Lecture par passerelle backend, droits contrôlés à chaque requête, sans cache navigateur/partagé ni cache PWA des photos. Les changements de visibilité, masquage, suspension et suppression bloquent les nouveaux accès, sans retirer une copie déjà reçue/affichée.
- Pipeline, sources ayant motivé les limites et mesures de ressources/trafic : [ARCHITECTURE.md](ARCHITECTURE.md#photos). Aucun traitement ou accès réel éprouvé.

<a id="localisation"></a>
## Localisation et carte — validé

- Au lancement, localisation/carte limitées à la France métropolitaine continentale, sans Corse ni outre-mer (décision Gabriel du 3 octobre 2026). Rencontres hors périmètre autorisées sans localisation : carnet et surfaces publiques si visibilité/statut le permettent, jamais carte.
- Position ponctuelle du téléphone sur demande ou sélection sur carte ; pas de suivi continu.
- Parcours validé le 4 octobre 2026 : après prise/sélection de photo, sur l'écran description, lieu facultatif et bouton « Utiliser ma position actuelle ». Explication à proximité : position utilisée uniquement pour proposer une zone approximative de cette rencontre, sans suivi. Aucune acquisition à l'ouverture de la page.
- Au clic, demander la permission navigateur si nécessaire, puis acquérir la position une seule fois et proposer la cellule approximative, 1 km par défaut. Aperçu de la zone avant publication ; choix manuel, retrait du lieu ou publication sans lieu possibles. Refus/erreur ne bloquent pas la publication.
- La position actuelle n'est pas nécessairement le lieu d'une photo ancienne ; ne jamais présenter la zone proposée comme le lieu de prise de vue automatiquement établi.
- Consentement contextuel éclairé pour cet usage facultatif : pas de fenêtre applicative supplémentaire si l'explication près du bouton permet un choix suffisamment éclairé ; cette condition doit être vérifiée. Permission technique et consentement RGPD distincts ; une permission déjà accordée ne déclenche aucune acquisition automatique. Retrait du lieu accessible après publication selon les règles ci-dessous.
- Grille de zones fixes : 500 m, 1 km ou 2 km de côté, 1 km par défaut ; aperçu explicite de la zone partagée.
- Seule zone approximative envoyée au backend et conservée ; pas de GPS précis dans notre base/API/logs. Supprimer les métadonnées GPS des photos.
- Conversion position → cellule sur le téléphone avant envoi ; petites cellules emboîtées dans les grandes pour préserver la zone lors d'un élargissement.
- Après publication : élargir ou retirer le lieu, pas réduire la zone. Élargissement contenant la zone précédente.
- Zone/repère représentatif, jamais position exacte. Les dimensions réduisent la précision sans garantir l'anonymat ; photo/texte peuvent révéler un lieu.
- Carte réservée aux membres admis et autorisés, regroupements de rencontres partagées, recherche ville/quartier, ouverture depuis Polaroid et liste alternative si carte indisponible.
- MapLibre GL JS + MapTiler Cloud gratuit pour les essais personnels/non commerciaux : validation Gabriel le 4 octobre 2026. Attributions fournisseur affichées ; résultats de recherche utilisés seulement pour naviguer, sans conservation des résultats. Rencontres et zones conservées dans Miaou Club, sans envoi de ces contenus à MapTiler. Fournisseur remplaçable ; conditions/flux dans [FOURNISSEURS.md](FOURNISSEURS.md), mécanismes carte dans [ARCHITECTURE.md](ARCHITECTURE.md#carte), à vérifier avant ouverture réelle.

<a id="amis"></a>
## Amis — périmètre V1 validé le 4 octobre 2026

- Système d'amis inclus en V1 : demandes entre comptes existants directement dans l'application, acceptation/refus, annulation d'une demande et retrait d'un ami.
- Retrouver les profils et rencontres publiques de ses amis depuis une liste personnelle. L'amitié n'ouvre aucun accès aux rencontres privées ; pas de visibilité « amis ».
- Liste d'amis visible uniquement par son propriétaire ; aucune fonction de blocage des personnes ou de leurs nouvelles demandes en V1 (décision Gabriel du 4 octobre 2026).
- Aucun tchat pour l'instant, aucun e-mail d'invitation à rejoindre Miaou Club.
- Demandes d'amis : 10 nouvelles demandes par heure et 30 par jour par compte ; une seule demande en attente entre deux personnes, sans doublons lors de clics/réessais répétés. Seuils validés le 4 octobre 2026.
- Après refus ou annulation, nouvelle demande possible immédiatement, sous les seuls plafonds globaux ci-dessus ; aucun délai ni limite supplémentaire propre à la même personne. Le destinataire peut accepter ou refuser ; aucune relance automatique.
- Demande d’ami reçue : affichage uniquement dans l’application, aucun e-mail de notification ; décision Gabriel du 4 octobre 2026. Les seuls e-mails automatiques admis sont définis dans la section « E-mails et notifications ».

<a id="emails"></a>
## E-mails et notifications — validé le 4 octobre 2026

- E-mails automatiques limités à la vérification du compte/adresse, aux liens de réinitialisation du mot de passe et à l’avertissement avant suppression d’un compte pour inactivité (exception validée par Gabriel le 4 octobre 2026). Aucun e-mail pour demandes d’amis, activité, signalements ou confirmations supplémentaires de sécurité.
- Le reste des échanges/états du service se consulte dans l’application. Les réponses humaines aux demandes reçues à `contact@miaou.club` restent distinctes de ces e-mails automatiques.
- Administration : aucune notification ni e-mail ; signalements et décisions consultables dans la page admin. Pas de notification après récupération MFA admin ; audit conservé.
- Notifications push sur téléphone pour les utilisateurs, notamment demandes d’amis : reportées à une évolution après V1, selon la préférence de Gabriel du 4 octobre 2026 après évaluation de la charge. V1 : affichage dans l’application seulement. Ne pas ajouter de fournisseur, abonnement ou permission push à ce stade.
- Historique compact des choix remplacés : [reprise](../NEXT_SESSION.md#historique).

<a id="moderation"></a>
## Modération — validé

- Signalements dans l’application réservés aux personnes connectées actives. Notifications externes de contenus illicites : mécanisme hors connexion proposé dans [JURIDIQUE.md](JURIDIQUE.md#moderation), à préparer selon la qualification juridique ; aucune modification du parcours interne validée ici.
- Admin : examiner signalements, masquer/rétablir, suspendre/réactiver ; historique des actions, administrateur/date/motif.
- Accès administratif validé le 3 octobre 2026 : aucun accès courant aux rencontres/carnets privés. Accès au contenu public signalé, même masqué ; si cette rencontre passe ensuite en privé, consultation exceptionnelle limitée au traitement de ce signalement, avec motif obligatoire et journalisation (admin, rencontre/signalement, date, motif). Cette autorisation concerne aussi l'image ; elle ne donne aucun accès général au carnet de l'auteur.
- Rencontre masquée et images inaccessibles aux autres ; auteur voit contenu et motif dans son carnet.
- Visibilité et modération distinctes ; changer texte/visibilité ne lève jamais le masquage.
- Suspension bloque la diffusion sans transformer les posts publics en privés.
- Décision Gabriel du 4 octobre 2026 : aucun système de contestation intégré en V1 (pas de bouton/formulaire ni dossier de contestation). Motifs de modération et audit conservés selon les règles ci-dessus. Avant ouverture, vérifier dans [JURIDIQUE.md](JURIDIQUE.md#moderation) les obligations applicables et l'éligibilité de l'exploitant à l'exemption DSA ; ce choix produit ne supprime aucun droit ou recours légal.

<a id="export"></a>
## Accès et export des données — exigence validée le 4 octobre 2026

Respecter les règles RGPD applicables, en distinguant droit d'accès (article 15) et portabilité (article 20). Le premier porte sur les données personnelles traitées concernant la personne et les informations requises sur leur traitement ; la portabilité porte sur les données fournies, y compris observées, traitées automatiquement sur la base du contrat ou du consentement, dans un format structuré, couramment utilisé et lisible par machine.

- Faciliter l'exercice depuis le compte, y compris suspendu ; prévoir un canal alternatif pour les demandes hors connexion ou non couvertes par l'export automatique. Vérification d'identité proportionnée, sans pièce d'identité systématique ; réauthentification du téléchargement selon la section Comptes.
- Répondre sans retard injustifié et sous un mois ; prolongation de deux mois supplémentaires seulement si justifiée par la complexité/le nombre de demandes, avec information motivée sous le premier mois. Gratuité de principe ; exceptions légales à justifier, pas de facturation ou refus automatique.
- Respecter les droits des tiers ; examiner les données personnelles dans les relations, signalements, décisions de modération et journaux, sans exclusion globale de ces catégories ni divulgation automatique d'informations sur d'autres personnes.
- L'export ne supprime pas le compte. L'expiration technique du fichier/lien prévue ci-dessous ne clôt pas une demande d'exercice des droits et ne doit pas empêcher d'obtenir la copie.

Format validé par Gabriel le 4 octobre 2026 : archive ZIP contenant les données en JSON pour leur réutilisation, des tableaux CSV lisibles dans Excel et les photos encore conservées dans un dossier séparé. Prévoir un complément pour les demandes d'accès non couvertes par cet export. Le ZIP et les formats JSON/CSV sont des choix projet, pas des formats imposés par le RGPD. Schéma des champs, correspondance entre données et photos et inventaire exhaustif à préparer à partir de la cartographie ; inventaire dans [ARCHITECTURE.md](ARCHITECTURE.md#export), références juridiques dans [JURIDIQUE.md](JURIDIQUE.md), preuves techniques dans [DEVELOPPEMENT.md](DEVELOPPEMENT.md#donnees). Aucune conformité démontrée.

<a id="conservation"></a>
## Conservation et suppression — validé

Durées de purge/rétention validées le 3 octobre 2026 (choix de service, pas délais légaux génériques) :

| Catégorie | Durée et finalité |
| --- | --- |
| Compte/rencontre supprimés | Inaccessibles immédiatement ; purge base active/photos/exports sous 7 jours, pour reprendre les échecs de tâches |
| Demandes d’amis refusées/annulées et relations retirées | Suppression immédiate en base active dans la même opération que le refus, l’annulation ou le retrait, sans historique social permanent ; décision Gabriel du 4 octobre 2026. Compteurs anti-abus indépendants et sauvegardes soumis à leurs règles propres |
| Sessions et jetons d’authentification/vérification à usage unique | Suppression immédiate en base active lors d’une déconnexion/révocation pour les sessions ou d’une révocation/utilisation pour les jetons à usage unique ; purge au plus tard 24 h après expiration, avec nettoyage quotidien. Traces de sécurité distinctes, sans jetons ni secrets ; décision Gabriel du 4 octobre 2026 |
| Traces locales d’envoi d’e-mails | 30 jours après chaque tentative, pour diagnostiquer les échecs : type de message, date, destinataire et résultat ; sans copie du contenu ni lien secret. Rétention chez Resend à vérifier séparément ; décision Gabriel du 4 octobre 2026 |
| Original upload | Purge après traitement réussi ; plafond 24 h depuis upload pour les fichiers abandonnés/échoués, sans copier ces originaux dans les sauvegardes |
| Export généré | Lien protégé et fichier expirent sous 24 h après création, pour téléchargement personnel |
| Sauvegardes gérées par le projet | Rotation 30 jours maximum ; accès restreint, restauration avec rejeu des suppressions avant remise en service |
| Audit administration/sécurité | 6 mois, accès restreint et métadonnées nécessaires sans copie des photos/textes, pour détection et analyse d'incidents |

Compléments validés le 3 octobre 2026 :

- Compte sans utilisation authentifiée pendant 24 mois : avertissement par e-mail, puis 30 jours pour revenir ou exporter ; sans retour, suppression selon les délais ci-dessus. Exception aux e-mails automatiques validée par Gabriel le 4 octobre 2026 ; pas d’e-mail supplémentaire de confirmation après suppression.
- Signalement clos : purge du dossier 6 mois après clôture, sans copie conservée de la photo ; les dossiers ouverts doivent être suivis pour éviter une conservation indéfinie.
- Échanges de support et demandes concernant les données personnelles : conservation six mois après clôture, puis suppression ; décision Gabriel du 4 octobre 2026. Conservation exceptionnelle seulement si justification documentée, périmètre limité et durée définie. Couvrir échanges, pièces et traces du dossier chez le projet et vérifier les possibilités/rétentions des prestataires ; pas de pièce justificative conservée plus longtemps que nécessaire. Les dossiers ouverts doivent être suivis, pas conservés indéfiniment sans examen.
- Suspension : statut/motif minimal conservés tant que la mesure reste active, avec réexamen de sa nécessité ; suppression du compte toujours possible selon les règles ci-dessus.

Paramétrage/purge : [DEVELOPPEMENT.md](DEVELOPPEMENT.md#donnees) ; rétentions externes : [FOURNISSEURS.md](FOURNISSEURS.md). Conservations exceptionnelles à justifier par finalité.

## Confidentialité et traitements — orientation validée le 4 octobre 2026

- Exploitant et responsable du traitement retenu pour le projet : Gabriel Martin, en son nom personnel, sans société ni association à ce stade (confirmation du 4 octobre 2026). Identité à reprendre dans la notice ; coordonnées de publication légalement nécessaires à vérifier séparément, sans déduire ni recopier une adresse personnelle depuis le contexte.

- Adresse de contact retenue par Gabriel : `contact@miaou.club`, pour demandes de confidentialité, récupération et suppression de compte. À créer et tester avant affichage comme contact opérationnel ; aucun e-mail ni domaine configuré à ce stade.

- Compte, carnet, publications et amis : exécution du service demandé, uniquement pour les données objectivement nécessaires. Sécurité, prévention des abus et modération : intérêt légitime avec justification et mise en balance des droits. Réponse aux demandes RGPD : obligation légale. Orientation validée ; bases légales à justifier par traitement effectif, pas qualification juridique définitivement établie.
- Aucune publicité, prospection ni analyse comportementale en V1.
- Notice de confidentialité accessible avant inscription et depuis les paramètres : identité/contact du responsable, données/finalités/bases légales, destinataires, transferts, durées et droits. Informations complètes selon les articles applicables, dont caractère obligatoire/facultatif des données et conséquences de leur non-fourniture, réclamation auprès de la CNIL et autres informations requises selon les traitements.
- Accepter les conditions ne rend pas toute collecte nécessaire. Ne pas assimiler permission technique du navigateur et consentement RGPD ; localisation facultative et flux carte à qualifier dans [JURIDIQUE.md](JURIDIQUE.md).

Cartographie et justification : [JURIDIQUE.md](JURIDIQUE.md). Notice/CGU : [TEXTES_UTILISATEURS.md](TEXTES_UTILISATEURS.md), brouillons non publiables. Contrats : [FOURNISSEURS.md](FOURNISSEURS.md). Aucune conformité démontrée.

## Critères avant tests avec amis

Exigence validée par Gabriel le 3 octobre 2026 : respecter le RGPD et appliquer les exigences de sécurité OWASP pertinentes pour la V1. Vérifier protection des données dès la conception, information/droits et mesures serveur avant ouverture réelle ; référentiel, justificatifs et contrôles dans DEVELOPPEMENT. Un choix de fournisseur ou un document ne constitue pas une preuve de conformité.

Photo testée sur vrais téléphones ; refus de permissions/erreurs réseau compréhensibles. Persistance réelle, droits vérifiés sur images/listes/carte/URL directes. Publication sans doublons à la reprise ; suppression et changement de visibilité vérifiés. Admin opérationnel, sauvegardes restaurables et installation testée sur mobiles ciblés.
