import { asc } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "../db";
import { createDb } from "../db";
import { expenseTags } from "../db/schema";

export const expenseTagsRouter = new Hono<{ Bindings: Env }>();

expenseTagsRouter.get("/", async (c) => {
  const db = createDb(c.env);
  const tags = await db.select({ id: expenseTags.id, name: expenseTags.name })
    .from(expenseTags)
    .orderBy(asc(expenseTags.name), asc(expenseTags.id));
  return c.json(tags);
});
