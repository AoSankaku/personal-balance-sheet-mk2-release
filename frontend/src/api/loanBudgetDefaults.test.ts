import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("long-term loan budget defaults API", () => {
  test("loads defaults for an account and currency", async () => {
    let requestUrl = "";
    globalThis.fetch = async input => {
      requestUrl = String(input);
      return Response.json({
        account_id: 7,
        currency: "JPY",
        source: "opening",
        source_journal_entry_id: 42,
        budget_revision: 10,
        settled_minor_units: 0,
        settled_allocations: [],
        settled_progress_available: true,
        allocations: [{ budget_category_id: 3, weight: 2 }],
      });
    };

    const result = await api.loans.budgetDefaults.get(7, "JPY");

    expect(requestUrl).toBe("/api/loans/7/budget-defaults?currency=JPY");
    expect(result.source).toBe("opening");
    expect(result.allocations).toEqual([
      { budget_category_id: 3, weight: 2 },
    ]);
  });

  test("saves integer ratio weights as a currency-scoped override", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        account_id: 7,
        currency: "USD",
        source: "custom",
        source_journal_entry_id: null,
        budget_revision: 10,
        settled_minor_units: 0,
        settled_allocations: [],
        settled_progress_available: true,
        allocations: [
          { budget_category_id: 3, weight: 2 },
          { budget_category_id: null, weight: 1 },
        ],
      });
    };

    const result = await api.loans.budgetDefaults.update(7, {
      currency: "USD",
      allocations: [
        { budget_category_id: 3, weight: 2 },
        { budget_category_id: null, weight: 1 },
      ],
    });

    expect(requestUrl).toBe("/api/loans/7/budget-defaults");
    expect(requestInit?.method).toBe("PUT");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      currency: "USD",
      allocations: [
        { budget_category_id: 3, weight: 2 },
        { budget_category_id: null, weight: 1 },
      ],
    });
    expect(result.source).toBe("custom");
  });

  test("resets the override for the selected currency", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        account_id: 7,
        currency: "JPY",
        source: "opening",
        source_journal_entry_id: 42,
        budget_revision: 10,
        settled_minor_units: 0,
        settled_allocations: [],
        settled_progress_available: true,
        allocations: [],
      });
    };

    await api.loans.budgetDefaults.reset(7, "JPY");

    expect(requestUrl).toBe("/api/loans/7/budget-defaults?currency=JPY");
    expect(requestInit?.method).toBe("DELETE");
  });
});
