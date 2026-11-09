import { Autocomplete, createTheme, MultiSelect, Select, TagsInput } from "@mantine/core";
import { searchOptionsFilter } from "./lib/searchOptionsFilter";

export const appTheme = createTheme({
  cursorType: "pointer",
  components: {
    Select: Select.extend({ defaultProps: { filter: searchOptionsFilter } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { filter: searchOptionsFilter } }),
    Autocomplete: Autocomplete.extend({ defaultProps: { filter: searchOptionsFilter } }),
    TagsInput: TagsInput.extend({ defaultProps: { filter: searchOptionsFilter } }),
  },
});
