/**
 * Projects known to share the same reused test treasury wallet
 * (0x027eCB431802231106355B227e3EF7886DBAD7a7) across both testnet and
 * mainnet — their balances/activity are not independent of each other and
 * must not be mistaken for a real, dedicated project treasury. Flagged by
 * slug rather than a DB column since these are a fixed, known set from
 * early testing, not an ongoing classification.
 */
const TEST_PROJECT_SLUGS = new Set(["tesrt", "tesrt-2", "test", "test-2", "testsss"]);

export function isTestProject(slug: string): boolean {
  return TEST_PROJECT_SLUGS.has(slug);
}
