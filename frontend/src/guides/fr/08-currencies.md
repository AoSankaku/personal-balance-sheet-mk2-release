---
id: currencies
titleJa: 複数通貨の扱い
titleEn: Multi-Currency Handling
titleFr: Gestion multidevise
---

# Gestion multidevise

Cette application prend en charge plusieurs devises. Vous pouvez définir une devise pour chaque compte, afin que les comptes bancaires en devises étrangères et les actifs en devises étrangères puissent être inclus dans le journal.

## Concept clé

Chaque écriture de journal est enregistrée par devise. Par exemple, un dépôt de 1 000 USD sur un compte bancaire en USD est enregistré en USD. L'application ne récupère pas automatiquement les taux de change. Lors de l'enregistrement de transactions en devises étrangères, saisissez le montant en devise étrangère directement. Pour voir un total converti dans les états financiers, saisissez une écriture de conversion manuellement.

## Créer un compte en devise étrangère

1. Dans Paramètres, créez un nouveau compte.
2. Définissez la devise du compte sur la devise cible, par exemple USD ou EUR.
3. Saisissez le solde d'ouverture dans la devise étrangère en utilisant le formulaire de solde d'ouverture.

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

Dans les totaux des états financiers, les soldes dans différentes devises sont affichés comme des nombres simples côte à côte. Par exemple, si vous avez 100 000 JPY sur un compte JPY et 500 USD sur un compte USD, le total des actifs affiche un nombre combiné de 100 000 + 500.

Lorsque les devises sont mélangées, traitez les totaux comme des valeurs de référence uniquement. Pour un total précis, vérifiez les soldes convertis manuellement ou consolidez en une seule devise en saisissant des écritures de journal de conversion.

## Modifier une devise

La devise d'un compte qui a déjà des écritures de journal ne peut pas être modifiée. Si la devise a été mal définie, utilisez la fonctionnalité d'édition et remplacement en masse pour déplacer les écritures de journal vers un compte différent, puis supprimez le compte d'origine.

L'ajout d'une nouvelle devise (par exemple, l'ouverture d'un nouveau compte en EUR) nécessite uniquement la création d'un nouveau compte défini sur EUR. Les comptes existants et les écritures de journal ne sont pas affectés.

## Actifs cryptographiques et devise

Les actifs cryptographiques tels que BTC, ETH et SOL sont également traités comme un type de devise étrangère. Créez un compte dans la catégorie crypto et définissez la devise sur BTC ou similaire. Les écritures de journal sont ensuite enregistrées dans cette unité cryptographique.

Pour vérifier la valeur équivalente en JPY, utilisez la Surveillance des actifs cryptographiques pour récupérer les prix depuis des sources externes et multiplier par la quantité détenue. Consultez le guide de Surveillance des actifs cryptographiques pour plus de détails.
