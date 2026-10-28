// ACP resource provider — read-only project context the host exposes to agents.
//
// These mirror the three backend analysis tools (project_context / scan_records /
// context_insight) but are served from the frontend over the in-process transport,
// so an ACP-compliant agent (claw / OpenClaw coding-agent / in-house) gets the
// same 19-section context pack the in-house agent consumes — without any Rust change.

import { projectScanApi, aiContextApi } from "../../services/tauri";
import type { AcpExecutionContext, AcpResource } from "./types";

/** Stable resource URIs. The host fills `analysisId` from the active analysis. */
export const ACP_RESOURCES: AcpResource[] = [
  {
    uri: "ps://project/context",
    name: "Project Context Pack",
    description:
      "The fully assembled AI context pack (19 sections: structure, symbols, call graph, data flow, metrics, tech debt, clones, git, change coupling, dead code, index).",
    mimeType: "application/json",
  },
  {
    uri: "ps://project/scan-records",
    name: "Scan Records",
    description:
      "All scanned files for the active analysis (path, language, line count, layer, hash). Use this to enumerate project files before reading.",
    mimeType: "application/json",
  },
  {
    uri: "ps://project/insights",
    name: "AI Insights",
    description:
      "AI-derived insights already recorded for the active analysis (resolved or open).",
    mimeType: "application/json",
  },
];

/**
 * Read a resource by URI. Throws on unknown URI so the host can translate it
 * into an ACP error envelope.
 */
export async function readResource(
  uri: string,
  ctx: AcpExecutionContext,
): Promise<unknown> {
  switch (uri) {
    case "ps://project/context": {
      const packId = `${ctx.analysisId}:project-scan`;
      return aiContextApi.getAiContextPack(packId);
    }
    case "ps://project/scan-records": {
      return projectScanApi.listFiles(ctx.analysisId);
    }
    case "ps://project/insights": {
      return aiContextApi.listAiInsights(ctx.analysisId);
    }
    default:
      throw new Error(`unknown resource: ${uri}`);
  }
}
