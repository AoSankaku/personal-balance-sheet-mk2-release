import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type {
  ProductApiCredentialStatus,
  ProductApiProvider,
  UpsertProductApiCredentialInput,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import { productApiCredentials } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

const providers: ProductApiProvider[] = ["rakuten", "yahoo", "amazon"];

function isProvider(value: string): value is ProductApiProvider {
  return providers.includes(value as ProductApiProvider);
}

function cleanSecret(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function last4(value: string | null): string | null {
  return value ? value.slice(-4) : null;
}

function toStatus(
  provider: ProductApiProvider,
  row?: typeof productApiCredentials.$inferSelect,
): ProductApiCredentialStatus {
  return {
    provider,
    has_api_key: Boolean(row?.api_key),
    has_api_secret: Boolean(row?.api_secret),
    has_partner_tag: Boolean(row?.partner_tag),
    has_application_id: Boolean(row?.application_id),
    api_key_last4: last4(row?.api_key ?? null),
    partner_tag_last4: last4(row?.partner_tag ?? null),
    application_id_last4: last4(row?.application_id ?? null),
    updated_at: row?.updated_at ?? null,
  };
}

router.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db.select().from(productApiCredentials);
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return c.json(
    providers.map((provider) =>
      toStatus(provider, byProvider.get(provider) as typeof productApiCredentials.$inferSelect | undefined),
    ),
  );
});

router.post("/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "invalid_provider" }, 400);

  const body = await c.req.json<UpsertProductApiCredentialInput>();
  const incoming = {
    api_key: cleanSecret(body.api_key),
    api_secret: cleanSecret(body.api_secret),
    partner_tag: cleanSecret(body.partner_tag),
    application_id: cleanSecret(body.application_id),
  };

  if (!Object.values(incoming).some((value) => value !== undefined)) {
    return c.json({ error: "no_credentials_provided" }, 400);
  }

  const db = createDb(c.env);
  const [existing] = await db
    .select()
    .from(productApiCredentials)
    .where(eq(productApiCredentials.provider, provider));

  const now = new Date().toISOString();
  const values = {
    provider,
    api_key: incoming.api_key === undefined ? existing?.api_key ?? null : incoming.api_key,
    api_secret:
      incoming.api_secret === undefined ? existing?.api_secret ?? null : incoming.api_secret,
    partner_tag:
      incoming.partner_tag === undefined ? existing?.partner_tag ?? null : incoming.partner_tag,
    application_id:
      incoming.application_id === undefined
        ? existing?.application_id ?? null
        : incoming.application_id,
    updated_at: now,
  };

  const [row] = await db
    .insert(productApiCredentials)
    .values(values)
    .onConflictDoUpdate({
      target: productApiCredentials.provider,
      set: {
        api_key: values.api_key,
        api_secret: values.api_secret,
        partner_tag: values.partner_tag,
        application_id: values.application_id,
        updated_at: now,
      },
    })
    .returning();

  return c.json(toStatus(provider, row), 201);
});

router.delete("/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (!isProvider(provider)) return c.json({ error: "invalid_provider" }, 400);

  const db = createDb(c.env);
  await db
    .delete(productApiCredentials)
    .where(eq(productApiCredentials.provider, provider));
  return c.json({ success: true });
});

export { router as productApiCredentialsRouter };
