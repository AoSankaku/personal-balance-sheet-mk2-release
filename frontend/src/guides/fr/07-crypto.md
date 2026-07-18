---
id: crypto
titleJa: 暗号資産の残高照合
titleEn: Crypto Balance Reconciliation
titleFr: Rapprochement des soldes cryptographiques
---

# Rapprochement des soldes cryptographiques

Le rapprochement lie les adresses de portefeuille aux comptes d'actifs cryptographiques afin de comparer le solde réel au solde comptable. Gérez-le depuis États financiers -> Rapprochement des soldes.

Seules les quantités détenues sont récupérées sur la chaîne pour le rapprochement. Les valeurs de marché et les gains ou pertes latents ne sont pas récupérés, et les soldes comptables des états financiers ne sont jamais remplacés.

## Deux façons d'utiliser les actifs cryptographiques

La catégorie crypto d'un compte et sa devise ont des rôles différents. La catégorie indique pourquoi l'actif est détenu, tandis que la devise indique l'unité utilisée dans les écritures comptables.

| Modèle d'utilisation | Exemple de configuration | Utilisation principale |
| --- | --- | --- |
| Investissement ou spéculation | Créer un compte « BTC - Investissement » dans la catégorie d'actifs crypto | Le tenir à l'écart des dépenses quotidiennes et enregistrer les achats, ventes, transferts, récompenses et frais comme des opérations d'investissement. Un portefeuille peut être lié pour récupérer le solde réel |
| Devise de paiement quotidienne | Activer BTC dans les paramètres de devises et, si utile, créer un compte de liquidités tel que « BTC - Quotidien » | Sélectionner BTC avec le sélecteur de devise et enregistrer les revenus, dépenses et transferts ordinaires en BTC |

Les deux modèles peuvent être utilisés ensemble. Par exemple, des comptes distincts « BTC - Quotidien » et « BTC - Investissement » permettent de gérer par objectif les soldes de la même devise BTC. Le rapprochement les compare par compte au lieu de les regrouper uniquement par code de devise.

Les soldes de portefeuille sont récupérés explicitement uniquement pour les comptes de la catégorie crypto lorsque la cryptomonnaie correspondante, telle que BTC, est sélectionnée dans l'en-tête. Une actualisation normale de la page ne les récupère pas. Vous pouvez toujours saisir manuellement le solde réel de chaque compte, y compris les comptes d'usage quotidien, et la récupération ne remplace pas une valeur modifiée manuellement.

## Principaux types pris en charge

| Type | Contenu |
| --- | --- |
| BTC | Solde d'une adresse Bitcoin |
| ETH | Solde d'une adresse Ethereum |
| SOL | Solde SOL d'un portefeuille Solana |
| SKR | Solde SKR sur une adresse de la famille Solana |
| mSOL | Solde équivalent SOL mis en jeu via Marinade |
| SOL Stake | Solde d'un compte de mise en jeu natif Solana |

L'intégration Binance est actuellement désactivée. Si vous souhaitez gérer les soldes d'échange, créez des comptes d'actifs cryptographiques et gérez-les avec des écritures de journal manuelles ou des vérifications de solde réel selon vos besoins.

## Ajouter un portefeuille

1. Dans Paramètres, créez un compte d'actif dans la catégorie crypto.
2. Sélectionnez la cryptomonnaie cible dans l'en-tête, ouvrez États financiers -> Rapprochement des soldes, puis choisissez Saisie du solde réel.
3. Ajoutez un portefeuille, puis choisissez la chaîne, l'adresse et le compte lié.
4. Utilisez Récupérer et appliquer pour saisir la quantité disponible comme solde réel.
5. Enregistrez l'instantané, puis examinez les écarts avec le solde comptable.

En général, un compte est lié à un seul paramètre de portefeuille. Même avec la même adresse Solana, vous pouvez souhaiter traiter SOL, SKR, mSOL et les actifs similaires séparément, donc créez des comptes séparés si nécessaire.

## Comment les devises sont gérées

Les états financiers convertissent le solde comptable avec les prix disponibles afin d'afficher son équivalent dans la devise d'affichage. Les prix proviennent de sources externes et peuvent être actualisés.

