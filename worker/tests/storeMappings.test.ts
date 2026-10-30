import { afterEach, describe, expect, test } from "bun:test";
import { storeMappingsRouter } from "../src/routes/storeMappings";
import { createTestD1 } from "./helpers/d1";

const fixtures: ReturnType<typeof createTestD1>[] = [];

function fixture() {
  const database = createTestD1();
  fixtures.push(database);
  database.sqlite.exec(`
    INSERT INTO accounts(id, name, type, category) VALUES
      (1001, 'Temporary income', 'income', 'other'),
      (1002, 'Salary', 'income', 'salary'),
      (1003, 'Food', 'expense', 'other');
    INSERT INTO budget_categories(id, name) VALUES
      (2001, 'Free spending'), (2002, 'Savings');
  `);
  return database;
}

function request(database: ReturnType<typeof createTestD1>, body?: unknown) {
  return storeMappingsRouter.request(
    "/",
    body === undefined ? undefined : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { DB: database.DB },
  );
}

afterEach(() => {
  for (const database of fixtures.splice(0)) database.close();
});

describe("CSV store mapping budget persistence", () => {
  test("saves and reloads the selected income budget category", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001, budget_category_id: 2001 };
    const saved = await request(database, input);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject(input);

    const reloaded = await request(database);
    expect(reloaded.status).toBe(200);
    expect(await reloaded.json()).toEqual([
      expect.objectContaining({ ...input, account_name: "Temporary income" }),
    ]);
  });

  test("updates and explicitly clears the category without changing the account", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001 };
    await request(database, { ...input, budget_category_id: 2001 });
    const updated = await request(database, { ...input, budget_category_id: 2002 });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ ...input, budget_category_id: 2002 });

    const cleared = await request(database, { ...input, budget_category_id: null });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ...input, budget_category_id: null });
    expect(await (await request(database)).json()).toHaveLength(1);
  });

  test("keeps legacy account-only requests working and clears an obsolete category", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001 };
    await request(database, { ...input, budget_category_id: 2001 });
    const saved = await request(database, { ...input, account_id: 1003 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ ...input, account_id: 1003, budget_category_id: null });
  });

  test("rejects nonexistent, invalid, and ineligible category selections without overwriting the mapping", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001, budget_category_id: 2001 };
    await request(database, input);
    for (const change of [
      { budget_category_id: 9999 },
      { budget_category_id: 0 },
      { budget_category_id: 2001.5 },
      { budget_category_id: "2001" },
      { account_id: 1002 },
      { account_id: 1003 },
      { account_id: 9999 },
    ]) {
      const response = await request(database, { ...input, ...change });
      expect(response.status, JSON.stringify(change)).toBe(400);
    }
    expect(await (await request(database)).json()).toEqual([expect.objectContaining(input)]);
  });

  test("deleting a budget category retains the store's account mapping", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001, budget_category_id: 2001 };
    await request(database, input);
    database.sqlite.exec("DELETE FROM budget_categories WHERE id = 2001");
    expect(await (await request(database)).json()).toEqual([
      expect.objectContaining({ ...input, budget_category_id: null }),
    ]);
  });

  test("archiving a category stops future imports from allocating into the hidden budget", async () => {
    const database = fixture();
    const input = { store_name: "利息", account_id: 1001, budget_category_id: 2001 };
    await request(database, input);
    database.sqlite.exec("UPDATE budget_categories SET is_archived = 1 WHERE id = 2001");
    expect(await (await request(database)).json()).toEqual([
      expect.objectContaining({ ...input, budget_category_id: null }),
    ]);
    expect((await request(database, input)).status).toBe(400);
  });
});
