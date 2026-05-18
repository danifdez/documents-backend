// Fixed TTL plazos (memory: "los plazos son fijos en código, no configurables").
// If real-world usage shows them mis-calibrated, change the constant — never
// expose as a setting.

export const AGENT_DEFAULT_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
export const AGENT_UNFAVORITE_GRACE_MS = 24 * 60 * 60 * 1000; // 1 day
