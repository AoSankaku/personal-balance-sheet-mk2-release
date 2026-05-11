---
id: crypto
titleJa: 暗号資産ウォッチ
titleEn: Crypto Asset Watch
titleFr: Surveillance des actifs cryptographiques
---

# Surveillance des actifs cryptographiques

La Surveillance des actifs cryptographiques lie les adresses de portefeuille aux comptes d'actifs cryptographiques afin que vous puissiez vérifier les soldes et les équivalents en JPY. Gérez-la depuis États financiers -> Crypto.

En plus des soldes calculés à partir des écritures de journal normales, l'application peut récupérer les soldes réels sur la chaîne et les refléter dans l'évaluation des actifs cryptographiques affichée dans les états financiers.

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
2. Ouvrez États financiers -> Crypto.
3. Ajoutez un portefeuille, puis choisissez la chaîne, l'adresse et le compte lié.
4. Utilisez la récupération de solde pour vérifier la quantité disponible et le montant équivalent en JPY.
5. Enregistrez-le pour afficher le portefeuille dans la liste des actifs cryptographiques.

En général, un compte est lié à un seul paramètre de portefeuille. Même avec la même adresse Solana, vous pouvez souhaiter traiter SOL, SKR, mSOL et les actifs similaires séparément, donc créez des comptes séparés si nécessaire.

## Comment les valeurs en JPY sont gérées

Sur la page Crypto, l'application multiplie les quantités récupérées par les données de prix pour afficher les valeurs équivalentes en JPY. Les prix sont récupérés depuis des sources de prix externes et peuvent être actualisés à l'écran.

Pour les comptes de la catégorie crypto, l'évaluation affichée dans les états financiers peut être remplacée par la valeur calculée à partir de la quantité récupérée et du prix, au lieu du solde calculé uniquement à partir des écritures de journal. Cela vous permet de visualiser le total des actifs plus proche de la valeur marchande actuelle.

## Relation avec les écritures de journal

La Surveillance des actifs cryptographiques sert à vérifier la quantité détenue et l'évaluation. Elle ne journalise pas automatiquement chaque achat, vente, échange, transfert, frais, gain réalisé ou perte réalisée.

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

La Surveillance des actifs cryptographiques sert à vérifier les avoirs et les évaluations. Elle ne journalise pas automatiquement les achats, ventes, échanges ou transferts. Enregistrez les transactions réelles séparément comme des écritures de journal multilignes.

### Différence entre évaluation et valeur comptable

Lorsque la Surveillance des actifs cryptographiques est active, les états financiers affichent les évaluations aux prix actuels du marché. Le solde du journal, cependant, est basé sur les montants enregistrés à l'acquisition. L'écart entre ceux-ci est un gain ou une perte non réalisé(e) et n'est pas reflété dans le journal jusqu'à la vente.

Pour les actions, il n'y a pas non plus de réévaluation mensuelle automatique. La base de coût reste dans le journal et le profit ou la perte réel(le) est enregistré(e) au moment de la vente.

## Notes sur les finances personnelles

Les valeurs du marché des cryptomonnaies peuvent changer radicalement. L'évaluation affichée dans l'Aperçu et les états financiers est une estimation pour comprendre la valeur nette actuelle du ménage. Elle ne remplace pas entièrement la base de coût fiscal, le calcul des profits/pertes, la moyenne mobile, la moyenne totale ou le traitement des frais.

Après des transactions importantes, vérifiez séparément les écritures de journal par rapport à l'historique de l'échange et du portefeuille.
