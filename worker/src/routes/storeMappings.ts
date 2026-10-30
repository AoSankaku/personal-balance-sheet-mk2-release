import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { UpsertStoreAccountMappingInput } from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import { storeAccountMappings, accounts, budgetCategories } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

// GET /api/store-mappings — list all store→account mappings
router.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select({
      id: storeAccountMappings.id,
      store_name: storeAccountMappings.store_name,
      account_id: storeAccountMappings.account_id,
      account_name: accounts.name,
      budget_category_id: budgetCategories.id,
      created_at: storeAccountMappings.created_at,
    })
    .from(storeAccountMappings)
    .leftJoin(accounts, eq(storeAccountMappings.account_id, accounts.id))
    .leftJoin(budgetCategories, and(
      eq(storeAccountMappings.budget_category_id, budgetCategories.id),
      eq(budgetCategories.is_archived, 0),
    ))
    .orderBy(storeAccountMappings.store_name);
  return c.json(rows);
});

// POST /api/store-mappings — upsert (overwrite) mapping for a store
router.post("/", async (c) => {
  const body = await c.req.json<UpsertStoreAccountMappingInput>();
  if (
    !body ||
    typeof body.store_name !== "string" ||
    !body.store_name.trim() ||
    !Number.isSafeInteger(body.account_id) ||
    body.account_id <= 0
  ) {
    return c.json({ error: "store_name and account_id are required" }, 400);
  }

  const db = createDb(c.env);
  const budgetCategoryId = body.budget_category_id ?? null;
  if (budgetCategoryId !== null) {
    if (!Number.isSafeInteger(budgetCategoryId) || budgetCategoryId <= 0) {
      return c.json({ error: "Invalid budget_category_id" }, 400);
    }
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, body.account_id));
    if (!account || account.type !== "income" || account.category === "salary") {
      return c.json({ error: "Budget categories require a non-salary income account" }, 400);
    }
    const [category] = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.id, budgetCategoryId));
    if (!category || category.is_archived) {
      return c.json({ error: "Invalid budget_category_id" }, 400);
    }
  }

  const values = {
    store_name: body.store_name.replace(/\s+/g, " ").trim(),
    account_id: body.account_id,
    budget_category_id: budgetCategoryId,
  };
  // Upsert: insert or replace on conflict
  await db
    .insert(storeAccountMappings)
    .values(values)
    .onConflictDoUpdate({
      target: storeAccountMappings.store_name,
      set: {
        account_id: values.account_id,
        budget_category_id: values.budget_category_id,
      },
    });

  const [row] = await db
    .select()
    .from(storeAccountMappings)
    .where(eq(storeAccountMappings.store_name, values.store_name));

  return c.json(row, 200);
});

// DELETE /api/store-mappings/:id — delete a mapping
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const db = createDb(c.env);
  const deleted = await db
    .delete(storeAccountMappings)
    .where(eq(storeAccountMappings.id, id))
    .returning();

  if (deleted.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { router as storeMappingsRouter };
