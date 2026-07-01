import { eq } from "drizzle-orm";
import type {
  ProductAvailabilityStatus,
  ProductMetadata,
  ProductSourceSite,
} from "@balance-sheet/shared";
import { createDb, type Env } from "../db";
import { productApiCredentials, productMetadataCache } from "../db/schema";

const CACHE_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

type ProductIdentity = {
  normalizedUrl: string;
  sourceSite: ProductSourceSite;
  sourceProductId: string | null;
  fetchUrl: string;
};

type OgMetadata = {
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  og_site_name: string | null;
};

type ProviderMetadata = {
  name: string | null;
  price_amount: number | null;
  currency: string;
  availability_status: ProductAvailabilityStatus;
  availability_label: string | null;
  error_code: string | null;
  error_message: string | null;
};

type CacheRow = typeof productMetadataCache.$inferSelect;

type ProductApiCredentialValues = {
  rakutenApplicationId: string | null;
  rakutenAccessKey: string | null;
  yahooShoppingAppId: string | null;
  amazonAccessKey: string | null;
  amazonSecretKey: string | null;
  amazonPartnerTag: string | null;
};

const allowedProductHosts = new Set([
  "amazon.co.jp",
  "www.amazon.co.jp",
  "amzn.asia",
  "item.rakuten.co.jp",
  "books.rakuten.co.jp",
  "hb.afl.rakuten.co.jp",
  "shopping.yahoo.co.jp",
  "store.shopping.yahoo.co.jp",
]);

function jsonResponseMetadata(row: CacheRow): ProductMetadata {
  return {
    id: row.id,
    normalized_url: row.normalized_url,
    source_site: row.source_site as ProductSourceSite,
    source_product_id: row.source_product_id,
    name: row.name,
    price_amount: row.price_amount,
    currency: row.currency,
    availability_status: row.availability_status as ProductAvailabilityStatus,
    availability_label: row.availability_label,
    og_title: row.og_title,
    og_description: row.og_description,
    og_image_url: row.og_image_url,
    og_site_name: row.og_site_name,
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
    error_code: row.error_code,
    error_message: row.error_message,
  };
}

function cleanText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function cleanUrl(value: unknown): string | null {
  const text = cleanText(value, 2048);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function parseProductUrl(rawUrl: string): ProductIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  const hostname = url.hostname.toLowerCase();
  if (!allowedProductHosts.has(hostname)) return null;

  if (hostname === "amzn.asia") {
    return {
      normalizedUrl: url.toString(),
      sourceSite: "amazon",
      sourceProductId: null,
      fetchUrl: url.toString(),
    };
  }

  if (hostname.endsWith("amazon.co.jp")) {
    const asin =
      url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1] ??
      url.searchParams.get("asin") ??
      null;
    return {
      normalizedUrl: asin
        ? `https://www.amazon.co.jp/dp/${asin.toUpperCase()}`
        : url.toString(),
      sourceSite: "amazon",
      sourceProductId: asin ? asin.toUpperCase() : null,
      fetchUrl: url.toString(),
    };
  }

  if (hostname === "item.rakuten.co.jp" || hostname === "books.rakuten.co.jp") {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const shop = pathParts[0];
    const item = pathParts[1];
    const itemCode = shop && item ? `${shop}:${item}` : null;
    return {
      normalizedUrl: itemCode
        ? `https://${hostname}/${shop}/${item}/`
        : url.toString(),
      sourceSite: "rakuten",
      sourceProductId: itemCode,
      fetchUrl: url.toString(),
    };
  }

  if (hostname === "store.shopping.yahoo.co.jp") {
    const pathParts = url.pathname.split("/").filter(Boolean);
    const store = pathParts[0];
    const code = pathParts[1]?.replace(/\.html$/i, "");
    const itemCode = store && code ? `${store}_${code}` : null;
    return {
      normalizedUrl: itemCode
        ? `https://store.shopping.yahoo.co.jp/${store}/${code}.html`
        : url.toString(),
      sourceSite: "yahoo",
      sourceProductId: itemCode,
      fetchUrl: url.toString(),
    };
  }

  if (hostname === "shopping.yahoo.co.jp") {
    return {
      normalizedUrl: url.toString(),
      sourceSite: "yahoo",
      sourceProductId: url.searchParams.get("itemcode"),
      fetchUrl: url.toString(),
    };
  }

  return {
    normalizedUrl: url.toString(),
    sourceSite: hostname.includes("rakuten") ? "rakuten" : "other",
    sourceProductId: null,
    fetchUrl: url.toString(),
  };
}