La quantité récupérée du portefeuille reste dans sa devise d'origine et sert uniquement de solde réel pour le rapprochement ; elle ne remplace pas les montants issus des écritures de journal.

## Relation avec les écritures de journal

Le rapprochement sert à vérifier la quantité détenue par rapport au livre comptable. Il ne journalise pas automatiquement chaque achat, vente, échange, transfert, frais, gain réalisé ou perte réalisée.

Lorsque vous achetez des actifs cryptographiques, vous avez toujours besoin d'une écriture de journal qui diminue l'actif de paiement et augmente le compte d'actif cryptographique. Lorsque vous vendez, enregistrez l'augmentation des liquidités/dépôts, la diminution des actifs cryptographiques, et le gain ou la perte si nécessaire.

## Notes pour les actifs de la famille Solana

SOL, SKR, mSOL et SOL Stake peuvent utiliser des formats d'adresse similaires. La détection automatique peut ne pas les distinguer correctement, donc choisissez explicitement la chaîne lorsque c'est nécessaire.

Marinade mSOL et les comptes de mise en jeu natifs utilisent des méthodes de récupération de solde différentes des soldes de portefeuille normaux. Si la récupération de solde échoue, vérifiez si le type d'adresse est correct et si la cible est une adresse de portefeuille ou une adresse de compte de mise en jeu.

## Gestion des actions et valeurs mobilières

Les actions, fonds communs de placement et valeurs mobilières similaires sont gérés en créant un compte dans la catégorie investissement des actifs. Le solde est calculé à partir des écritures de journal.

### Écriture de journal d'achat

Utilisez une écriture multiligne lors de l'achat d'actions.

| Débit | Crédit |
| --- | --- |
| Compte d'investissement (actions détenues) | Compte de paiement (liquidités/dépôts) |
| Frais d'achat (dépense, si applicable) | |

Noter le prix d'achat ou la base de coût dans le champ de description aidera pour le calcul des profits/pertes ultérieurement.

### Écriture de journal de vente

Une vente génère un gain réalisé si le prix de vente dépasse la base de coût, ou une perte réalisée s'il est inférieur.

**Vente avec un gain :**

| Débit | Crédit |
| --- | --- |
| Compte de réception (liquidités/dépôts) | Compte d'investissement (actions détenues) |
| | Gain sur vente de valeurs mobilières |

**Vente avec une perte :**

| Débit | Crédit |
| --- | --- |
| Compte de réception (liquidités/dépôts) | Compte d'investissement (actions détenues) |
| Perte sur vente de valeurs mobilières | |

« Gain sur vente de valeurs mobilières » et « Perte sur vente de valeurs mobilières » sont disponibles comme comptes système.

## Enregistrement des transactions d'actifs cryptographiques

Les ventes d'actifs cryptographiques suivent la même logique que les valeurs mobilières.

| Type | Compte système à utiliser |
| --- | --- |
| Gain de vente | Gain sur vente d'actifs cryptographiques |
| Perte de vente | Perte sur vente d'actifs cryptographiques |

Le rapprochement sert à vérifier les avoirs par rapport au livre comptable. Il ne journalise pas automatiquement les achats, ventes, échanges ou transferts. Enregistrez les transactions réelles séparément comme des écritures de journal multilignes.

### Différence entre solde réel et solde comptable

L'écran de rapprochement affiche séparément le solde réel récupéré et le solde calculé à partir des écritures. En cas d'écart, vérifiez l'historique du portefeuille et enregistrez les écritures manquantes ; la récupération du solde ne modifie pas le livre comptable.

Pour les actions, il n'y a pas non plus de réévaluation mensuelle automatique. La base de coût reste dans le journal et le profit ou la perte réel(le) est enregistré(e) au moment de la vente.

## Notes sur les finances personnelles

Les prix de marché des cryptomonnaies peuvent changer radicalement. Les conversions affichées dans l'Aperçu et les états financiers sont des estimations pour comprendre la valeur nette actuelle du ménage. Elles ne remplacent pas la base de coût fiscal, le calcul des profits/pertes, la moyenne mobile, la moyenne totale ni le traitement des frais.

Après des transactions importantes, vérifiez séparément les écritures de journal par rapport à l'historique de l'échange et du portefeuille.
