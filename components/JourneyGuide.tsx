import Link from "next/link";

const steps = [
  { number: "01", title: "Explore or launch", text: "Browse public treasuries or start a new token-backed project." },
  { number: "02", title: "Set the mandate", text: "Choose reserves, approved assets and strict allocation limits." },
  { number: "03", title: "Agent monitors", text: "The Treasury Agent reports risks and creates policy-bound proposals." },
  { number: "04", title: "Humans approve", text: "An authorised operator reviews the quote and signs every trade." },
] as const;

export function JourneyGuide({ compact = false }: { compact?: boolean }) {
  return <section className={`journey-guide ${compact ? "compact" : ""}`}>
    <div className="journey-intro"><span className="mini-label">How Stockroom works</span><h2>From launch to a public balance sheet.</h2><p>The Agent proposes. Policy validates. Humans control the keys.</p><div><Link className="primary-button" href="/app/launch">Launch a project</Link><Link className="secondary-button" href="/app/dashboard">Open My Projects</Link></div></div>
    <div className="journey-steps">{steps.map((step)=><article key={step.number}><span>{step.number}</span><strong>{step.title}</strong><p>{step.text}</p></article>)}</div>
  </section>;
}