function isFresh(row: CacheRow, now: Date): boolean {
  return new Date(row.expires_at).getTime() > now.getTime();
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedProductUrl(url: URL): boolean {
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    allowedProductHosts.has(url.hostname.toLowerCase())
  );
}

async function resolveAllowedRedirects(url: string): Promise<Response> {
  let current = new URL(url);
  if (!isAllowedProductUrl(current)) throw new Error("unsupported_url");

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const response = await fetchWithTimeout(current.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; personal-balance-sheet/1.0; +https://workers.cloudflare.com/)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current);
    if (!isAllowedProductUrl(current)) throw new Error("unsupported_redirect");
  }

  throw new Error("too_many_redirects");
}

async function resolveProductUrl(url: string): Promise<string> {
  let current = new URL(url);
  if (!isAllowedProductUrl(current)) throw new Error("unsupported_url");

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const response = await fetchWithTimeout(current.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; personal-balance-sheet/1.0; +https://workers.cloudflare.com/)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });
    if (response.status < 300 || response.status >= 400) {
      return current.toString();
    }

    const location = response.headers.get("location");
    if (!location) return current.toString();
    current = new URL(location, current);
    if (!isAllowedProductUrl(current)) throw new Error("unsupported_redirect");
  }

  throw new Error("too_many_redirects");
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_HTML_BYTES) return "";
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged.subarray(0, offset));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMeta(html: string, key: string): string | null {
  const tagPattern = /<meta\s+[^>]*>/gi;
  const tags = html.match(tagPattern) ?? [];
  for (const tag of tags) {
    const property =
      tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1]?.toLowerCase() ??
      null;
    if (property !== key.toLowerCase()) continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return cleanText(decodeHtmlEntities(content), 1000);
  }
  return null;
}

async function fetchOgMetadata(fetchUrl: string): Promise<OgMetadata> {
  try {
    const response = await resolveAllowedRedirects(fetchUrl);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return {
        og_title: null,
        og_description: null,
        og_image_url: null,
        og_site_name: null,
      };
    }
    const html = await readLimitedText(response);
    return {
      og_title: extractMeta(html, "og:title"),
      og_description: extractMeta(html, "og:description"),
      og_image_url: cleanUrl(extractMeta(html, "og:image")),
      og_site_name: extractMeta(html, "og:site_name"),
    };
  } catch {
    return {
      og_title: null,
      og_description: null,
      og_image_url: null,
      og_site_name: null,
    };
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const part of path) {
    const record = getRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}

function getNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function providerError(
  code: string,
  message: string,
  status: ProductAvailabilityStatus = "error",
): ProviderMetadata {
  return {
    name: null,
    price_amount: null,
    currency: "JPY",
    availability_status: status,
    availability_label: null,
    error_code: code,
    error_message: message,
  };
}

function mapAvailability(value: unknown): ProductAvailabilityStatus {
  if (value === 1 || value === "1" || value === true) return "in_stock";
  if (value === 0 || value === "0" || value === false) return "out_of_stock";
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("instock") || text.includes("in_stock")) return "in_stock";
  if (text.includes("outofstock") || text.includes("out_of_stock")) {
    return "out_of_stock";
  }
  if (text.includes("unavailable")) return "unavailable";
  return "unknown";
}

