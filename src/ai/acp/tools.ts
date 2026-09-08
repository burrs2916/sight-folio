// ACP tool provider — callable actions the host exposes to agents.
//
// Tools are intentionally narrow and safe: file reads/writes go through the
// existing controlled Tauri commands (auto .bak backup + incremental rescan on
// write; only scanned-in files are writable). Context tools read/write the same
// AI context pack the in-house agent uses.

import { projectScanApi, aiContextApi } from "../../services/tauri";
import type { AcpExecutionContext, AcpTool } from "./types";

export const ACP_TOOLS: AcpTool[] = [
  {
    name: "file_list",
    description:
      "List all scanned files in the active analysis. Returns id/path/language/lineCount so the agent can pick a fileId to read or write.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "file_read",
    description:
      "Read a source file's content by its fileId. Returns lines, language, totalLines, and truncation/skip info.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "File id from file_list." },
      },
      required: ["fileId"],
    },
  },
  {
    name: "file_write",
    description:
      "Write controlled source content back to a scanned file by fileId. The backend auto-backs-up the original (.bak) and triggers an incremental rescan. Only files inside the scanned project are writable.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Target file id." },
        content: { type: "string", description: "Full new file content." },
        reason: {
          type: "string",
          description: "Short human-readable reason for the change (recorded in the review ledger).",
        },
      },
      required: ["fileId", "content"],
    },
  },
  {
    name: "context_get_section",
    description:
      "Fetch a single section of the assembled AI context pack by key (e.g. 'structure', 'symbolRefs', 'callGraph', 'metrics', 'techDebt', 'clones', 'git', 'changeCoupling', 'deadCode', 'index').",
    inputSchema: {
      type: "object",
      properties: {
        sectionKey: { type: "string", description: "Section key to retrieve." },
      },
      required: ["sectionKey"],
    },
  },
  {
    name: "context_insight_save",
    description:
      "Save an AI-derived insight for the active analysis (title, detail, severity, evidence, recommendation). Appears in the AiInsightsPanel for human review.",
    inputSchema: {
      type: "object",
      properties: {
        insight: { type: "object", description: "Insight payload." },
      },
      required: ["insight"],
    },
  },

  // ─── Phase 4: read-only code-understanding tools (scoped to active analysis) ───
  // These wrap the existing controlled scan-API surface so an external ACP agent
  // can *navigate and understand* the codebase, not just read/write files. Every
  // method takes the active analysisId from execCtx() — the agent never supplies
  // it, so it can only query the analysis the user is currently looking at.
  // All are pure reads; none trigger heavy analysis or writes. If the
  // corresponding scan stage has not run, they return [] (distinct from an error).

  {
    name: "symbol_search",
    description:
      "Search symbols (classes, functions, interfaces, constants) across the active analysis by name (fuzzy). Returns id/fileId/filePath/name/kind/lineStart so the agent can jump to a symbol. Requires the code-structure scan stage; returns [] if it has not run.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring matched against symbol names." },
        limit: { type: "number", description: "Max results (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "code_search",
    description:
      "Full-text content search across the active analysis's indexed source lines. Returns fileId/filePath/lineNo/content matches. Requires the code-content index to have been built; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text fragment to find." },
        limit: { type: "number", description: "Max results (default 12)." },
      },
      required: ["query"],
    },
  },
  {
    name: "symbol_refs",
    description:
      "List symbol-level reference edges (imports → resolved targets) in the active analysis. Optionally filter by fileId (source or target side) or a specific target symbolId. Requires the symbol-reference scan stage; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Only edges touching this file (as source or target)." },
        symbolId: { type: "string", description: "Only edges pointing at this symbol." },
      },
      required: [],
    },
  },
  {
    name: "call_graph",
    description:
      "List function call-graph edges in the active analysis. Optionally filter by fileId (caller or callee side). Requires the call-graph scan stage; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Only edges where this file is caller or callee." },
      },
      required: [],
    },
  },
  {
    name: "dependencies",
    description:
      "List detected project dependencies / import edges (module→module, file→file) in the active analysis, including circular-flag and weight. Requires the dependency scan stage; returns [] otherwise.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "design_patterns",
    description:
      "List detected design-pattern hits (creational/structural/behavioral/architectural) in the active analysis with confidence and evidence. Requires the code-structure scan stage; returns [] otherwise.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "tech_debt",
    description:
      "List technical-debt markers (TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED) in the active analysis. Optionally filter by fileId or severity. Requires the tech-debt scan stage; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Only markers in this file." },
        severity: { type: "string", description: "info | warning | critical." },
      },
      required: [],
    },
  },
  {
    name: "git_churn",
    description:
      "List git churn hotspots (commit count, churn score, hotspot level) per file in the active analysis. Requires the git-history scan stage; returns [] otherwise.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "review_findings",
    description:
      "List review findings (rule violations / quality issues) in the active analysis. Optionally filter by severity or status. Requires the review stage; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", description: "e.g. info | warning | critical." },
        status: { type: "string", description: "e.g. open | fixed | ignored." },
      },
      required: [],
    },
  },
  {
    name: "file_metrics",
    description:
      "List per-file complexity metrics (lines, cyclomatic complexity, complexity level) in the active analysis. Optionally filter by fileId or complexityLevel. Requires the file-metrics scan stage; returns [] otherwise.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Only this file's metrics." },
        complexityLevel: { type: "string", description: "low | medium | high | extreme." },
      },
      required: [],
    },
  },
];

