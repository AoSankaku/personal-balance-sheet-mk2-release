import { enabledCurrencies } from "../db/schema";

export type CurrencyDecimalPlacesMap = Record<string, number>;

export async function loadCurrencyDecimalPlaces(
  db: {
    select: (fields: {
      code: typeof enabledCurrencies.code;
      decimal_places: typeof enabledCurrencies.decimal_places;
    }) => {
      from: (table: typeof enabledCurrencies) => Promise<
        { code: string; decimal_places: number }[]
      >;
    };
  },
): Promise<CurrencyDecimalPlacesMap> {
  try {
    const rows = await db
      .select({
        code: enabledCurrencies.code,
        decimal_places: enabledCurrencies.decimal_places,
      })
      .from(enabledCurrencies);

    return Object.fromEntries(
      rows.map((row) => [row.code.toUpperCase(), row.decimal_places]),
    );
  } catch {
    return {};
  }
}
