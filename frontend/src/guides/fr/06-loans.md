---
id: loans
titleJa: 貸し借り管理
titleEn: Loan Management
titleFr: Gestion des prêts et emprunts
---

# Gestion des prêts et emprunts

Cette application peut gérer les prêts personnels, les emprunts et les crédits séparément des dépenses. L'argent que vous prêtez à quelqu'un est enregistré comme un actif, et l'argent que vous empruntez à quelqu'un est enregistré comme un passif.

Si les prêts ou emprunts sont traités comme des dépenses, la situation réelle devient difficile à voir plus tard lors du remboursement ou du recouvrement. La gestion des prêts vous permet de consulter séparément les montants non recouvrés, les montants impayés et l'historique terminé.

## Court terme vs. long terme

| Type | Utilisation |
| --- | --- |
| Prêt à court terme | Avances temporaires, petits prêts à des amis et éléments similaires |
| Prêt à long terme | Prêts avec une longue période de remboursement, ou prêts où vous souhaitez suivre le solde par contrepartie |
| Emprunt à court terme | Montants temporairement payés en votre nom |
| Emprunt à long terme | Crédits, remboursement échelonné, ou emprunts où vous souhaitez suivre le solde par contrepartie |

Les prêts et emprunts à court terme sont gérés comme des transactions individuelles non résolues, et vous pouvez choisir quelle transaction est soldée lors du remboursement ou du recouvrement. Les prêts et emprunts à long terme sont gérés principalement par le solde du compte.

## Comment saisir

Sur la page Saisie, choisissez Prêt/Remboursement en saisie simplifiée. Il y a quatre directions :

| Direction | Signification |
| --- | --- |
| Emprunter | Vous avez emprunté de l'argent, ou quelqu'un a payé en votre nom |
| Rembourser | Vous avez remboursé de l'argent que vous deviez |
| Prêter | Vous avez prêté de l'argent, ou payé au nom de quelqu'un d'autre |
| Recouvrer | Vous avez reçu de l'argent qui vous était dû |

Pour un emprunt ou un prêt, choisissez le compte de prêt cible et le compte d'actif ou de dépense correspondant. Pour un remboursement ou un recouvrement, sélectionnez la transaction à solder afin que l'application sache quel prêt a été résolu.

## Remboursements ou recouvrements avec écarts

Le montant du remboursement ou du recouvrement peut ne pas correspondre exactement au montant d'origine en raison de frais, remises, écarts de change, arrondis, dons ou raisons similaires.

Dans ce cas, choisissez un compte d'écart pour enregistrer la différence comme un gain ou une perte. Par exemple, recevoir plus que le montant que vous avez prêté est un revenu, tandis que recevoir moins est une dépense.

## Page de gestion des prêts

États financiers -> Gestion des prêts liste les prêts et emprunts. La page est divisée en prêts à court terme, prêts à long terme, emprunts à court terme et emprunts à long terme.

Les éléments à court terme non résolus sont affichés sous forme de cartes. Les éléments à court terme terminés et les éléments à long terme dont le solde a atteint zéro sont stockés dans un accordéon terminé.

Depuis chaque carte, appuyer sur « Saisir à partir d'ici » ouvre le flux de saisie de prêt sur la page Saisie. Pour les prêts ou emprunts à long terme, vous pouvez également forcer un élément à être traité comme terminé lorsqu'il est réellement fini mais difficile à déterminer à partir du seul solde du journal.

## Clôturer un prêt

Un prêt ou emprunt à court terme passe à terminé dès qu'une écriture de remboursement ou de recouvrement est enregistrée. Si le montant correspond exactement à l'original, sélectionnez la transaction cible et soldez-la — c'est tout ce qu'il faut pour la marquer comme terminée.

Un prêt ou emprunt à long terme est automatiquement traité comme terminé lorsque le solde atteint zéro. Si le solde n'atteint pas zéro même si le remboursement est effectivement effectué, utilisez « Forcer la clôture » sur la page Gestion des prêts. Cependant, il est recommandé de d'abord vérifier pourquoi le solde ne correspond pas (par exemple, une écriture manquante ou une erreur de saisie) avant de forcer la clôture.

## Gestion des écarts de remboursement ou de recouvrement

Le montant du remboursement ou du recouvrement peut ne pas correspondre exactement à l'original.

| Cas | Comment gérer |
| --- | --- |
| Reçu plus que ce que vous avez prêté | Enregistrer la différence comme un revenu (par exemple, revenu divers, revenu d'intérêts) |
| Reçu moins que ce que vous avez prêté | Enregistrer la différence comme une dépense (par exemple, perte diverse) |
| Remboursé moins que ce que vous avez emprunté (dette annulée) | Enregistrer la différence comme un revenu (gain d'annulation de dette) |
| Remboursé plus que ce que vous avez emprunté (intérêts ou frais) | Enregistrer la différence comme une dépense (frais d'intérêts, frais) |

Dans tous les cas, l'objectif est de ramener le solde du compte de prêt à zéro. Vous pouvez choisir le compte d'écart dans le formulaire de saisie de prêt sans avoir à construire une écriture multiligne manuellement.

## Gestion des créances irrécouvrables

Lorsqu'une créance ne devrait plus être recouvrée, passez-la en perte comme charge pour créance irrécouvrable.

Étapes :
1. Dans Paramètres, créez un compte de dépenses pour créances irrécouvrables s'il n'en existe pas encore.
2. Utilisez une écriture multiligne pour créditer le compte de prêt (diminuer l'actif) et débiter le compte de créances irrécouvrables (augmenter la dépense).
3. Sur la page Gestion des prêts, utilisez Forcer la clôture pour déplacer l'élément vers terminé.

Si seulement une partie du montant peut être recouvrée, combinez une écriture pour les liquidités effectivement reçues avec une deuxième écriture qui passe le reste en perte comme créance irrécouvrable.

## Comment créer des comptes

Si vous avez de nombreuses avances temporaires, l'utilisation de comptes partagés tels que Prêts à court terme et Emprunts à court terme est souvent plus facile. Si vous souhaitez suivre un solde pour une personne ou un prêt spécifique sur une longue période, créez des comptes à long terme séparés comme « Prêt à A » ou « Prêt immobilier ».

Les prêts et emprunts ne sont pas eux-mêmes des dépenses domestiques. L'argent entre ou sort, mais parce qu'il est censé être rendu ou doit être remboursé, il est traité comme un actif ou un passif. S'il ne sera finalement pas rendu, ou n'a plus besoin d'être remboursé, soldez-le comme une perte/gain ou une perte/gain divers.
