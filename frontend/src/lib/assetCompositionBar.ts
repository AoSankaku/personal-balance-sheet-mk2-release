export interface AssetCompositionBar {
  liabilityPercentage: number | null;
  netWorthPercentage: number | null;
  liabilityBarShare: number;
  netWorthBarShare: number;
}

/**
 * Expresses the balance-sheet equation as a composition of total assets:
 * assets = liabilities + net worth.
 *
 * The displayed percentages may exceed the visual 0–100% range when the
 * balance sheet is insolvent, so the progress-bar shares are clamped.
 */
export function getAssetCompositionBar(
  totalAssets: number,
  totalLiabilities: number,
): AssetCompositionBar {
  const assets = Math.max(0, totalAssets);
  const liabilities = Math.max(0, totalLiabilities);

  if (assets === 0) {
    return {
      liabilityPercentage: null,
      netWorthPercentage: null,
      liabilityBarShare: liabilities > 0 ? 100 : 0,
      netWorthBarShare: 0,
    };
  }

  const liabilityPercentage = Math.round((liabilities / assets) * 100);
  const netWorthPercentage = 100 - liabilityPercentage;
  const liabilityBarShare = Math.min(100, liabilityPercentage);

  return {
    liabilityPercentage,
    netWorthPercentage,
    liabilityBarShare,
    netWorthBarShare: 100 - liabilityBarShare,
  };
}
