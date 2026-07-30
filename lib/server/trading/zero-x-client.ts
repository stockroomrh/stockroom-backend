import "server-only";

/**
 * 0x Swap API v2 client — AllowanceHolder flow (a plain ERC-20 `approve` to
 * a fixed spender contract followed by the returned swap transaction).
 * Deliberately not the Permit2 flow: that trades a second onchain approve
 * for an off-chain EIP-712 signature the client must byte-pack into the
 * transaction calldata, which needs live docs to get exactly right and
 * couldn't be verified against 0x's current documentation in this
 * environment. AllowanceHolder is the well-established, lower-risk shape:
 * two ordinary transactions, both reviewed and signed by the operator in
 * their own wallet — never anything this server signs or holds.
 *
 * docs.0x.org was not reachable for live verification in this environment
 * (returned JS-shell/404 content to automated fetches). Field names below
 * reflect the documented v2 AllowanceHolder quote shape; every field this
 * client depends on is validated before use rather than trusted blindly —
 * see assertExecutableQuote below.
 */

const ZEROX_BASE_URL = "https://api.0x.org";

export function isZeroXConfigured(): boolean {
  return Boolean(process.env.ZEROX_API_KEY);
}

export class ZeroXError extends Error {}

export type ZeroXQuote = {
  buyAmount: string;
  minBuyAmount: string;
  totalNetworkFee: string | null;
  integratorFee: string | null;
  /** Basis points, when 0x reports it — null when not present in the response. */
  priceImpactBps: number | null;
  /** The address the sell token must be approved for (the AllowanceHolder contract). */
  allowanceTarget: string;
  transaction: { to: string; data: string; value: string; gas: string | null };
};

type RawZeroXQuoteResponse = {
  liquidityAvailable?: boolean;
  buyAmount?: string;
  minBuyAmount?: string;
  totalNetworkFee?: string;
  fees?: { integratorFee?: { amount?: string } | null };
  priceImpact?: number | string | null;
  // Top-level, always present — NOT nested under issues.allowance.spender,
  // which is only populated when an *additional* ERC-20 approve is still
  // needed beyond what's already granted. It's null for a sell of native
  // ETH (no approval possible/needed) or when an approval already exists,
  // even though allowanceTarget itself is always present either way.
  allowanceTarget?: string;
  issues?: { allowance?: { spender?: string } | null; balance?: unknown };
  transaction?: { to?: string; data?: string; value?: string; gas?: string };
};

function toBpsOrNull(priceImpact: number | string | null | undefined): number | null {
  if (priceImpact === null || priceImpact === undefined) return null;
  const value = typeof priceImpact === "string" ? Number(priceImpact) : priceImpact;
  if (!Number.isFinite(value)) return null;
  // 0x reports price impact as a decimal fraction (e.g. 0.012 = 1.2%).
  return Math.round(value * 10_000);
}

/**
 * Requests a firm, executable swap quote. Throws ZeroXError with 0x's own
 * error message on any non-2xx response (including an unsupported chain —
 * Robinhood Chain testnet is not confirmed supported by 0x; only mainnet
 * chain ID 4663 is per Robinhood's own documentation) or when the response
 * is missing a field this client cannot safely proceed without.
 */
export async function getSwapQuote(input: {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
}): Promise<ZeroXQuote> {
  if (!isZeroXConfigured()) throw new ZeroXError("Trading is not configured yet (ZEROX_API_KEY is missing).");

  const params = new URLSearchParams({
    chainId: String(input.chainId),
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    sellAmount: input.sellAmount,
    taker: input.taker,
  });

  let response: Response;
  try {
    response = await fetch(`${ZEROX_BASE_URL}/swap/allowance-holder/quote?${params.toString()}`, {
      headers: { "0x-api-key": process.env.ZEROX_API_KEY!, "0x-version": "v2" },
    });
  } catch (cause) {
    throw new ZeroXError(`Could not reach 0x: ${cause instanceof Error ? cause.message : "network error"}.`);
  }

  const body = (await response.json().catch(() => null)) as RawZeroXQuoteResponse | null;

  if (!response.ok) {
    const message = (body as { reason?: string; message?: string; validationErrors?: { reason?: string }[] } | null);
    const detail = message?.reason ?? message?.message ?? message?.validationErrors?.[0]?.reason ?? `0x returned HTTP ${response.status}.`;
    throw new ZeroXError(detail);
  }
  if (!body || body.liquidityAvailable === false) {
    throw new ZeroXError("No liquidity is currently available for this swap.");
  }

  return assertExecutableQuote(body);
}

function assertExecutableQuote(body: RawZeroXQuoteResponse): ZeroXQuote {
  const allowanceTarget = body.allowanceTarget;
  const tx = body.transaction;
  if (!body.buyAmount || !allowanceTarget || !tx?.to || !tx?.data) {
    throw new ZeroXError("0x did not return an executable quote (missing transaction or allowance target).");
  }
  return {
    buyAmount: body.buyAmount,
    minBuyAmount: body.minBuyAmount ?? body.buyAmount,
    totalNetworkFee: body.totalNetworkFee ?? null,
    integratorFee: body.fees?.integratorFee?.amount ?? null,
    priceImpactBps: toBpsOrNull(body.priceImpact),
    allowanceTarget,
    transaction: { to: tx.to, data: tx.data, value: tx.value ?? "0", gas: tx.gas ?? null },
  };
}