/** Dispatch a tool call. Throws on unknown tool so the host can return an error. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AcpExecutionContext,
): Promise<unknown> {
  switch (name) {
    case "file_list":
      return projectScanApi.listFiles(ctx.analysisId);

    case "file_read": {
      const fileId = args.fileId as string;
      if (!fileId) throw new Error("file_read requires fileId");
      return projectScanApi.readSourceFile(fileId);
    }

    case "file_write": {
      const fileId = args.fileId as string;
      const content = args.content as string;
      if (!fileId) throw new Error("file_write requires fileId");
      if (typeof content !== "string") throw new Error("file_write requires content string");
      const reason = (args.reason as string) ?? "acp-agent-write";
      // origin "ai-apply" → registers in the change-review ledger (undoable).
      return projectScanApi.writeSourceFile(fileId, content, {
        reason,
        origin: "ai-apply",
      });
    }

    case "context_get_section": {
      const sectionKey = args.sectionKey as string;
      if (!sectionKey) throw new Error("context_get_section requires sectionKey");
      const packId = `${ctx.analysisId}:project-scan`;
      return aiContextApi.getAiContextSection(packId, sectionKey);
    }

    case "context_insight_save": {
      const insight = args.insight as Record<string, unknown>;
      if (!insight || typeof insight !== "object")
        throw new Error("context_insight_save requires an insight object");
      return aiContextApi.saveAiInsight({
        ...insight,
        analysisId: ctx.analysisId,
      } as never);
    }

    // ─── Phase 4: read-only code-understanding tools ───
    case "symbol_search": {
      const query = args.query as string;
      if (!query) throw new Error("symbol_search requires query");
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return projectScanApi.searchSymbols(ctx.analysisId, query, limit);
    }

    case "code_search": {
      const query = args.query as string;
      if (!query) throw new Error("code_search requires query");
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return projectScanApi.searchCodeContent(ctx.analysisId, query, limit);
    }

    case "symbol_refs": {
      const refs = await projectScanApi.listSymbolRefs(ctx.analysisId);
      const fileId = args.fileId as string | undefined;
      const symbolId = args.symbolId as string | undefined;
      return refs.filter(
        (r) =>
          (!fileId || r.fromFileId === fileId || r.toFileId === fileId) &&
          (!symbolId || r.toSymbolId === symbolId),
      );
    }

    case "call_graph": {
      const edges = await projectScanApi.listCallEdges(ctx.analysisId);
      const fileId = args.fileId as string | undefined;
      return fileId
        ? edges.filter((e) => e.callerFileId === fileId || e.calleeFileId === fileId)
        : edges;
    }

    case "dependencies":
      return projectScanApi.listDependencies(ctx.analysisId);

    case "design_patterns":
      return projectScanApi.listDesignPatterns(ctx.analysisId);

    case "tech_debt": {
      const items = await projectScanApi.listTechDebt(ctx.analysisId);
      const fileId = args.fileId as string | undefined;
      const severity = args.severity as string | undefined;
      return items.filter(
        (t) => (!fileId || t.fileId === fileId) && (!severity || t.severity === severity),
      );
    }

    case "git_churn":
      return projectScanApi.listGitChurn(ctx.analysisId);

    case "review_findings": {
      const findings = await projectScanApi.listFindings(ctx.analysisId);
      const severity = args.severity as string | undefined;
      const status = args.status as string | undefined;
      return findings.filter(
        (f) => (!severity || f.severity === severity) && (!status || f.status === status),
      );
    }

    case "file_metrics": {
      const metrics = await projectScanApi.listFileMetrics(ctx.analysisId);
      const fileId = args.fileId as string | undefined;
      const level = args.complexityLevel as string | undefined;
      return metrics.filter(
        (m) =>
          (!fileId || m.fileId === fileId) && (!level || m.complexityLevel === level),
      );
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
