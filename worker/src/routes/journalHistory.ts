import { count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { journalDeletionCandidates, journalHistorySettings } from "../db/schema";
import { serializeJournalHistory } from "../lib/journalHistory";

const router = new Hono<{ Bindings: Env }>();

router.get("/", async c => {
  const offset = Number(c.req.query("offset") ?? 0);
  const limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    return c.json({ error: "invalid_pagination" }, 400);
  }
  const db = createDb(c.env);
  // One D1 batch gives settings, count, and page a consistent database snapshot.
  const results = await db.batch([
    db.select().from(journalHistorySettings).where(eq(journalHistorySettings.id, 1)),
    db.select({ total: count() }).from(journalDeletionCandidates),
    db.select().from(journalDeletionCandidates).orderBy(desc(journalDeletionCandidates.id)).limit(limit).offset(offset),
  ]);
  return c.json({
    retention_limit: results[0][0]!.retention_limit,
    total: results[1][0]!.total,
    offset, limit,
    entries: results[2].map(serializeJournalHistory),
  });
});

router.patch("/settings", async c => {
  const body = await c.req.json<unknown>();
  const limit = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).retention_limit : undefined;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10000) {
    return c.json({ error: "retention_limit_must_be_integer_between_1_and_10000" }, 400);
  }
  const db = createDb(c.env);
  const results = await db.batch([
    db.update(journalHistorySettings).set({ retention_limit: limit }).where(eq(journalHistorySettings.id, 1)).returning(),
    db.select({ total: count() }).from(journalDeletionCandidates),
  ]);
  return c.json({ retention_limit: results[0][0]!.retention_limit, total: results[1][0]!.total });
});

export const journalHistoryRouter = router;
