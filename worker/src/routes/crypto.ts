import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, type Env } from "../db";
import { accounts, cryptoWallets, exchangeCredentials } from "../db/schema";

const router = new Hono<{ Bindings: Env }>();

// Solana RPC endpoints — tried in order until one succeeds
const SOLANA_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana.publicnode.com",
];
// Seeker (SKR) SPL token mint address
const SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
// mSOL (Marinade staked SOL) mint address
const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";

/** Post a JSON-RPC request to Solana, trying each RPC endpoint in order. */
async function solanaRpc<T>(body: unknown): Promise<T> {
  let lastError: unknown;
  for (const rpc of SOLANA_RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${rpc}`);
        continue;
      }
      const data = (await res.json()) as {
        result?: T;
        error?: { message: string };
      };
      if (data.error) {
        lastError = new Error(data.error.message);
        continue;
      }
      return data.result as T;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Detect chain from address format.
 *  Returns null for .skr / .sol domains — those require resolution first.
 */
function detectChain(address: string): "eth" | "btc" | "sol" | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return "eth";
  if (/^bc1[a-zA-Z0-9]{6,87}$/.test(address)) return "btc";
  // BTC P2PKH / P2SH: starts with 1 or 3, 25–34 chars total
  if (/^[13][a-zA-Z0-9]{24,33}$/.test(address)) return "btc";
  // Solana: base58, 32–44 chars (any remaining after BTC is ruled out)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "sol";
  return null;
}

// ── GET /api/crypto/resolve?domain=dasan.skr ──────────────────────────────
// Attempts to resolve an AllDomains (.skr) or SNS (.sol) name to a wallet.
// Uses the Bonfida SNS proxy for .sol and AllDomains for .skr.
router.get("/resolve", async (c) => {
  const domain = c.req.query("domain")?.trim().toLowerCase();
  if (!domain) return c.json({ error: "domain is required" }, 400);

  const parts = domain.split(".");
  if (parts.length !== 2)
    return c.json({ error: "invalid domain format" }, 400);

  const [name, tld] = parts as [string, string];

  try {
    if (tld === "sol") {
      // Bonfida SNS public proxy
      const res = await fetch(
        `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${name}`,
      );
      if (!res.ok) return c.json({ error: "Domain not found" }, 404);
      const data = (await res.json()) as { result: string };
      return c.json({ domain, address: data.result });
    }

    if (tld === "skr") {
      // AllDomains public resolution API
      const res = await fetch(
        `https://api.alldomains.id/v1/resolve?domainName=${name}.${tld}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { owner?: string; address?: string };
        const address = data.owner ?? data.address;
        if (address) return c.json({ domain, address });
      }
      return c.json(
        {
          error:
            "Could not resolve domain automatically. " +
            "Please visit alldomains.id to find your raw wallet address.",
        },
        404,
      );
    }

    return c.json({ error: `Unsupported TLD: .${tld}` }, 400);
  } catch {
    return c.json({ error: "Resolution failed" }, 502);
  }
});

