---
id: budget
titleJa: 予算システム（仮想バケット）
titleEn: Budget System (Virtual Buckets)
titleFr: Système budgétaire (Buckets virtuels)
---

# Système budgétaire (Buckets virtuels)

Les catégories budgétaires sont des buckets virtuels superposés aux comptes bancaires et de liquidités réels. Le solde réel du compte reste là où il est, tandis que le système budgétaire divise cet argent par objectif, comme les dépenses libres, les dépenses obligatoires, les fonds de voyage ou les réserves d'investissement.

## Concepts clés

| Élément | Rôle |
| --- | --- |
| Compte | Élément réel du journal, comme un compte bancaire, une carte, un salaire ou une dépense alimentaire |
| Catégorie budgétaire | Bucket virtuel basé sur un objectif pour les liquidités/dépôts |
| Comptes de dépenses liés | Déterminent quel budget est consommé par les écritures de dépenses |
| Comptes de détention cibles | Décrivent où vous avez l'intention de garder l'argent pour un budget |

Créez des catégories depuis Paramètres -> Paramètres budgétaires. Une catégorie peut avoir un groupe, un solde objectif, un plafond de solde, une destination de débordement, des comptes de dépenses liés et des comptes de détention cibles.

## Report, réinitialisation et plafonds

Les budgets réguliers sont reportés intégralement, qu'ils soient positifs ou négatifs. Un budget négatif est un dépassement, il réduit donc l'argent allouable au lieu de l'augmenter.

Si des importations historiques ou des corrections rendent un solde irréaliste, utilisez Saisie -> Ajustement budgétaire -> Réinitialisation budgétaire pour ramener cette catégorie à zéro. La page Aperçu montre un badge de réinitialisation daté pour le mois. Les plafonds de solde peuvent envoyer l'excédent budgétaire vers une autre catégorie.

## Distribution des revenus et ajustements

Les écritures de revenu peuvent appliquer un filtre budgétaire pour distribuer le dépôt entre les catégories. Les filtres utilisent des étapes fixes, plafonnées et de répartition proportionnelle. Des ajustements budgétaires manuels peuvent ensuite augmenter ou diminuer des catégories individuelles et peuvent inclure un commentaire facultatif.

## Placement budgétaire

Les comptes bancaires/de liquidités ont un paramètre « inclure dans la source budgétaire allouable ». Seuls les comptes activés comptent comme liquidités allouables et comme soldes réels dans le placement budgétaire.

Le tableau de placement budgétaire apparaît dans Paramètres -> Paramètres budgétaires et États financiers -> Balance de vérification -> Vérification de cohérence budgétaire.

| Affichage | Signification |
| --- | --- |
| Cible | Solde budgétaire prévu pour le groupe de comptes |
| Réel | Solde réel en liquidités/bancaire pour les comptes cibles |
| Différence | Réel - Cible |

Si un budget est lié à plusieurs comptes, ou si plusieurs budgets sont liés à un seul compte, les budgets et comptes associés sont fusionnés en un seul groupe. Lorsqu'il existe des différences, des indices montrent combien déplacer entre les groupes de comptes, ou combien de budget ajouter ou réduire.

## Transferts et mouvement budgétaire

Lors de la saisie d'un transfert de compte en saisie simplifiée, vous pouvez éventuellement déplacer le budget en même temps. Choisissez une catégorie budgétaire source et de destination pour enregistrer un transfert budgétaire, ou laissez la destination vide pour consommer/faire disparaître le budget, par exemple lors d'un investissement de l'argent réservé.

Le transfert réel et le mouvement budgétaire sont des événements séparés. Les liens budget-compte sont des indications de placement ; ils ne forcent pas l'allocation des revenus et les virements bancaires à se produire en même temps.

## Cohérence budgétaire

Balance de vérification -> Vérification de cohérence budgétaire détecte les écarts entre les montants des écritures de journal et les montants d'allocation budgétaire enregistrés. Pour les écritures multilignes et les transactions hors suivi budgétaire, l'application ne devine pas les catégories budgétaires à moins que des allocations explicites ne soient enregistrées.
