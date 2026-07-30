"use client";

import { useState } from "react";
import { keccak256, parseUnits, parseEventLogs, toBytes, zeroAddress } from "viem";
import { useAccount, useDeployContract, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { createLocalProject } from "@/lib/services";
import type { LaunchProjectInput, ProjectBundle } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { activeChain, activeChainId, ROBINHOOD_MAINNET_ID } from "@/lib/chain-config";
import { createAssetRules } from "@/lib/asset-catalog";
import { SupportedAssets } from "@/components/SupportedAssets";
import { useMode } from "@/components/mode/ModeProvider";
import { useAuth } from "@/components/mode/AuthProvider";
import { ImageUpload } from "@/components/mode/ImageUpload";
import { STOCKROOM_TOKEN_ABI, STOCKROOM_TOKEN_BYTECODE } from "@/lib/contracts/stockroom-token";
import { PONS_LAUNCH_FACTORY_ABI, PONS_LAUNCH_FACTORY_ADDRESS } from "@/lib/contracts/pons-launch-factory";

const steps = ["Project details","Token configuration","Treasury configuration","Treasury policy","Treasury Agent","Review & launch"];

const initialForm: LaunchProjectInput = {
  projectName: "",
  projectSymbol: "",
  description: "",
  website: "",
  tokenName: "",
  tokenSymbol: "",
  totalSupply: 1_000_000_000,
  decimals: 18,
  initialReserve: 10_000,
  revenueRouting: "100% to treasury",
  minimumReserve: 60,
  maximumSingleAsset: 20,
  maximumCrypto: 15,
  maximumTrade: 10,
  treasuryObjective: "Maintain transparent reserves and grow the treasury within a deterministic mandate.",
  riskApproach: "Balanced",
  reportingFrequency: "Weekly",
  assetRules: createAssetRules(["USDG", "ETH", "NVDA", "AAPL", "SPY"], 20),
  treasuryAddress: "",
};

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

type TokenDeployStatus = "idle" | "deploying" | "waiting" | "recording" | "deployed" | "failed";

export function LaunchWizard() {
  const { mode } = useMode();
  const { session } = useAuth();
  const isLive = mode === "live";
  const { address: connectedAddress, chainId: connectedChainId } = useAccount();
  const publicClient = usePublicClient();
  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LaunchProjectInput>(initialForm);
  const [created, setCreated] = useState<ProjectBundle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenDeployStatus, setTokenDeployStatus] = useState<TokenDeployStatus>("idle");
  const [tokenDeployError, setTokenDeployError] = useState<string | null>(null);
  const update = <K extends keyof LaunchProjectInput>(key: K, value: LaunchProjectInput[K]) => setForm((current)=>({ ...current, [key]: value }));
  const treasuryAddressValid = !isLive || EVM_ADDRESS_PATTERN.test(form.treasuryAddress ?? "");
  const canContinue = step === 0
    ? Boolean(form.projectName.trim() && form.projectSymbol.trim() && form.description.trim())
    : step === 2
      ? treasuryAddressValid
      : true;

  // Deploys/launches the real token from the operator's OWN connected wallet
  // — this app never holds a key or acts on anyone's behalf. Called right
  // after the project row is created (so the treasury address it mints/fees
  // into already exists), and re-callable from the success screen if the
  // operator's wallet rejects or the tx fails, without re-running the whole
  // launch. Chain-branched: mainnet launches go through Pons (real market,
  // trading fees redirect to the treasury); testnet keeps the plain
  // StockroomToken.sol deployment, since Pons has no testnet deployment.
  const deployToken = async (bundle: ProjectBundle) => {
    if (!connectedAddress || !publicClient) {
      setTokenDeployStatus("failed");
      setTokenDeployError("Connect your wallet to deploy the token contract.");
      return;
    }
    setTokenDeployStatus("deploying");
    setTokenDeployError(null);
    try {
      // Never trust the wallet's currently-active network — force it onto
      // Robinhood Chain before sending anything. Without this, a wallet
      // left on its own default network (e.g. Ethereum mainnet) will
      // silently attempt the transaction there instead.
      if (connectedChainId !== activeChainId) {
        await switchChainAsync({ chainId: activeChainId });
      }

      if (activeChainId === ROBINHOOD_MAINNET_ID) {
        await launchViaPons(bundle);
      } else {
        await deployPlainToken(bundle);
      }
    } catch (cause) {
      setTokenDeployStatus("failed");
      setTokenDeployError(cause instanceof Error ? cause.message : "Token deployment failed.");
    }
  };

  const recordDeployment = async (bundle: ProjectBundle, contractAddress: string, deploymentTxHash: string, launchProvider: "stockroom" | "pons") => {
    setTokenDeployStatus("recording");
    const response = await fetch(`/api/projects/${bundle.project.slug}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, deploymentTxHash, launchProvider }),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseBody?.error ?? "Failed to record the deployment.");
    setCreated(responseBody as ProjectBundle);
    setTokenDeployStatus("deployed");
  };

  const deployPlainToken = async (bundle: ProjectBundle) => {
    if (!connectedAddress || !publicClient) return;
    const totalSupplyBaseUnits = parseUnits(String(bundle.project.token.totalSupply), 18);
    const hash = await deployContractAsync({
      chainId: activeChainId,
      abi: STOCKROOM_TOKEN_ABI,
      bytecode: STOCKROOM_TOKEN_BYTECODE,
      args: [
        bundle.project.token.name,
        bundle.project.token.symbol,
        totalSupplyBaseUnits,
        bundle.project.treasuryAddress as `0x${string}`,
        zeroAddress,
        0n,
        connectedAddress,
      ],
    });
    setTokenDeployStatus("waiting");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error("The deployment transaction did not succeed onchain.");
    }
    await recordDeployment(bundle, receipt.contractAddress, hash, "stockroom");
  };

  // Launches via Pons's live PonsLaunchFactory: a real Uniswap V3 market
  // from second one, with zero paired-liquidity capital required from the
  // creator (the pool is seeded entirely from the launch config's reserved
  // token supply) — only the small launchFee + gas. Setting feeWallet to
  // the treasury address routes all future trading fees there automatically.
  const launchViaPons = async (bundle: ProjectBundle) => {
    if (!connectedAddress || !publicClient) return;
    const configResponse = await fetch(`/api/projects/${bundle.project.slug}/pons-launch-config`);
    const configBody = await configResponse.json().catch(() => null);
    if (!configResponse.ok) throw new Error(configBody?.error ?? "Failed to resolve Pons launch configuration.");

    const salt = keccak256(toBytes(bundle.project.slug));
    const hash = await writeContractAsync({
      chainId: activeChainId,
      address: PONS_LAUNCH_FACTORY_ADDRESS,
      abi: PONS_LAUNCH_FACTORY_ABI,
      functionName: "launchToken",
      args: [
        {
          name: bundle.project.token.name,
          symbol: bundle.project.token.symbol,
          logo: bundle.project.logoUrl ?? "",
          description: bundle.project.description,
          socials: {
            twitter: "",
            telegram: "",
            discord: "",
            website: bundle.project.socials?.website ?? "",
            farcaster: "",
          },
          feeWallet: bundle.project.treasuryAddress as `0x${string}`,
        },
        BigInt(configBody.launchConfigId),
        BigInt(configBody.dexId),
        salt,
      ],
      value: BigInt(configBody.launchFee),
    });
    setTokenDeployStatus("waiting");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The launch transaction did not succeed onchain.");

    const events = parseEventLogs({
      abi: PONS_LAUNCH_FACTORY_ABI,
      eventName: "TokenLaunched",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === PONS_LAUNCH_FACTORY_ADDRESS.toLowerCase()),
    });
    const launchEvent = events[0];
    if (!launchEvent) throw new Error("No TokenLaunched event was found on the confirmed transaction.");

    await recordDeployment(bundle, launchEvent.args.token, hash, "pons");
  };

  const launch = async () => {
    if (isLive && !session) {
      setError("Connect and sign in with a wallet before launching a live project.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const next = await createLocalProject({
        ...form,
        tokenName: form.tokenName || `${form.projectName} Token`,
        tokenSymbol: form.tokenSymbol || form.projectSymbol,
      });
      setCreated(next);
      // Not awaited — the success screen renders immediately and shows its
      // own live deployment status while this continues in the background.
      if (isLive) void deployToken(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to create the ${isLive ? "" : "mock "}project`);
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    const publicUrl = `/app/project/${created.project.slug}`;
    const isPonsLaunch = activeChainId === ROBINHOOD_MAINNET_ID;
    const explorerBase = activeChain.blockExplorers.default.url;
    const deployedAddress = created.project.token.contract;
    return <div className="launch-success"><div className="success-badge">✓</div><span className="eyebrow">{isLive ? "Project published" : "Frontend mock launch complete"}</span><h2>{created.project.name} is live</h2><p>{isLive ? "The project is published to Explore and My Projects. Its public treasury will populate once the treasury address is indexed." : "The project now appears in Explore and My Projects, with generated public treasury, token, Agent, activity and policy pages."}</p><div className="launch-created-summary"><div><span>Token</span><b>${created.project.ticker}</b></div><div><span>Treasury</span><b>{created.summary ? formatCurrency(created.summary.value) : "Not indexed yet"}</b></div><div><span>Policy</span><b>v{created.policy.version}</b></div><div><span>Approval</span><b>Human required</b></div></div>
      {isLive && <div className="form-note full" style={{marginTop:16,marginBottom:16}}>
        {deployedAddress ? <><strong>{created.project.token.launchProvider === "pons" ? "Token launched on Pons — real market is live." : "Token deployed onchain."}</strong><span><a href={explorerBase ? `${explorerBase}/address/${deployedAddress}` : "#"} target="_blank" rel="noreferrer">{deployedAddress}</a>{created.project.token.launchProvider === "pons" && <> · trading fees redirect to this project&apos;s treasury automatically</>}</span></>
          : tokenDeployStatus === "deploying" ? <><strong>{isPonsLaunch ? "Launching on Pons…" : "Deploying token…"}</strong><span>Confirm the transaction in your wallet.</span></>
          : tokenDeployStatus === "waiting" ? <><strong>{isPonsLaunch ? "Launching on Pons…" : "Deploying token…"}</strong><span>Waiting for the transaction to confirm onchain.</span></>
          : tokenDeployStatus === "recording" ? <><strong>{isPonsLaunch ? "Launching on Pons…" : "Deploying token…"}</strong><span>Recording the launch.</span></>
          : tokenDeployStatus === "failed" ? <><strong>Token {isPonsLaunch ? "launch" : "deployment"} failed.</strong><span>{tokenDeployError} </span><button className="secondary-button" onClick={()=>void deployToken(created)}>Retry {isPonsLaunch ? "launch" : "deployment"}</button></>
          : <><strong>Token not {isPonsLaunch ? "launched" : "deployed"} yet.</strong><span>The project was published, but the token {isPonsLaunch ? "hasn't launched on Pons" : "contract hasn't been deployed"}. </span><button className="secondary-button" onClick={()=>void deployToken(created)}>{isPonsLaunch ? "Launch on Pons" : "Deploy token"}</button></>}
      </div>}
      <div className="success-actions"><a className="primary-button" href={`/app/dashboard/projects/${created.project.slug}/operator`}>Open Operator Dashboard</a><a className="secondary-button" href={publicUrl}>View Public Project</a><button className="secondary-button" onClick={()=>navigator.clipboard?.writeText(`${window.location.origin}${publicUrl}`)}>Share Launch</button></div><button className="text-button" onClick={()=>{setCreated(null);setStep(0);setTokenDeployStatus("idle");setTokenDeployError(null);setForm({...initialForm, assetRules: createAssetRules(["USDG", "ETH", "NVDA", "AAPL", "SPY"], 20)})}}>Launch another project</button></div>;
  }

  return <div className="launch-layout">
    <aside className="steps-list">{steps.map((name,index)=><button type="button" key={name} className={index===step?"active":index<step?"complete":""} onClick={()=>setStep(index)}><span>{index<step?"✓":index+1}</span><div><b>{name}</b><small>{["Identity, links and description","Supply and launch structure","Reserve and revenue routing","Deterministic treasury guardrails","Objectives and reporting","Confirm what Stockroom creates"][index]}</small></div></button>)}</aside>
    <section className="wizard-card"><div className="wizard-head"><span>Step {step+1} of 6</span><h2>{steps[step]}</h2></div>
      {isLive && !session && <div className="form-note full" style={{marginBottom:16}}><strong>Wallet sign-in required.</strong><span>Connect and sign in with a wallet (top right) before you can publish a live project. You can still fill out the form.</span></div>}
      {step===0&&<div className="form-grid"><label>Project name<input value={form.projectName} onChange={(event)=>update("projectName",event.target.value)} placeholder="e.g. Meridian"/></label><label>Project symbol<input value={form.projectSymbol} onChange={(event)=>update("projectSymbol",event.target.value.toUpperCase())} placeholder="e.g. MRDN" maxLength={8}/></label><label className="full">Description<textarea value={form.description} onChange={(event)=>update("description",event.target.value)} placeholder="What is the project and what will its public treasury support?"/></label><label>Website<input value={form.website} onChange={(event)=>update("website",event.target.value)} placeholder="https://"/></label>{isLive ? <><label>Logo (pfp)<ImageUpload label="logo" value={form.logoUrl} onChange={(url)=>update("logoUrl",url)} folder="logos" shape="square"/></label><label>Banner<ImageUpload label="banner" value={form.bannerUrl} onChange={(url)=>update("bannerUrl",url)} folder="banners" shape="wide"/></label></> : <label>Logo upload<div className="upload-box">Frontend placeholder · repository asset later</div></label>}</div>}
      {step===1&&<div className="form-grid"><label>Token name<input value={form.tokenName} onChange={(event)=>update("tokenName",event.target.value)} placeholder={form.projectName?`${form.projectName} Token`:"Project Token"}/></label><label>Token symbol<input value={form.tokenSymbol} onChange={(event)=>update("tokenSymbol",event.target.value.toUpperCase())} placeholder={form.projectSymbol||"TOKEN"}/></label><label>Total supply<input type="number" min="1" value={form.totalSupply} onChange={(event)=>update("totalSupply",Number(event.target.value))}/></label><label>Decimals{isLive ? <input type="number" value={18} disabled/> : <input type="number" min="0" max="18" value={form.decimals} onChange={(event)=>update("decimals",Number(event.target.value))}/>}{isLive && <small>Fixed at 18 — the deployed contract doesn't support any other value.</small>}</label><label className="full">Launch method<select defaultValue="fixed"><option value="fixed">Fixed supply · mock deployment</option><option value="configurable">Configurable launch settings</option></select></label><div className="form-note full"><strong>{isLive ? "Deployed at publish." : "Frontend only."}</strong><span>{isLive ? "The token contract deploys from your connected wallet as part of publishing — you'll be asked to confirm it right after the project is created." : "No token contract, liquidity or onchain deployment is created in this stage."}</span></div></div>}
      {step===2&&<div className="form-grid"><label>Treasury name<input value={`${form.projectName||"Project"} Treasury`} readOnly/></label><label>Base currency<select><option>USDG</option></select></label><label>Initial reserve (USDG)<input type="number" min="1000" value={form.initialReserve} onChange={(event)=>update("initialReserve",Number(event.target.value))}/></label><label>Revenue routing<select value={form.revenueRouting} onChange={(event)=>update("revenueRouting",event.target.value)}><option>100% to treasury</option><option>80% treasury / 20% operations</option><option>Custom split</option></select></label>{isLive ? <label className="full">Treasury wallet address<input value={form.treasuryAddress ?? ""} onChange={(event)=>update("treasuryAddress",event.target.value.trim())} placeholder="0x… an existing wallet, multisig or smart account you control"/>{form.treasuryAddress && !treasuryAddressValid && <small style={{color:"var(--red)"}}>Enter a valid 0x address.</small>}</label> : <label className="full">Treasury wallet<input placeholder="Generated after backend integration" disabled/></label>}<div className="form-note full"><strong>{isLive ? "Stockroom never generates or holds this wallet's key." : "What Stockroom will create later:"}</strong><span>{isLive ? "Use a wallet, multisig or smart account you already control. The application only ever reads its balance until you sign a transaction yourself." : "A public treasury wallet, indexed balance sheet and operator permissions."}</span></div></div>}
      {step===3&&<div className="policy-form"><PolicyControl name="Minimum USDG reserve" value={form.minimumReserve} onChange={(value)=>update("minimumReserve",value)}/><PolicyControl name="Maximum single asset" value={form.maximumSingleAsset} onChange={(value)=>{update("maximumSingleAsset",value);update("assetRules",form.assetRules.map((rule)=>rule.symbol==="USDG"?rule:{...rule,maxAllocation:Math.min(rule.maxAllocation,value)}))}}/><PolicyControl name="Maximum crypto exposure" value={form.maximumCrypto} onChange={(value)=>update("maximumCrypto",value)}/><PolicyControl name="Maximum trade size" value={form.maximumTrade} onChange={(value)=>update("maximumTrade",value)}/><div className="form-note"><strong>Human approval is mandatory.</strong><span>The Treasury Agent can never sign transactions or change these rules.</span></div><SupportedAssets rules={form.assetRules} onChange={(rules)=>update("assetRules",rules)}/></div>}
      {step===4&&<div className="form-grid"><label className="full">Treasury objective<textarea value={form.treasuryObjective} onChange={(event)=>update("treasuryObjective",event.target.value)}/></label><label>Risk approach<select value={form.riskApproach} onChange={(event)=>update("riskApproach",event.target.value)}><option>Conservative</option><option>Balanced</option><option>Growth</option></select></label><label>Reporting frequency<select value={form.reportingFrequency} onChange={(event)=>update("reportingFrequency",event.target.value)}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label className="full">Recommendation preference<select><option>Policy-first, conservative proposals</option><option>Opportunity-aware within policy</option></select></label><div className="form-note full"><strong>Treasury Agent role:</strong><span>Monitor, analyse, report and propose. Never control the keys.</span></div></div>}
      {step === 5 && (
        <div className="review-grid">
          <ReviewBox label="Project" value={(form.projectName || "Untitled project") + " / $" + (form.projectSymbol || "—")} />
          <ReviewBox label="Token" value={`${form.totalSupply.toLocaleString()} fixed supply`} />
          <ReviewBox label="Treasury" value={isLive ? (form.treasuryAddress || "No address entered") : `${formatCurrency(form.initialReserve, 0)} initial USDG reserve`} />
          <ReviewBox label="Policy" value={`${form.minimumReserve}% reserve · ${form.assetRules.filter((rule)=>rule.approved).length} approved assets`} />
          <ReviewBox label="Treasury Agent" value={`${form.riskApproach} · ${form.reportingFrequency} reports`} />
          <ReviewBox label="Execution" value="Human wallet approval required" />
          <div className="created-items full">
            <strong>{isLive ? "Publishing this project creates:" : "This mock launch creates:"}</strong>
            <span>Public project profile</span><span>Token information page</span><span>Public treasury dashboard</span>
            <span>Treasury Agent report</span><span>Activity ledger</span><span>Policy page</span><span>Private operator workspace</span>
          </div>
        </div>
      )}
      {error&&<div className="form-error">{error}</div>}
      <div className="wizard-actions"><button className="secondary-button" onClick={()=>setStep(Math.max(0,step-1))} disabled={step===0}>Back</button>{step<5?<button className="primary-button" onClick={()=>setStep(step+1)} disabled={!canContinue}>Continue</button>:<button className="primary-button" onClick={launch} disabled={submitting || (isLive && !session)}>{submitting?"Creating project…":isLive?"Publish project":"Create mock project"}</button>}</div>
    </section>
  </div>;
}

function PolicyControl({name,value,onChange}:{name:string;value:number;onChange:(value:number)=>void}){return <div className="policy-control"><div><b>{name}</b><span>{value}%</span></div><input type="range" min="0" max="100" value={value} onChange={(event)=>onChange(Number(event.target.value))}/></div>}
function ReviewBox({label,value}:{label:string;value:string}){return <div className="review-box"><span>{label}</span><strong>{value}</strong></div>}
