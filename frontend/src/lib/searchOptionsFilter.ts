import type { ComboboxItem, ComboboxParsedItem, OptionsFilter } from "@mantine/core";
import { normalizeSearchText } from "./searchText";

/** Preserve Mantine's default label matching, grouping, and result limits. */
export const searchOptionsFilter: OptionsFilter = ({ options, search, limit }) => {
  const query = normalizeSearchText(search.trim());
  const result: ComboboxParsedItem[] = [];

  for (const option of options) {
    if (result.length === limit) break;
    if ("group" in option) {
      result.push({
        ...option,
        items: searchOptionsFilter({
          options: option.items,
          search,
          limit: limit - result.length,
        }) as ComboboxItem[],
      });
    } else if (normalizeSearchText(option.label).includes(query)) {
      result.push(option);
    }
  }

  return result;
};
