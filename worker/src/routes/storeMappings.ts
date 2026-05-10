import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { storeAccountMappings, accounts } from "../db/schema";

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
      created_at: storeAccountMappings.created_at,
    })
    .from(storeAccountMappings)
    .leftJoin(accounts, eq(storeAccountMappings.account_id, accounts.id))
    .orderBy(storeAccountMappings.store_name);
  return c.json(rows);
});

// POST /api/store-mappings — upsert (overwrite) mapping for a store
router.post("/", async (c) => {
  const body = await c.req.json<{ store_name: string; account_id: number }>();
  if (!body.store_name || !body.account_id) {
    return c.json({ error: "store_name and account_id are required" }, 400);
  }

  const db = createDb(c.env);

  // Upsert: insert or replace on conflict
  await db
    .insert(storeAccountMappings)
    .values({ store_name: body.store_name, account_id: body.account_id })
    .onConflictDoUpdate({
      target: storeAccountMappings.store_name,
      set: { account_id: body.account_id },
    });

  const [row] = await db
    .select()
    .from(storeAccountMappings)
    .where(eq(storeAccountMappings.store_name, body.store_name));

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
