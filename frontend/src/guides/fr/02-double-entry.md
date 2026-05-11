---
id: double-entry
titleJa: 複式簿記とシンプル入力
titleEn: Double-Entry & Simple Input
titleFr: Comptabilité en partie double et saisie simplifiée
---

# Comptabilité en partie double et saisie simplifiée

Toutes les données du journal dans cette application sont stockées sous forme d'écritures de journal en partie double. Dans la comptabilité en partie double, chaque transaction enregistre à la fois « ce qui a augmenté » et « ce qui a diminué ». Cela permet de vérifier ultérieurement les relations entre les actifs, les passifs, la valeur nette, les revenus et les dépenses.

Vous n'avez pas besoin de penser aux débits et crédits pour la saisie quotidienne. Dans la saisie simplifiée, vous choisissez le type de transaction, le montant et le compte correspondant, et l'application crée l'écriture de journal correspondante.

## Écritures créées par la saisie simplifiée

| Type de saisie | Exemple | Ce que l'application fait en interne |
| --- | --- | --- |
| Dépense | Payer de la nourriture depuis un compte bancaire | Augmente la dépense et diminue l'actif de paiement |
| Revenu | Le salaire est déposé sur un compte bancaire | Augmente l'actif et augmente le revenu |
| Transfert | Transférer de l'argent d'un compte d'épargne vers un compte de courtage | Diminue un actif et augmente un autre actif |
| Emprunt | Un ami paie pour vous | Augmente une dépense ou un actif, et augmente un passif |
| Remboursement | Rembourser l'argent emprunté | Diminue un passif et diminue l'actif de paiement |
| Prêt | Prêter de l'argent à quelqu'un | Augmente un actif de prêt et diminue les liquidités/dépôts |
| Recouvrement | Recevoir l'argent qui avait été prêté | Augmente les liquidités/dépôts et diminue l'actif de prêt |

## Pourquoi vous pouvez l'utiliser sans connaître la partie double

La saisie simplifiée demande des informations de la vie réelle. Pour une dépense, vous choisissez sur quoi vous avez dépensé de l'argent et d'où vous avez payé. Pour un revenu, vous choisissez de quel type de revenu il s'agissait et où il a été déposé. L'application détermine les directions de débit et de crédit à partir des types de comptes.

Sur la page Journal, les mêmes écritures de journal peuvent être visualisées en format simplifié et en partie double. Si vous n'êtes pas habitué à la comptabilité, il suffit de consulter la vue simplifiée et d'ouvrir la vue en partie double uniquement lorsque les soldes semblent erronés ou que vous devez traiter une transaction spéciale.

## Quand utiliser les écritures multilignes

Utilisez les écritures multilignes lorsqu'une transaction implique trois comptes ou plus. Les exemples incluent les dépôts avec frais déduits, les transactions qui mélangent des avances professionnelles et des dépenses personnelles, ou les ventes où vous souhaitez enregistrer explicitement un gain ou une perte.

Pour les écritures multilignes, le total des débits et le total des crédits doivent correspondre. Les transactions non équilibrées ne peuvent pas être enregistrées. C'est la règle fondamentale qui maintient la cohérence du journal.

## Règles de débit et de crédit

En comptabilité en partie double, chaque type de compte augmente d'un côté et diminue de l'autre.

| Type de compte | Augmente du côté | Diminue du côté |
| --- | --- | --- |
| Actif | Débit | Crédit |
| Passif | Crédit | Débit |
| Capitaux propres (valeur nette) | Crédit | Débit |
| Revenu | Crédit | Débit |
| Dépense | Débit | Crédit |

Une fois que vous connaissez ce tableau, vous pouvez déterminer vous-même les directions des écritures. Par exemple, « payé pour de la nourriture depuis un compte bancaire » signifie que le compte bancaire est un actif, donc il va du côté crédit. La dépense alimentaire augmente, donc elle va du côté débit. Ensemble, ces deux lignes forment une écriture de journal complète.

## Comment lire les écritures de journal

Sur la page Journal, la vue en partie double montre chaque ligne comme un détail de débit ou de crédit.

| Côté | Signification |
| --- | --- |
| Débit (gauche) | Le compte a augmenté (actif, dépense) ou diminué (passif, capitaux propres, revenu) |
| Crédit (droite) | Le compte a augmenté (passif, capitaux propres, revenu) ou diminué (actif, dépense) |

Dans une écriture de journal, le total des débits doit toujours être égal au total des crédits. Les écritures où ils ne correspondent pas ne peuvent pas être enregistrées.

## Types de comptes et leurs rôles

| Type | Exemples | Description |
| --- | --- | --- |
| Actif | Compte bancaire, liquidités, prêt, crypto | Choses que vous possédez |
| Passif | Carte de crédit, emprunt, dette | Montants que vous devez à autrui |
| Capitaux propres | Solde d'ouverture | Valeur nette (actifs moins passifs) |
| Revenu | Salaire, revenus d'intérêts, gains de vente | Raisons pour lesquelles l'argent augmente |
| Dépense | Alimentation, services publics, amortissement | Raisons pour lesquelles l'argent diminue |

Les capitaux propres sont calculés comme les actifs moins les passifs, ils sont donc rarement saisis directement. La saisie du solde d'ouverture en est la principale utilisation.

## Notes lors de l'édition

Vous pouvez modifier les écritures de journal depuis la page Journal. Les écritures créées via la saisie simplifiée peuvent être reconverties au format de saisie d'origine lorsque c'est possible. Les écritures d'amortissement mensuelles et les écritures qui incluent des comptes système spéciaux peuvent perturber les calculs associés si elles sont modifiées directement. Dans ces cas, il est plus sûr de modifier la source de saisie ou les paramètres à la place.

Lorsque les soldes ne correspondent pas, vérifiez la différence par rapport aux soldes réels sur la page Balance de vérification avant de supprimer des écritures basées sur des suppositions. Corriger les écritures après avoir identifié la cause facilite la compréhension de l'impact sur les budgets et les rapports.
