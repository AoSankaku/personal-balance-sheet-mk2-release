---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
titleFr: Gestion multidevise
---

# Gestion multidevise

Cette application permet de basculer entre les devises activées dans les paramètres de devises. La devise est enregistrée sur chaque ligne d'écriture, ce qui permet de gérer séparément les soldes en devises étrangères et en cryptomonnaies.

## Concept clé

Le sélecteur de devise en haut de l'écran choisit la devise utilisée pour la saisie et l'affichage. Par exemple, si vous sélectionnez USD et enregistrez un dépôt de 1 000 sur un compte bancaire en USD, l'écriture est sauvegardée en USD.

Un compte n'est pas limité à une seule devise. Vous pouvez conserver plusieurs soldes en devises dans le même compte ou créer des comptes distincts par devise et par usage. Lorsqu'une séparation claire est importante, utilisez des comptes dédiés tels que « Compte bancaire USD » et « BTC - Quotidien ».

## Commencer à utiliser une devise étrangère

1. Activez la devise voulue, par exemple USD ou EUR, dans les paramètres de devises.
2. Sélectionnez-la avec le sélecteur de devise en haut de l'écran.
3. Si vous souhaitez séparer son solde par usage, créez un compte dédié.
4. Utilisez le formulaire de solde d'ouverture pour enregistrer le solde actuel dans la devise sélectionnée.

## Enregistrer des transactions en devises étrangères

Les dépôts et retraits en devises étrangères sont saisis de la même manière que les écritures normales. Saisissez le montant dans la devise étrangère.

| Exemple de transaction | Comment saisir |
| --- | --- |
| Déposer 1 000 USD sur un compte USD | Sélectionner le compte USD comme cible de revenu, saisir 1 000 |
| Payer une dépense de 100 USD depuis un compte USD | Sélectionner le compte USD comme source de dépense, saisir 100 |
| Convertir un compte USD en compte JPY | Utiliser une écriture multiligne entre les deux comptes |

## Écriture de journal de conversion de devises

Lors de la conversion entre un compte JPY et un compte en devise étrangère, utilisez une écriture multiligne.

**Exemple : Convertir 1 000 USD (acquis à 150 JPY/USD) pour 145 000 JPY**

| Débit | Crédit |
| --- | --- |
| Compte bancaire (JPY) 145 000 | Compte USD 1 000 (base de coût 150 000 JPY équivalent) |
| Perte de change 5 000 | |

La différence entre le taux d'acquisition et le taux de conversion devient un gain ou une perte de change, qui est enregistré(e) comme revenu ou dépense.

Cette application prend en charge les écritures de change qui permettent un écart de montant débit/crédit (`is_currency_exchange`). Dans le formulaire de saisie multiligne, enregistrer des écritures en tant que change vous permet d'enregistrer des combinaisons de montants dans différentes devises.

## Affichage dans les états financiers

Les états financiers affichent normalement uniquement les soldes dans la devise choisie avec le sélecteur. Lorsque l'option Inclure toutes les devises est activée, les autres soldes sont convertis dans la devise d'affichage avec les taux configurés dans les paramètres de devises, puis inclus dans les totaux.

Les valeurs converties varient selon la source des prix et l'heure de récupération. Le livre conserve les quantités dans leur devise d'origine ; la conversion d'affichage ne modifie jamais les écritures.

## Ajouter ou supprimer une devise

L'ajout d'une devise n'affecte ni les comptes ni les écritures existants. Une devise qui présente encore un solde ne peut pas être désactivée ; si elle n'est plus nécessaire, ramenez d'abord son solde à zéro par des transferts ou des écritures de change.

## Actifs cryptographiques et devise

Les actifs cryptographiques prennent en charge deux modèles d'utilisation.

- Pour les paiements quotidiens, activez BTC ou une autre cryptomonnaie dans les paramètres de devises, sélectionnez-la avec le sélecteur, puis enregistrez les revenus, dépenses et transferts ordinaires. Créez un compte de liquidités tel que « BTC - Quotidien » si vous souhaitez isoler ce solde.
- Pour l'investissement ou la spéculation, créez un compte tel que « BTC - Investissement » dans la catégorie d'actifs crypto et enregistrez les achats, ventes, récompenses et frais comme des opérations d'investissement.

Vous pouvez détenir le même BTC pour les deux usages. Des comptes séparés gardent les soldes distincts même si le code de devise est identique, et le rapprochement compare chaque compte indépendamment. Les comptes d'investissement peuvent récupérer le solde réel du portefeuille ; chaque compte, y compris ceux d'usage quotidien, permet aussi une saisie manuelle. Consultez le guide de Rapprochement des soldes cryptographiques.
