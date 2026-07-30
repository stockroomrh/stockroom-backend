"use client";

import { useState } from "react";
import { erc20Abi, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { StatusBadge } from "@/components/UI";
import { activeChain, activeChainId, NATIVE_ETH_SENTINEL } from "@/lib/chain-config";
import type { ProjectBundle, Recommendation } from "@/lib/types";

type LiveQuote = {
  quoteId: string;
  recommendationId: string;
  sellTokenSymbol: string;
  sellTokenAddress: Address;
  sellTokenDecimals: number;
  buyTokenSymbol: string;
  buyTokenAddress: Address;
  buyTokenDecimals: number;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  allowanceTarget: Address;
  transactionTarget: Address;
  transactionData: Hex;
  transactionValue: string;
  estimatedGas: string | null;
  priceImpactBps: number | null;
  expiresAt: string;
};

type Phase = "idle" | "quoting" | "checking-allowance" | "approving" | "swapping" | "confirming" | "confirmed" | "failed";

function formatTokenAmount(raw: string, decimals: number) {
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function phaseLabel(phase: Phase) {
  switch (phase) {
    case "checking-allowance": return "Checking allowance…";
    case "approving": return "Approve in your wallet…";
    case "swapping": return "Sign the swap in your wallet…";
    case "confirming": return "Waiting for onchain confirmation…";
    case "confirmed": return "Trade confirmed";
    default: return "Approve & sign swap";
  }
}

/**
 * The real, human-signed trade flow: request a live 0x quote, approve the
 * exact sell amount onchain if needed, sign and broadcast the swap, then
 * poll the server for a verified confirmation. Every signature happens in
 * the operator's own wallet — this component never holds a key and the
 * server never signs or broadcasts anything on its own.
 */
export function LiveSwapPanel({
  slug,
  recommendation,
  treasuryAddress,
  onExecuted,
}: {
  slug: string;
  recommendation: Recommendation;
  treasuryAddress: string;
  onExecuted: (bundle: ProjectBundle) => void;
}) {
  const { address: connectedAddress, chainId: connectedChainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);

  const walletMatches = Boolean(connectedAddress) && connectedAddress!.toLowerCase() === treasuryAddress.toLowerCase();
  const busy = !["idle", "failed"].includes(phase);

  const requestQuote = async () => {
    setError(null);
    setPhase("quoting");
    setQuote(null);
    setSwapTxHash(null);
    try {
      const response = await fetch(`/api/projects/${slug}/recommendations/${recommendation.id}/quote`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to fetch a quote.");
      setQuote(body as LiveQuote);
      setPhase("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to fetch a quote.");
      setPhase("idle");
    }
  };

  const executeSwap = async () => {
    if (!quote || !publicClient || !connectedAddress) return;
    setError(null);
    try {
      // Never trust the wallet's currently-active network — force it onto
      // Robinhood Chain before signing anything. Without this, a wallet
      // left on its own default network can silently attempt these
      // transactions there instead of the treasury's actual chain.
      if (connectedChainId !== activeChainId) {
        await switchChainAsync({ chainId: activeChainId });
      }

      // Native ETH has no contract to hold an allowance on — selling it
      // needs no approve step at all, and calling allowance()/approve()
      // against the native-ETH sentinel address would revert (no code
      // deployed there). Only ERC-20 sells go through the allowance flow.
      const isNativeEthSell = quote.sellTokenAddress.toLowerCase() === NATIVE_ETH_SENTINEL.toLowerCase();
      let approvalHash: string | undefined;
      if (!isNativeEthSell) {
        setPhase("checking-allowance");
        const currentAllowance = await publicClient.readContract({
          address: quote.sellTokenAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [connectedAddress, quote.allowanceTarget],
        });

        if (currentAllowance < BigInt(quote.sellAmount)) {
          setPhase("approving");
          approvalHash = await writeContractAsync({
            chainId: activeChainId,
            address: quote.sellTokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.allowanceTarget, BigInt(quote.sellAmount)],
          });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash as Hex });
        }
      }

      setPhase("swapping");
      const hash = await sendTransactionAsync({
        chainId: activeChainId,
        to: quote.transactionTarget,
        data: quote.transactionData,
        value: BigInt(quote.transactionValue || "0"),
      });
      setSwapTxHash(hash);

      const recordResponse = await fetch(`/api/projects/${slug}/recommendations/${recommendation.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId: quote.quoteId, swapTxHash: hash, approvalTxHash: approvalHash ?? null }),
      });
      const recordBody = await recordResponse.json();
      if (!recordResponse.ok) throw new Error(recordBody.error ?? "Failed to record the trade.");

      setPhase("confirming");
      const executionId = recordBody.executionId as string;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const statusResponse = await fetch(`/api/projects/${slug}/recommendations/${recommendation.id}/execute/${executionId}`);
        const statusBody = await statusResponse.json();
        if (statusBody.status === "confirmed") {
          setPhase("confirmed");
          if (statusBody.bundle) onExecuted(statusBody.bundle as ProjectBundle);
          return;
        }
        if (statusBody.status === "failed") {
          setPhase("failed");
          setError(statusBody.failureReason ?? "The swap transaction failed onchain.");
          return;
        }
      }
      setPhase("idle");
      setError("Still waiting for confirmation — check Blockscout directly; this can take longer during network congestion.");
    } catch (cause) {
      setPhase("failed");
      setError(cause instanceof Error ? cause.message : "Trade execution failed.");
    }
  };

  if (!connectedAddress || !walletMatches) {
    return <div className="policy-result compact blocked">
      <div className="check-icon">!</div>
      <div><strong>Connect the treasury wallet</strong><p>{connectedAddress ? `Connected as ${connectedAddress}. Sign in with the treasury wallet (${treasuryAddress}) to trade.` : `Sign in with the treasury wallet (${treasuryAddress}) to trade.`}</p></div>
    </div>;
  }

  if (recommendation.status !== "Approved") {
    return <div className="quote-placeholder">Approve this recommendation before requesting a quote.</div>;
  }

  return <div className="live-swap-panel">
    {error && <div className="form-error">{error}</div>}
    {!quote ? (
      <button className="secondary-button" onClick={requestQuote} disabled={phase === "quoting"}>{phase === "quoting" ? "Requesting quote…" : "Request live quote"}</button>
    ) : <>
      <div className="quote-details">
        <div><span>Sell</span><b>{formatTokenAmount(quote.sellAmount, quote.sellTokenDecimals)} {quote.sellTokenSymbol}</b></div>
        <div><span>Expected receive</span><b>{formatTokenAmount(quote.buyAmount, quote.buyTokenDecimals)} {quote.buyTokenSymbol}</b></div>
        <div><span>Minimum receive</span><b>{formatTokenAmount(quote.minBuyAmount, quote.buyTokenDecimals)} {quote.buyTokenSymbol}</b></div>
        {quote.priceImpactBps !== null && <div><span>Price impact</span><b>{(quote.priceImpactBps / 100).toFixed(2)}%</b></div>}
        <div><span>Approval spender</span><b className="mono">{quote.allowanceTarget}</b></div>
      </div>
      <div className="quote-request-row">
        <button className="secondary-button" onClick={requestQuote} disabled={busy}>Refresh quote</button>
        {phase === "confirmed" && swapTxHash ? (
          <a href={`${activeChain.blockExplorers.default.url}/tx/${swapTxHash}`} target="_blank" rel="noreferrer">
            <StatusBadge tone="green">Confirmed ↗</StatusBadge>
          </a>
        ) : phase === "confirmed" ? (
          <StatusBadge tone="green">Confirmed</StatusBadge>
        ) : null}
      </div>
      <div className="card-actions">
        <button className="primary-button" onClick={executeSwap} disabled={busy || phase === "confirmed"}>{phaseLabel(phase)}</button>
      </div>
      {swapTxHash && (
        <small className="muted">
          Swap tx: <a href={`${activeChain.blockExplorers.default.url}/tx/${swapTxHash}`} target="_blank" rel="noreferrer">{swapTxHash}</a>
        </small>
      )}
    </>}
  </div>;
}