async function loadProductApiCredentials(
  env: Env,
): Promise<ProductApiCredentialValues> {
  const credentials: ProductApiCredentialValues = {
    rakutenApplicationId: env.RAKUTEN_APPLICATION_ID ?? null,
    rakutenAccessKey: env.RAKUTEN_ACCESS_KEY ?? null,
    yahooShoppingAppId: env.YAHOO_SHOPPING_APP_ID ?? null,
    amazonAccessKey: env.AMAZON_ACCESS_KEY ?? null,
    amazonSecretKey: env.AMAZON_SECRET_KEY ?? null,
    amazonPartnerTag: env.AMAZON_PARTNER_TAG ?? null,
  };

  const db = createDb(env);
  const rows = await db.select().from(productApiCredentials);
  for (const row of rows) {
    if (row.provider === "rakuten") {
      credentials.rakutenApplicationId =
        row.application_id ?? credentials.rakutenApplicationId;
      credentials.rakutenAccessKey = row.api_key ?? credentials.rakutenAccessKey;
    } else if (row.provider === "yahoo") {
      credentials.yahooShoppingAppId =
        row.application_id ?? credentials.yahooShoppingAppId;
    } else if (row.provider === "amazon") {
      credentials.amazonAccessKey = row.api_key ?? credentials.amazonAccessKey;
      credentials.amazonSecretKey = row.api_secret ?? credentials.amazonSecretKey;
      credentials.amazonPartnerTag = row.partner_tag ?? credentials.amazonPartnerTag;
    }
  }

  return credentials;
}

