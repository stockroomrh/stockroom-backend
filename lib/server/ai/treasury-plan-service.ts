import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TreasuryPlanSchema, type TreasuryPlanOutput } from "./treasury-plan-schema";
import { TREASURY_PLAN_SYSTEM_PROMPT, buildTreasuryPlanUserContent, type TreasuryPlanPromptInput } from "./treasury-plan-prompt";
import { isAnthropicConfigured } from "./cfo-service";

const MODEL = "claude-opus-5";
const PROMPT_VERSION = "plans-v1";

export type TreasuryPlanGenerationResult = {
  plan: TreasuryPlanOutput;
  /** null when no real model call produced this plan (not configured, or both attempts failed). */
  model: string | null;
  promptVersion: string;
};

/**
 * Deterministic, non-AI plan used when the model is unavailable or fails
 * validation twice. Proposes no trades — a plan with zero steps is a correct,
 * honest output here, not a fabricated one.
 */
function deterministicFallback(input: TreasuryPlanPromptInput): TreasuryPlanOutput {
  return {
    summary: `Automated fallback: the Treasury Agent's AI planning was unavailable, so no staged plan was produced for objective "${input.planObjective}".`,
    reserveTargetBps: null,
    allocationTargets: [],
    reviewCadence: "weekly",
    steps: [],
  };
}

/**
 * Generates one Treasury Plan from a stated objective. Never lets the model
 * decide policy compliance for any step — each step is independently
 * evaluated by lib/server/policy/policy-engine.ts before being stored as a
 * recommendation row.
 */
export async function generateTreasuryPlan(input: TreasuryPlanPromptInput): Promise<TreasuryPlanGenerationResult> {
  if (!isAnthropicConfigured()) {
    return { plan: deterministicFallback(input), model: null, promptVersion: PROMPT_VERSION };
  }

  const client = new Anthropic();
  const userContent = buildTreasuryPlanUserContent(input);

  const attempt = async () => {
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      // "high" effort routinely took 90-120s, long enough that Vercel's
      // platform connection to the browser was getting cut before the
      // response arrived — the generation itself succeeded and the plan
      // still landed in the DB, but the UI never found out and looked
      // stuck until a manual refresh. "medium" trades some thoroughness
      // for reliably finishing inside the request lifetime.
      thinking: { type: "adaptive" },
      output_config: { format: zodOutputFormat(TreasuryPlanSchema), effort: "medium" },
      system: TREASURY_PLAN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });
    if (message.stop_reason === "refusal") throw new Error("The model declined to generate a plan.");
    if (!message.parsed_output) throw new Error("The model did not return a parseable structured plan.");
    return message;
  };

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber++) {
    try {
      const message = await attempt();
      return { plan: message.parsed_output as TreasuryPlanOutput, model: MODEL, promptVersion: PROMPT_VERSION };
    } catch (cause) {
      if (attemptNumber === 2) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        const fallback = deterministicFallback(input);
        fallback.summary += ` (AI generation failed after two attempts: ${detail})`;
        return { plan: fallback, model: null, promptVersion: PROMPT_VERSION };
      }
    }
  }

  // Unreachable — the loop above always returns on its second iteration.
  return { plan: deterministicFallback(input), model: null, promptVersion: PROMPT_VERSION };
}
