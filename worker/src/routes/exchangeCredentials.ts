import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { exchangeCredentials } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

// ── GET /api/exchange-credentials ────────────────────────────────────────
// Returns all exchange credentials without exposing api_secret.
router.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select({
      id: exchangeCredentials.id,
      exchange: exchangeCredentials.exchange,
      api_key: exchangeCredentials.api_key,
      created_at: exchangeCredentials.created_at,
    })
    .from(exchangeCredentials);
  return c.json(rows);
});

// ── POST /api/exchange-credentials ───────────────────────────────────────
// Upsert: if a credential for this exchange already exists, replace it.
router.post("/", async (c) => {
  const body = await c.req.json<{
    exchange: string;
    api_key: string;
    api_secret: string;
  }>();
  if (!body.exchange || !body.api_key || !body.api_secret) {
    return c.json({ error: "exchange, api_key, and api_secret are required" }, 400);
  }

  const db = createDb(c.env);
  const result = await db
    .insert(exchangeCredentials)
    .values({
      exchange: body.exchange.toLowerCase(),
      api_key: body.api_key.trim(),
      api_secret: body.api_secret.trim(),
    })
    .onConflictDoUpdate({
      target: exchangeCredentials.exchange,
      set: {
        api_key: body.api_key.trim(),
        api_secret: body.api_secret.trim(),
      },
    })
    .returning({
      id: exchangeCredentials.id,
      exchange: exchangeCredentials.exchange,
      api_key: exchangeCredentials.api_key,
      created_at: exchangeCredentials.created_at,
    });
  return c.json(result[0], 201);
});

// ── DELETE /api/exchange-credentials/:id ─────────────────────────────────
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = createDb(c.env);
  const deleted = await db
    .delete(exchangeCredentials)
    .where(eq(exchangeCredentials.id, id))
    .returning();
  if (deleted.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { router as exchangeCredentialsRouter };