async function fetchRakutenMetadata(
  credentials: ProductApiCredentialValues,
  identity: ProductIdentity,
): Promise<ProviderMetadata> {
  if (!credentials.rakutenApplicationId || !credentials.rakutenAccessKey) {
    return providerError(
      "api_credentials_missing",
      "Rakuten application ID and access key are not configured",
      "api_credentials_missing",
    );
  }
  if (!identity.sourceProductId) {
    return providerError("product_id_missing", "Rakuten item code was not found", "unsupported");
  }

  const endpoint = new URL(
    "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601",
  );
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("applicationId", credentials.rakutenApplicationId);
  endpoint.searchParams.set("accessKey", credentials.rakutenAccessKey);
  endpoint.searchParams.set("itemCode", identity.sourceProductId);

  const response = await fetchWithTimeout(endpoint.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return providerError("api_request_failed", `Rakuten API returned ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const item = getRecord(getPath(json, ["Items"]))?.["0"] ?? (getPath(json, ["Items"]) as unknown[] | undefined)?.[0];
  const data = getRecord(getPath(item, ["Item"])) ?? getRecord(item);
  if (!data) return providerError("product_not_found", "Rakuten item was not found", "unavailable");

  const price = getNumber(data.itemPrice);
  const availability = mapAvailability(data.availability);
  return {
    name: cleanText(data.itemName, 500),
    price_amount: price == null ? null : Math.round(price),
    currency: "JPY",
    availability_status: availability,
    availability_label:
      availability === "in_stock"
        ? "available"
        : availability === "out_of_stock"
          ? "out of stock"
          : null,
    error_code: null,
    error_message: null,
  };
}

async function fetchYahooMetadata(
  credentials: ProductApiCredentialValues,
  identity: ProductIdentity,
): Promise<ProviderMetadata> {
  if (!credentials.yahooShoppingAppId) {
    return providerError(
      "api_credentials_missing",
      "YAHOO_SHOPPING_APP_ID is not configured",
      "api_credentials_missing",
    );
  }
  if (!identity.sourceProductId) {
    return providerError("product_id_missing", "Yahoo item code was not found", "unsupported");
  }

  const endpoint = new URL(
    "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemLookup",
  );
  endpoint.searchParams.set("appid", credentials.yahooShoppingAppId);
  endpoint.searchParams.set("itemcode", identity.sourceProductId);

  const response = await fetchWithTimeout(endpoint.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return providerError("api_request_failed", `Yahoo Shopping API returned ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const hits = getPath(json, ["hits"]);
  const firstHit = Array.isArray(hits) ? hits[0] : null;
  const legacyHit =
    getPath(json, ["ResultSet", "0", "Result", "0"]) ??
    getPath(json, ["ResultSet", "Result", "0"]);
  const data = getRecord(firstHit) ?? getRecord(legacyHit);
  if (!data) return providerError("product_not_found", "Yahoo item was not found", "unavailable");

  const price =
    getNumber(data.price) ??
    getNumber(getPath(data, ["priceLabel", "defaultPrice"])) ??
    getNumber(getPath(data, ["Price", "_value"]));
  const availability = mapAvailability(
    data.availability ?? data.inStock ?? getPath(data, ["Availability", "Name"]),
  );
  return {
    name: cleanText(data.name ?? data.title ?? data.Name, 500),
    price_amount: price == null ? null : Math.round(price),
    currency: "JPY",
    availability_status: availability,
    availability_label: cleanText(
      data.availability ??
        data.inStock ??
        getPath(data, ["Availability", "Name"]) ??
        null,
      100,
    ),
    error_code: null,
    error_message: null,
  };
}

async function hmac(key: CryptoKey, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
}

async function importHmacKey(key: ArrayBuffer | string): Promise<CryptoKey> {
  const bytes =
    typeof key === "string" ? new TextEncoder().encode(key) : new Uint8Array(key);
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function amzDate(now: Date): { date: string; datetime: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { date: iso.slice(0, 8), datetime: iso };
}

async function signingKey(secret: string, date: string): Promise<CryptoKey> {
  const kDate = await hmac(await importHmacKey(`AWS4${secret}`), date);
  const kRegion = await hmac(await importHmacKey(kDate), "us-west-2");
  const kService = await hmac(await importHmacKey(kRegion), "ProductAdvertisingAPI");
  const kSigning = await hmac(await importHmacKey(kService), "aws4_request");
  return importHmacKey(kSigning);
}

async function fetchAmazonMetadata(
  credentials: ProductApiCredentialValues,
  identity: ProductIdentity,
  now: Date,
): Promise<ProviderMetadata> {
  if (
    !credentials.amazonAccessKey ||
    !credentials.amazonSecretKey ||
    !credentials.amazonPartnerTag
  ) {
    return providerError(
      "api_credentials_missing",
      "Amazon official API credentials are not configured",
      "api_credentials_missing",
    );
  }
  if (!identity.sourceProductId) {
    return providerError("product_id_missing", "Amazon ASIN was not found", "unsupported");
  }

  const host = "webservices.amazon.co.jp";
  const target = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems";
  const body = JSON.stringify({
    ItemIds: [identity.sourceProductId],
    Marketplace: "www.amazon.co.jp",
    PartnerTag: credentials.amazonPartnerTag,
    PartnerType: "Associates",
    Resources: [
      "Images.Primary.Medium",
      "ItemInfo.Title",
      "Offers.Listings.Availability.Message",
      "Offers.Listings.Availability.Type",
      "Offers.Listings.Price",
    ],
  });
  const { date, datetime } = amzDate(now);
  const payloadHash = await sha256Hex(body);
  const canonicalHeaders =
    `content-encoding:amz-1.0\nhost:${host}\nx-amz-date:${datetime}\nx-amz-target:${target}\n`;
  const signedHeaders = "content-encoding;host;x-amz-date;x-amz-target";
  const canonicalRequest = [
    "POST",
    "/paapi5/getitems",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${date}/us-west-2/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hex(
    await hmac(await signingKey(credentials.amazonSecretKey, date), stringToSign),
  );

  const response = await fetchWithTimeout(`https://${host}/paapi5/getitems`, {
    method: "POST",
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.amazonAccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Encoding": "amz-1.0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Amz-Date": datetime,
      "X-Amz-Target": target,
    },
    body,
  });
  if (!response.ok) {
    return providerError("api_request_failed", `Amazon official API returned ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const item = getPath(json, ["ItemsResult", "Items"]);
  const firstItem = Array.isArray(item) ? item[0] : null;
  const listing = getPath(firstItem, ["Offers", "Listings"]);
  const firstListing = Array.isArray(listing) ? listing[0] : null;
  const price = getNumber(getPath(firstListing, ["Price", "Amount"]));
  const availabilityType = getPath(firstListing, ["Availability", "Type"]);
  const availabilityMessage = cleanText(
    getPath(firstListing, ["Availability", "Message"]),
    100,
  );

  return {
    name: cleanText(getPath(firstItem, ["ItemInfo", "Title", "DisplayValue"]), 500),
    price_amount: price == null ? null : Math.round(price),
    currency: cleanText(getPath(firstListing, ["Price", "Currency"]), 3) ?? "JPY",
    availability_status: mapAvailability(availabilityType ?? availabilityMessage),
    availability_label: availabilityMessage,
    error_code: null,
    error_message: null,
  };
}

async function fetchProviderMetadata(
  credentials: ProductApiCredentialValues,
  identity: ProductIdentity,
  now: Date,
): Promise<ProviderMetadata> {
  try {
    if (identity.sourceSite === "rakuten") {
      return await fetchRakutenMetadata(credentials, identity);
    }
    if (identity.sourceSite === "yahoo") {
      return await fetchYahooMetadata(credentials, identity);
    }
    if (identity.sourceSite === "amazon") {
      return await fetchAmazonMetadata(credentials, identity, now);
    }
    return providerError("unsupported_site", "This URL is not supported", "unsupported");
  } catch (error) {
    return providerError(
      "metadata_fetch_failed",
      error instanceof Error ? error.message : "metadata fetch failed",
    );
  }
}

export async function lookupProductMetadata(
  env: Env,
  rawUrl: string,
  options: { force?: boolean } = {},
): Promise<ProductMetadata | null> {
  let identity = parseProductUrl(rawUrl);
  if (!identity) return null;

  if (identity.sourceSite === "amazon" && !identity.sourceProductId) {
    try {
      const resolvedUrl = await resolveProductUrl(identity.fetchUrl);
      const resolvedIdentity = parseProductUrl(resolvedUrl);
      if (resolvedIdentity?.sourceSite === "amazon") {
        identity = resolvedIdentity;
      }
    } catch {
      // Keep the original URL so callers receive cached OGP/error metadata instead of a hard failure.
    }
  }

  const db = createDb(env);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(productMetadataCache)
    .where(eq(productMetadataCache.normalized_url, identity.normalizedUrl));
  if (existing && !options.force && isFresh(existing, now)) {
    return jsonResponseMetadata(existing);
  }

  const credentials = await loadProductApiCredentials(env);
  const [provider, og] = await Promise.all([
    fetchProviderMetadata(credentials, identity, now),
    fetchOgMetadata(identity.fetchUrl),
  ]);
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  const values = {
    normalized_url: identity.normalizedUrl,
    source_site: identity.sourceSite,
    source_product_id: identity.sourceProductId,
    name: provider.name ?? og.og_title,
    price_amount: provider.price_amount,
    currency: provider.currency,
    availability_status: provider.availability_status,
    availability_label: provider.availability_label,
    og_title: og.og_title,
    og_description: og.og_description,
    og_image_url: og.og_image_url,
    og_site_name: og.og_site_name,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    error_code: provider.error_code,
    error_message: provider.error_message,
    updated_at: fetchedAt,
  };

  if (existing) {
    const [row] = await db
      .update(productMetadataCache)
      .set(values)
      .where(eq(productMetadataCache.id, existing.id))
      .returning();
    return row ? jsonResponseMetadata(row) : null;
  }

  const [row] = await db.insert(productMetadataCache).values(values).returning();
  return row ? jsonResponseMetadata(row) : null;
}
