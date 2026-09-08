// ACP tool permission model — frontend-native, mirrors project-sight's in-house
// agent approval UX (Allow once / Always allow / Deny) without coupling to the
// backend `agent-tool-approval` run loop.
//
// Risk tiers:
//  - "safe"   : read-only / reversible, user-reviewable context writes. No gate.
//  - "write"  : mutates project files (file_write). Requires approval unless the
//               tool is in the host-wide always-allow set.
//  - "danger" : reserved for future high-risk tools (e.g. run_command). Same gate
//               as "write" but kept distinct so policy can tighten later.

import type {
  AcpApprovalDecision,
  AcpApprovalRequest,
  ResolvedPreset,
} from "./types";

export type AcpToolRisk = "safe" | "write" | "danger";

export const ACP_TOOL_RISK: Record<string, AcpToolRisk> = {
  // write-class (currently the only mutating tool)
  file_write: "write",
  // danger-class reserved for future tools (run_command, etc.)
};

export function classifyRisk(tool: string): AcpToolRisk {
  return ACP_TOOL_RISK[tool] ?? "safe";
}

/**
 * Decide whether a tool call may proceed, given the session's resolved preset
 * (P1) and the host-wide always-allow set (Phase 5 "Always allow" button).
 *
 * Precedence:
 *  - safe tools (reads)                          → "allow" (never prompted)
 *  - tool in preset.allowedTools                 → "allow" (preset pre-grants)
 *  - preset.defaultPolicy === "deny"             → "deny" (no prompt)
 *  - tool in host-wide alwaysAllowSet            → "allow"
 *  - otherwise                                  → "ask"   (raise Phase 5 prompt)
 */
export function evaluateToolPermission(
  tool: string,
  preset: ResolvedPreset | null | undefined,
  globalAlwaysAllow: boolean,
): "allow" | "deny" | "ask" {
  const risk = classifyRisk(tool);
  if (risk === "safe") return "allow";
  if (preset && preset.allowedTools.includes(tool)) return "allow";
  if (preset && preset.defaultPolicy === "deny") return "deny";
  if (globalAlwaysAllow) return "allow";
  return "ask";
}

/**
 * Host-wide "always allow" set for write/danger tools.
 * Populated when the user picks "always_allow" on an approval; checked by the
 * host before raising a new approval so repeat calls don't re-prompt.
 * Keyed by tool name (host-scoped: one user, one active analysis).
 */
export const alwaysAllowSet = new Set<string>();

/** Clear the always-allow set (on host stop / restart, so a new session re-prompts). */
export function resetAlwaysAllow(): void {
  alwaysAllowSet.clear();
}

export type ApprovalHandler = (req: AcpApprovalRequest) => Promise<AcpApprovalDecision>;
