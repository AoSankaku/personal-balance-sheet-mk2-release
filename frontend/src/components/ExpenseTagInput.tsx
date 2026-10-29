import { TagsInput } from "@mantine/core";
import { normalizeExpenseTagNames } from "../lib/expenseTagInput";

interface Props {
  value: string[];
  options: string[];
  label: string;
  placeholder: string;
  onChange: (value: string[]) => void;
}

/** Lets a user reuse a prior tag or create a new tag inline. */
export function ExpenseTagInput({
  value,
  options,
  label,
  placeholder,
  onChange,
}: Props) {
  return (
    <div data-testid="expense-tag-input">
      <TagsInput
        label={label}
        placeholder={placeholder}
        data={options}
        value={value}
        onChange={(next) => onChange(normalizeExpenseTagNames(next))}
        maxTags={20}
        clearable
        acceptValueOnBlur
        splitChars={[",", "，"]}
      />
    </div>
  );
}
