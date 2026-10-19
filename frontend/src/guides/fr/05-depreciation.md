---
id: depreciation
titleJa: 予算分割振替
titleEn: Budget installment transfers
titleFr: Transferts budgétaires échelonnés
---

# Transferts budgétaires échelonnés

Cette fonctionnalité répartit le coût d'un achat en dépenses mensuelles et gère son impact sur le budget dans le temps. Lors de l'achat, le montant est d'abord enregistré dans le « Compte d'actif d'achat » choisi, puis transféré vers le « Compte de dépenses » sur la période définie. Le solde restant du compte d'actif d'achat représente le montant du plan qui n'a pas encore été passé en charges ; il ne représente pas la valeur marchande de l'achat ni sa valeur fiscale.

Par exemple, le coût d'un ordinateur de 120 000 yens réparti sur 12 mois est passé du compte d'actif d'achat au compte de dépenses à raison d'environ 10 000 yens par mois. Si le complément budgétaire mensuel est activé, des fonds sont également transférés chaque mois des catégories budgétaires habituelles vers le budget d'achat.

## Méthodes budgétaires

| Méthode | Traitement du budget à l'achat et chaque mois |
| --- | --- |
| Budget affecté | Le budget d'achat choisi est diminué au moment de l'achat. Chaque mois, il est alimenté par des transferts depuis les sources budgétaires configurées en pourcentage. |
| Budget spécial | Un budget spécial dédié commence avec un solde négatif. Chaque mois, il est alimenté par des transferts depuis les sources budgétaires configurées. |
| Non réparti | La part de l'achat prise en compte dans le budget est couverte par les fonds non affectés au moment de l'achat. Les écritures de dépenses mensuelles continuent, mais aucun complément budgétaire mensuel n'est effectué. |

## Saisie et proportions budgétaires

Sur la page Saisie, activez « Transferts budgétaires échelonnés », sélectionnez le « Compte d'actif d'achat » et le « Compte de dépenses », puis définissez la période avec « Mois de transfert » ou « Montant mensuel du transfert ». Pour les méthodes avec complément budgétaire mensuel, l'éditeur « Parts budgétaires » reprend initialement les proportions budgétaires du compte de dépenses. Chaque plan enregistré conserve un instantané de ses parts ; les changements ultérieurs du compte de dépenses ne modifient pas les plans existants.

Modifiez directement la part de chaque catégorie budgétaire ou ajustez-la en saisissant un montant pour le mois représentatif affiché dans l'éditeur. La saisie d'un montant définit sa part en fonction de ce transfert représentatif ; les transferts réels peuvent varier selon le mois, par exemple lorsque le premier mois est proratisé. « Rétablir les valeurs par défaut du compte de dépenses » recharge les proportions budgétaires actuelles de ce compte.

Si la somme des parts des catégories nommées est inférieure à 100 %, le reste est considéré comme un transfert depuis les fonds non affectés et l'enregistrement exige une confirmation explicite. Une somme supérieure à 100 % ne peut pas être enregistrée. Les transferts depuis les fonds non affectés réduisent ces fonds tout en alimentant le budget d'achat.

Les restes sont répartis à l'unité monétaire minimale selon la méthode des plus forts restes. Les égalités sont départagées par identifiant de catégorie budgétaire croissant et les fonds non affectés sont traités en dernier. Pour chaque mois, le total des sources budgétaires correspond au montant versé au budget d'achat.

## Modification et suppression

La modification de l'achat ou des paramètres du plan peut affecter les écritures de dépenses mensuelles et les compléments budgétaires. Effectuez les changements depuis la saisie d'achat d'origine ou les paramètres du plan ; ne modifiez pas directement les écritures mensuelles ni les enregistrements budgétaires générés. Supprimez le plan associé lorsqu'il n'est plus nécessaire.

## Différence avec l'amortissement

Cette fonctionnalité répartit le coût d'un achat en dépenses mensuelles pour la gestion du foyer et gère son impact budgétaire mensuel par des transferts entre catégories budgétaires. Le solde restant dans le compte d'actif d'achat représente le montant du plan qui n'a pas encore été passé en charges. La fonctionnalité ne détermine pas la valeur marchande de l'actif, sa durée d'utilité, la méthode d'amortissement, le taux d'utilisation professionnelle ou le traitement fiscal. Gérez séparément tout traitement comptable ou fiscal formel selon les règles applicables.