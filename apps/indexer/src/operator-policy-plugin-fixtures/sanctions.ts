/** Interface-compatible #61 plugin fixture for loader tests. */
export function indexerSanctionsStore() {
  const blocked = new Set(
    (process.env.OPERATOR_POLICY_PLUGIN_BLOCKED ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return {
    screen(address: string) {
      if (blocked.has(address.toLowerCase())) {
        return { decision: "blocked" as const, freshness: "current" as const };
      }
      return { decision: "clear" as const, freshness: "current" as const };
    },
  };
}