// ── GET /api/crypto/balance?address=&chain= ───────────────────────────────
router.get("/balance", async (c) => {
  const address = c.req.query("address");
  const chain = c.req.query("chain") as
    | "eth"
    | "btc"
    | "sol"
    | "skr"
    | "msol"
    | "sol_stake"
    | "binance"
    | undefined;
  if (!address || !chain) {
    return c.json({ error: "address and chain are required" }, 400);
  }

  try {
    if (chain === "eth") {
      const res = await fetch("https://cloudflare-eth.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [address, "latest"],
          id: 1,
        }),
      });
      const data = (await res.json()) as { result: string };
      return c.json({
        address,
        chain,
        amount: Number(BigInt(data.result)) / 1e18,
      });
    }

    if (chain === "btc") {
      const res = await fetch(
        `https://blockstream.info/api/address/${address}`,
      );
      if (!res.ok) return c.json({ error: "Failed to fetch BTC balance" }, 502);
      const data = (await res.json()) as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
      };
      const sats =
        data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
      return c.json({ address, chain, amount: sats / 1e8 });
    }

    if (chain === "sol") {
      const result = await solanaRpc<{ value: number }>({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address, { commitment: "confirmed" }],
      });
      const sol = result.value / 1e9; // lamports → SOL
      return c.json({ address, chain, amount: sol });
    }

    if (chain === "skr") {
      // Fetch SPL token balance for Seeker (SKR) mint
      // Note: use getTokenAccountsByOwner (not getParsedTokenAccountsByOwner —
      //        that method is unsupported on public RPC nodes).
      type TokenAccounts = {
        value: Array<{
          account: {
            data: {
              parsed: { info: { tokenAmount: { uiAmount: number | null } } };
            };
          };
        }>;
      };
      const result = await solanaRpc<TokenAccounts>({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          address,
          { mint: SKR_MINT },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      });
      const amount =
        result.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
      return c.json({ address, chain, amount });
    }

    if (chain === "msol") {
      // Fetch mSOL (Marinade staked SOL) SPL token balance
      // Note: use getTokenAccountsByOwner (not getParsedTokenAccountsByOwner —
      //        that method is unsupported on public RPC nodes).
      type TokenAccounts = {
        value: Array<{
          account: {
            data: {
              parsed: { info: { tokenAmount: { uiAmount: number | null } } };
            };
          };
        }>;
      };
      const result = await solanaRpc<TokenAccounts>({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          address,
          { mint: MSOL_MINT },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ],
      });
      const msolBalance =
        result.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;

      // Fetch mSOL/SOL exchange rate from Marinade's public API
      let exchangeRate = 1.0;
      try {
        const rateRes = await fetch(
          "https://api.marinade.finance/msol/price_sol",
        );
        if (rateRes.ok) {
          const rateData = (await rateRes.json()) as number | { value: number };
          exchangeRate =
            typeof rateData === "number" ? rateData : (rateData.value ?? 1.0);
        }
      } catch {
        // Fall back to 1:1 if the rate API is unavailable
      }

      // Return the SOL-equivalent amount so the frontend can value it with SOL price
      return c.json({ address, chain, amount: msolBalance * exchangeRate });
    }

    if (chain === "sol_stake") {
      // Fetch a native stake account balance directly by its address.
      // `getProgramAccounts` is blocked on public RPCs, so the user must provide
      // the stake account address (visible in their wallet or on Marinade's dashboard).
      const result = await solanaRpc<{
        value: { lamports: number } | null;
      }>({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address, { encoding: "jsonParsed", commitment: "confirmed" }],
      });
      if (!result.value) {
        return c.json({ error: "Stake account not found" }, 404);
      }
      return c.json({
        address,
        chain,
        amount: result.value.lamports / 1e9,
      });
    }

    if (chain === "binance") {
      const db = createDb(c.env);
      const [cred] = await db
        .select()
        .from(exchangeCredentials)
        .where(eq(exchangeCredentials.exchange, "binance"))
        .limit(1);
      if (!cred) {
        return c.json({ error: "Binance credentials not configured" }, 503);
      }
      const apiKey = cred.api_key;
      const secret = cred.api_secret;
      const ts = Date.now();
      const qs = `timestamp=${ts}`;
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuf = await crypto.subtle.sign(
        "HMAC",
        keyMaterial,
        new TextEncoder().encode(qs),
      );
      const sigHex = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const res = await fetch(
        `https://api.binance.com/api/v3/account?${qs}&signature=${sigHex}`,
        { headers: { "X-MBX-APIKEY": apiKey } },
      );
      if (!res.ok) return c.json({ error: "Binance API error" }, 502);
      const data = (await res.json()) as {
        balances: { asset: string; free: string; locked: string }[];
      };
      const entry = data.balances.find(
        (b) => b.asset === address.toUpperCase(),
      );
      const amount = entry
        ? parseFloat(entry.free) + parseFloat(entry.locked)
        : 0;
      return c.json({ address, chain, amount });
    }

    return c.json({ error: "Unsupported chain" }, 400);
  } catch {
    return c.json({ error: "Failed to fetch balance" }, 502);
  }
});

// ── GET /api/crypto ───────────────────────────────────────────────────────
router.get("/", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select({
      id: cryptoWallets.id,
      account_id: cryptoWallets.account_id,
      account_name: accounts.name,
      address: cryptoWallets.address,
      chain: cryptoWallets.chain,
      created_at: cryptoWallets.created_at,
    })
    .from(cryptoWallets)
    .innerJoin(accounts, eq(cryptoWallets.account_id, accounts.id));
  return c.json(rows);
});

// ── POST /api/crypto ──────────────────────────────────────────────────────
router.post("/", async (c) => {
  const body = await c.req.json<{
    account_id: number;
    address: string;
    chain?: string;
  }>();
  if (!body.account_id || !body.address) {
    return c.json({ error: "account_id and address are required" }, 400);
  }

  const trimmed = body.address.trim();

  // Allow explicit chain override (e.g. 'skr' for same Solana address as 'sol', or 'binance' for ticker)
  let chain: string | null = body.chain ?? null;
  const validChains = [
    "eth",
    "btc",
    "sol",
    "skr",
    "msol",
    "sol_stake",
    "binance",
  ];
  if (!chain || !validChains.includes(chain)) {
    const detected = detectChain(trimmed);
    if (!detected) {
      return c.json(
        {
          error:
            "Invalid or unsupported address. " +
            "If this is a .skr/.sol domain, resolve it first via /api/crypto/resolve. " +
            "For Binance assets, pass chain='binance' explicitly.",
        },
        400,
      );
    }
    chain = detected;
  }

  const db = createDb(c.env);
  const result = await db
    .insert(cryptoWallets)
    .values({ account_id: body.account_id, address: trimmed, chain })
    .returning();
  return c.json(result[0], 201);
});

// ── DELETE /api/crypto/:id ────────────────────────────────────────────────
router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const db = createDb(c.env);
  const deleted = await db
    .delete(cryptoWallets)
    .where(eq(cryptoWallets.id, id))
    .returning();
  if (deleted.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { router as cryptoRouter };
