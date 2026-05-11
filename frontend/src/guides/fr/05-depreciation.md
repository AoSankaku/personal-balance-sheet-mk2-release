---
id: depreciation
titleJa: 擬似的な減価償却と予算分散
titleEn: Pseudo-Depreciation & Budget Spreading
titleFr: Pseudo-amortissement et lissage budgétaire
---

# Pseudo-amortissement et lissage budgétaire

L'amortissement dans cette application n'est pas destiné à la déclaration fiscale ou à la comptabilité d'entreprise formelle. C'est une fonctionnalité de finances personnelles pour répartir le poids d'un achat important sur plusieurs mois.

Par exemple, si vous achetez un appareil à 120 000 yens en janvier, un journal domestique normal montrerait une grosse dépense en janvier. En pratique, vous pouvez préférer le considérer comme une consommation de 10 000 yens par mois sur un an. Le pseudo-amortissement est fait pour cette situation.

## Ce qui se produit

Lorsque vous activez l'amortissement lors de la saisie d'une dépense, l'application crée deux types d'enregistrements :

| Enregistrement | Contenu |
| --- | --- |
| Enregistrement d'achat | Diminue l'actif de paiement et augmente l'actif amortissable |
| Enregistrements mensuels | Diminue progressivement l'actif et enregistre une dépense chaque mois |

Les liquidités diminuent au moment de l'achat, mais l'effet sur les dépenses et les budgets est réparti par mois. Dans le bilan, la partie non encore passée en charges reste en tant qu'actif.

## Configuration avant utilisation

1. Dans Paramètres, créez le compte d'actif que vous souhaitez amortir.
2. Activez l'amortissement pour ce compte d'actif.
3. Préparez un compte de dépenses à utiliser pour la charge d'amortissement.
4. Lors de la saisie d'une dépense sur la page Saisie, activez l'amortissement.

En saisie par période, spécifiez sur combien de mois le montant total doit être réparti. En saisie par montant mensuel, spécifiez quel montant doit être passé en charges chaque mois. Si un arrondi est nécessaire, les montants mensuels sont ajustés pour que le total corresponde toujours.

## Effet sur les budgets

Avec une dépense normale, le budget est consommé dans le mois du paiement. Avec l'amortissement, l'impact budgétaire apparaît comme une charge d'amortissement mensuelle.

Cela permet de lisser les gros achats annuels ou les fournitures utilisées pendant plusieurs mois dans le cadre des coûts de subsistance mensuels. L'objectif est de séparer le mois de paiement de la période d'utilisation d'une manière qui corresponde à la façon dont le ménage ressent réellement le coût.

## Dépenses appropriées

| Éléments appropriés | Raison |
| --- | --- |
| Appareils électroménagers, meubles, PC, smartphones | Utilisés sur plusieurs mois ou années |
| Abonnements annuels | Effectivement utilisés chaque mois |
| Équipement de loisir ou de travail coûteux | Évite de fausser le budget uniquement dans le mois d'achat |
| Dépenses ponctuelles pour améliorer le mode de vie | Les bénéfices s'étendent sur plusieurs mois |

Pour l'alimentation, les biens courants et autres articles consommés dans le même mois, utilisez la saisie de dépense normale.

## Notes sur l'édition et la suppression

Lorsque vous modifiez l'écriture d'achat qui a créé l'amortissement, les écritures d'amortissement mensuelles sont recalculées. Modifier uniquement une écriture mensuelle peut la rendre incohérente avec le calendrier global.

Si vous devez modifier les détails, éditez à partir de l'écriture d'achat d'origine lorsque c'est possible. Si elle n'est plus nécessaire, supprimez le plan d'amortissement associé et ressaisissez-la comme une dépense normale si nécessaire.

## Différence avec l'amortissement fiscal

Cette fonctionnalité est un pseudo-lissage de dépenses pour la gestion domestique. Elle ne détermine pas automatiquement la durée d'utilité, la méthode d'amortissement, le taux d'utilisation professionnelle ou le traitement fiscal. Les actifs qui nécessitent un traitement fiscal doivent être gérés séparément selon les règles comptables et fiscales formelles.
