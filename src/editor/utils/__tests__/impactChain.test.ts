import { describe, it, expect } from "vitest";
import {
  buildFileDepIndex,
  symbolsByFileFrom,
  chainFromCallGraph,
  chainFromDependencies,
  buildImpactChain,
  summarizeChain,
  chainLookup,
  chainDepthStyle,
  isTestPath,
  testImpactOf,
  summarizeTestImpact,
  detectTestRunner,
  buildSingleTestCommand,
  buildTestCommands,
  buildCIPipelineScript,
  buildGitHubActionStep,
  buildFlowGate,
  flowKey,
  CHAIN_NODE_LIMIT,
} from "../impactChain";
import { buildCallIndex } from "../impactGraph";
import type { CallEdge, DataFlowFact, ProjectDependency } from "../../../services/tauri";
import type { TestImpactReport } from "../impactChain";

/** 造一条符号级调用边：caller 调用 callee（文件默认按 f-<符号名> 推导） */
function edge(
  caller: string,
  callee: string,
  opts?: { callerFile?: string; calleeFile?: string }
): CallEdge {
  const cf = opts?.callerFile ?? `f-${caller}`;
  const ef = opts?.calleeFile ?? `f-${callee}`;
  return {
    id: `${caller}->${callee}`,
    analysisId: "a1",
    callerSymbolId: caller,
    callerName: caller,
    callerFileId: cf,
    callerFilePath: `${cf}.ts`,
    calleeSymbolId: callee,
    calleeName: callee,
    calleeFileId: ef,
    calleeFilePath: `${ef}.ts`,
    lineNo: 1,
    kind: cf === ef ? "internal" : "cross-file",
    createdAt: 0,
  };
}

/** 造一条文件级依赖边：from import to */
function dep(from: string, to: string): ProjectDependency {
  return {
    id: `${from}=>${to}`,
    analysisId: "a1",
    fromId: from,
    fromType: "file",
    toId: to,
    toType: "file",
    kind: "import",
    lineNo: null,
    isCircular: false,
    weight: 1,
    metadata: "",
    detectedAt: 0,
  };
}

describe("buildFileDepIndex", () => {
  it("建立 out（我依赖谁）与 in（谁依赖我）双向索引", () => {
    const idx = buildFileDepIndex([dep("a", "b"), dep("c", "b")]);
    expect(idx.totalEdges).toBe(2);
    expect(idx.out.get("a")).toEqual(["b"]);
    expect(idx.in.get("b")).toEqual(["a", "c"]);
    expect(idx.out.get("b")).toBeUndefined();
  });

  it("忽略自环与残缺边", () => {
    const idx = buildFileDepIndex([dep("a", "a"), dep("", "b"), dep("c", "")]);
    expect(idx.totalEdges).toBe(0);
  });
});

describe("symbolsByFileFrom", () => {
  it("从调用索引反查每个文件参与调用图的符号", () => {
    const idx = buildCallIndex([edge("a", "b"), edge("a2", "b", { callerFile: "f-a" })]);
    const m = symbolsByFileFrom(idx);
    expect(new Set(m.get("f-a"))).toEqual(new Set(["a", "a2"]));
    expect(m.get("f-b")).toEqual(["b"]);
  });
});

describe("chainFromCallGraph（符号级精确通道）", () => {
  // 链路：a → b → c（跨三个文件），另有 z → a
  const edges = [edge("a", "b"), edge("b", "c"), edge("z", "a")];
  const idx = buildCallIndex(edges);

  it("下游多跳：从 f-a 出发 2 跳能摸到 f-c", () => {
    const chain = chainFromCallGraph(idx, ["f-a"], 2);
    expect(chain.source).toBe("callGraph");
    expect(chain.files.get("f-a")).toEqual({ depth: 0, side: "root" });
    expect(chain.files.get("f-b")).toEqual({ depth: 1, side: "downstream" });
    expect(chain.files.get("f-c")).toEqual({ depth: 2, side: "downstream" });
  });

  it("上游同时生效：z 调 a，所以 f-z 是 1 跳上游", () => {
    const chain = chainFromCallGraph(idx, ["f-a"], 2);
    expect(chain.files.get("f-z")).toEqual({ depth: 1, side: "upstream" });
    expect(chain.counts.upstreamFiles).toBe(1);
    expect(chain.counts.downstreamFiles).toBe(2);
    expect(chain.counts.totalFiles).toBe(3);
  });

  it("maxDepth 生效：1 跳时够不到 f-c", () => {
    const chain = chainFromCallGraph(idx, ["f-a"], 1);
    expect(chain.files.has("f-c")).toBe(false);
    expect(chain.reachedDepth).toBe(1);
  });

  it("根文件不在调用图里 → 交回 none，让上层降级到文件级通道", () => {
    const chain = chainFromCallGraph(idx, ["f-not-in-graph"], 3);
    expect(chain.source).toBe("none");
    expect(chain.files.size).toBe(0);
  });

  it("环路不死循环，且回环节点标记为 both", () => {
    const cyc = buildCallIndex([edge("a", "b"), edge("b", "a")]);
    const chain = chainFromCallGraph(cyc, ["f-a"], 3);
    expect(chain.files.get("f-b")?.side).toBe("both");
    expect(chain.files.get("f-b")?.depth).toBe(1);
  });

  it("多根（模块内多文件）同时作为起点", () => {
    const chain = chainFromCallGraph(idx, ["f-a", "f-b"], 1);
    expect(chain.files.get("f-a")?.depth).toBe(0);
    expect(chain.files.get("f-b")?.depth).toBe(0);
    // f-c 是 f-b 的直接下游
    expect(chain.files.get("f-c")?.depth).toBe(1);
  });

  it("超出节点上限时截断而不是无限扩散", () => {
    const wide: CallEdge[] = [];
    for (let i = 0; i < CHAIN_NODE_LIMIT + 50; i++) {
      wide.push(edge("root", `callee${i}`, { callerFile: "f-root" }));
    }
    const chain = chainFromCallGraph(buildCallIndex(wide), ["f-root"], 3);
    expect(chain.truncated).toBe(true);
    expect(chain.symbols.size).toBeLessThanOrEqual(CHAIN_NODE_LIMIT + 2);
  });
});

describe("chainFromDependencies（文件级兜底通道）", () => {
  // a → b → c，且 z → a
  const idx = buildFileDepIndex([dep("a", "b"), dep("b", "c"), dep("z", "a")]);

  it("方向语义正确：import 的是下游，被 import 的是上游", () => {
    const chain = chainFromDependencies(idx, ["a"], 2);
    expect(chain.source).toBe("dependency");
    expect(chain.files.get("b")).toEqual({ depth: 1, side: "downstream" });
    expect(chain.files.get("c")).toEqual({ depth: 2, side: "downstream" });
    expect(chain.files.get("z")).toEqual({ depth: 1, side: "upstream" });
  });

  it("不产生符号级数据", () => {
    const chain = chainFromDependencies(idx, ["a"], 2);
    expect(chain.symbols.size).toBe(0);
    expect(chain.counts.symbols).toBe(0);
  });

  it("循环依赖不死循环", () => {
    const cyc = buildFileDepIndex([dep("a", "b"), dep("b", "a")]);
    const chain = chainFromDependencies(cyc, ["a"], 5);
    expect(chain.files.get("b")?.side).toBe("both");
  });
});

describe("buildImpactChain（通道选择）", () => {
  const callIdx = buildCallIndex([edge("a", "b")]);
  const depIdx = buildFileDepIndex([dep("f-a", "f-b"), dep("f-b", "f-c")]);

  it("调用图可用时优先走符号级", () => {
    const chain = buildImpactChain({ rootFileIds: ["f-a"], maxDepth: 2, callIndex: callIdx, fileDepIndex: depIdx });
    expect(chain.source).toBe("callGraph");
  });

  it("根文件不在调用图里时自动降级到文件级", () => {
    const chain = buildImpactChain({ rootFileIds: ["f-b"], maxDepth: 2, callIndex: buildCallIndex([edge("x", "y")]), fileDepIndex: depIdx });
    expect(chain.source).toBe("dependency");
    expect(chain.files.get("f-c")?.depth).toBe(1);
  });

  it("preferFileLevel 可强制降级", () => {
    const chain = buildImpactChain({ rootFileIds: ["f-a"], maxDepth: 2, callIndex: callIdx, fileDepIndex: depIdx, preferFileLevel: true });
    expect(chain.source).toBe("dependency");
  });

  it("两个通道都没有数据 → 空链而不是抛错", () => {
    const chain = buildImpactChain({ rootFileIds: ["f-a"], maxDepth: 2 });
    expect(chain.source).toBe("none");
    expect(chain.counts.totalFiles).toBe(0);
  });

  it("maxDepth 为 0 时不传播", () => {
    const chain = buildImpactChain({ rootFileIds: ["f-a"], maxDepth: 0, callIndex: callIdx });
    expect(chain.files.size).toBe(0);
  });
});

describe("summarizeChain / chainLookup / chainDepthStyle", () => {
  it("空链给出可读的兜底文案", () => {
    expect(summarizeChain(buildImpactChain({ rootFileIds: [], maxDepth: 2 }))).toContain("未发现跨文件传播");
  });

  it("符号级摘要包含精度标注与函数数", () => {
    const chain = chainFromCallGraph(buildCallIndex([edge("a", "b"), edge("b", "c")]), ["f-a"], 2);
    const s = summarizeChain(chain);
    expect(s).toContain("符号级");
    expect(s).toContain("个函数");
  });

  it("文件级摘要标注为文件级", () => {
    const chain = chainFromDependencies(buildFileDepIndex([dep("a", "b")]), ["a"], 1);
    expect(summarizeChain(chain)).toContain("文件级");
  });

  it("chainLookup 提供 O(1) 查询视图", () => {
    const chain = chainFromDependencies(buildFileDepIndex([dep("a", "b")]), ["a"], 1);
    const lk = chainLookup(chain);
    expect(lk.has("b")).toBe(true);
    expect(lk.depthOf("b")).toBe(1);
    expect(lk.sideOf("b")).toBe("downstream");
    expect(lk.depthOf("nope")).toBeNull();
    expect(lk.size).toBe(2);
  });

  it("chainLookup 接受 null（未启用影响链时的空视图）", () => {
    const lk = chainLookup(null);
    expect(lk.size).toBe(0);
    expect(lk.has("x")).toBe(false);
  });

  it("chainDepthStyle 越深越淡且不越界", () => {
    expect(chainDepthStyle(1).opacity).toBeGreaterThan(chainDepthStyle(3).opacity);
    expect(chainDepthStyle(99).label).toBe("impact.depth.hop4");
    expect(chainDepthStyle(-5).label).toBe("impact.depth.root");
  });
});

describe("测试影响分析（TIA）", () => {
  it("isTestPath 覆盖多语言测试约定", () => {
    expect(isTestPath("src/editor/utils/__tests__/foo.test.ts")).toBe(true);
    expect(isTestPath("src/a.spec.tsx")).toBe(true);
    expect(isTestPath("src-tauri/src/domain/code_clone_test.rs")).toBe(true);
    expect(isTestPath("app/test_parser.py")).toBe(true);
    expect(isTestPath("tests/e2e/flow.ts")).toBe(true);
    expect(isTestPath("src/main/java/FooTests.java")).toBe(true);
    expect(isTestPath("src/editor/SceneEditor.tsx")).toBe(false);
    expect(isTestPath("src/utils/latest.ts")).toBe(false);
    expect(isTestPath("")).toBe(false);
  });

  it("只把上游测试算作回归范围（下游测试默认排除）", () => {
    // a（根）被 a.test 调用（上游）；a 调用 lib，lib 有 lib.test（下游侧）
    const idx = buildFileDepIndex([dep("f-atest", "f-a"), dep("f-a", "f-lib"), dep("f-libtest", "f-lib")]);
    const chain = chainFromDependencies(idx, ["f-a"], 2);
    const paths: Record<string, string> = {
      "f-a": "src/a.ts",
      "f-atest": "src/__tests__/a.test.ts",
      "f-lib": "src/lib.ts",
      "f-libtest": "src/__tests__/lib.test.ts",
    };
    const rep = testImpactOf(chain, (id) => paths[id]);
    expect(rep.tests.map((t) => t.relPath)).toEqual(["src/__tests__/a.test.ts"]);
    expect(rep.uncovered).toBe(false);
  });

  it("影响面内无测试 → 标记 uncovered 并给出补测试建议", () => {
    const idx = buildFileDepIndex([dep("f-x", "f-a")]);
    const chain = chainFromDependencies(idx, ["f-a"], 1);
    const rep = testImpactOf(chain, (id) => ({ "f-a": "src/a.ts", "f-x": "src/x.ts" })[id]);
    expect(rep.uncovered).toBe(true);
    expect(rep.impactedNonTestFiles).toBe(1);
    expect(summarizeTestImpact(rep)).toContain("没有回归保护");
  });

  it("测试按跳数升序，摘要给出最近/最远跳数", () => {
    const idx = buildFileDepIndex([dep("f-t1", "f-a"), dep("f-t2", "f-t1")]);
    const chain = chainFromDependencies(idx, ["f-a"], 3);
    const paths: Record<string, string> = {
      "f-a": "src/a.ts",
      "f-t1": "src/__tests__/near.test.ts",
      "f-t2": "src/__tests__/far.test.ts",
    };
    const rep = testImpactOf(chain, (id) => paths[id]);
    expect(rep.tests.map((t) => t.depth)).toEqual([1, 2]);
    expect(summarizeTestImpact(rep)).toContain("最近 1 跳，最远 2 跳");
  });

  it("chain 为 null 时安全返回空报告", () => {
    const rep = testImpactOf(null, () => undefined);
    expect(rep.tests).toEqual([]);
    expect(summarizeTestImpact(rep)).toContain("无需回归");
  });
});

describe("TIA → 可运行命令（把分析落到代码动作）", () => {
  // 一份覆盖多语言的回归清单：Vitest / Cargo 集成 / Cargo 单元 / Go / pytest / Maven
  const report: TestImpactReport = {
    tests: [
      { fileId: "t1", relPath: "src/editor/utils/impactChain.test.ts", depth: 1 },
      { fileId: "t2", relPath: "src/editor/SceneEditor.test.tsx", depth: 2 },
      { fileId: "t3", relPath: "src-tauri/tests/integration_test.rs", depth: 1 },
      { fileId: "t4", relPath: "src-tauri/src/domain/code_clone_test.rs", depth: 2 },
      { fileId: "t5", relPath: "internal/parser_test.go", depth: 1 },
      { fileId: "t6", relPath: "tests/test_parser.py", depth: 1 },
      { fileId: "t7", relPath: "src/main/java/CalculatorTests.java", depth: 2 },
    ],
    impactedNonTestFiles: 3,
    uncovered: false,
  };

  it("detectTestRunner 正确识别各语言运行器", () => {
    expect(detectTestRunner("src/a.test.ts")).toBe("vitest");
    expect(detectTestRunner("src/a.spec.tsx")).toBe("vitest");
    expect(detectTestRunner("src-tauri/tests/integration_test.rs")).toBe("cargo");
    expect(detectTestRunner("src-tauri/src/domain/code_clone_test.rs")).toBe("cargo");
    expect(detectTestRunner("internal/parser_test.go")).toBe("go");
    expect(detectTestRunner("tests/test_parser.py")).toBe("pytest");
    expect(detectTestRunner("src/main/java/CalculatorTests.java")).toBe("maven");
    expect(detectTestRunner("src/main.ts")).toBe("unknown");
    expect(detectTestRunner("")).toBe("unknown");
  });

  it("buildSingleTestCommand 生成精确可运行命令", () => {
    expect(buildSingleTestCommand("vitest", "src/a.test.ts")).toBe("npx vitest run src/a.test.ts");
    expect(buildSingleTestCommand("cargo", "src-tauri/tests/integration_test.rs")).toBe(
      "cargo test --test integration_test"
    );
    expect(buildSingleTestCommand("cargo", "src-tauri/src/domain/code_clone_test.rs")).toBe(
      "cargo test src-tauri::src::domain::code_clone_test"
    );
    expect(buildSingleTestCommand("go", "internal/parser_test.go")).toBe("go test ./internal");
    expect(buildSingleTestCommand("pytest", "tests/test_parser.py")).toBe("python -m pytest tests/test_parser.py");
    expect(buildSingleTestCommand("maven", "src/main/java/CalculatorTests.java")).toBe(
      "mvn test -Dtest=CalculatorTests"
    );
  });

  it("buildSingleTestCommand 路径含空格时加引号", () => {
    expect(buildSingleTestCommand("vitest", "src/my tests/a.test.ts")).toBe(
      'npx vitest run "src/my tests/a.test.ts"'
    );
  });

  it("buildTestCommands 按运行器分组且顺序稳定", () => {
    const plan = buildTestCommands(report);
    expect(plan.groups.map((g) => g.runner)).toEqual(["vitest", "cargo", "go", "pytest", "maven"]);
    const vitest = plan.groups[0];
    expect(vitest.label).toBe("Vitest");
    expect(vitest.tests.map((t) => t.relPath)).toEqual([
      "src/editor/utils/impactChain.test.ts",
      "src/editor/SceneEditor.test.tsx",
    ]);
    // flatCommands 顺序与 groups 一致（vitest 两组在前）
    expect(plan.flatCommands[0]).toBe("npx vitest run src/editor/utils/impactChain.test.ts");
    expect(plan.allCommandsText).toContain("cargo test --test integration_test");
    expect(plan.allCommandsText).toContain("python -m pytest tests/test_parser.py");
    expect(plan.allCommandsText).toContain("mvn test -Dtest=CalculatorTests");
  });

  it("buildCIPipelineScript 生成可落地 bash 脚本", () => {
    const script = buildCIPipelineScript(report);
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(script).toContain("set -e");
    expect(script).toContain("npx vitest run");
    expect(script).toContain("go test ./internal");
    expect(script.trim().endsWith("python -m pytest tests/test_parser.py")).toBe(false); // 末尾含空行
  });

  it("buildGitHubActionStep 生成缩进正确的 YAML 步骤", () => {
    const step = buildGitHubActionStep(report);
    expect(step).toContain('name: "TIA 回归 · 影响面内 7 个用例"');
    expect(step).toContain("run: |");
    expect(step).toContain("          npx vitest run src/editor/utils/impactChain.test.ts");
    expect(step).toContain("          mvn test -Dtest=CalculatorTests");
  });

  it("无测试时命令生成给出可读的占位提示而非空脚本", () => {
    const empty: TestImpactReport = { tests: [], impactedNonTestFiles: 0, uncovered: true };
    expect(buildTestCommands(empty).groups).toEqual([]);
    expect(buildCIPipelineScript(empty)).toContain("没有测试文件");
    expect(buildGitHubActionStep(empty)).toContain("没有测试文件");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 数据流闸门 · 上游剪枝（R36）
// ─────────────────────────────────────────────────────────────────────────────

/** 造一条数据流摘要：propagates=false 即「吃进去不吐出来」 */
function fact(fileId: string, fn: string, propagates: boolean, sinks = ""): DataFlowFact {
  return {
    id: `${fileId}::${fn}`,
    analysisId: "a1",
    fileId,
    filePath: `${fileId}.ts`,
    functionName: fn,
    lineNo: 1,
    params: "x",
    paramToReturn: propagates ? "x" : "",
    propagates,
    returnsCallResult: false,
    callFlows: "[]",
    sinks,
    createdAt: 0,
  };
}

describe("buildFlowGate", () => {
  it("只把明确非透传的函数放进 blocking", () => {
    const gate = buildFlowGate([fact("f-a", "a", true), fact("f-b", "b", false)]);
    expect(gate.blocking.has(flowKey("f-b", "b"))).toBe(true);
    expect(gate.blocking.has(flowKey("f-a", "a"))).toBe(false);
    expect(gate.covered).toBe(2);
  });

  it("同名多定义只要有一处透传就整体放行（保守方向）", () => {
    // 同一文件里重载 / 重复定义：一个阻断一个透传 → 不能剪
    const gate = buildFlowGate([fact("f-x", "handle", false), fact("f-x", "handle", true)]);
    expect(gate.blocking.size).toBe(0);
    expect(gate.covered).toBe(1);
  });

  it("忽略匿名函数与缺字段的脏数据，不产生野 key", () => {
    const dirty = [
      fact("f-a", "(anonymous)", false),
      { ...fact("f-b", "b", false), fileId: "" },
      { ...fact("f-c", "c", false), functionName: "" },
    ];
    const gate = buildFlowGate(dirty);
    expect(gate.blocking.size).toBe(0);
    expect(gate.covered).toBe(0);
  });

  it("空摘要 → 空闸门，等价于不启用剪枝", () => {
    expect(buildFlowGate([]).blocking.size).toBe(0);
  });

  // ---- 写外部状态的函数不能当阻断点（真实仓库探针暴露的漏判）----

  it("不回传但写外部状态的 setter 一律放行", () => {
    // fn add_block(&mut self, n) { self.blocks.push(n) } —— 出口是堆不是返回值
    const gate = buildFlowGate([fact("f-s", "addBlock", false, '["self.blocks"]')]);
    expect(gate.blocking.size).toBe(0);
    expect(gate.covered).toBe(1);
  });

  it("空 sinks 的各种写法都不算写外部状态", () => {
    const gate = buildFlowGate([
      fact("f-a", "a", false, "[]"),
      fact("f-b", "b", false, ""),
      fact("f-c", "c", false, "   "),
    ]);
    expect(gate.blocking.size).toBe(3);
  });

  it("既不回传也不写外部状态才是真阻断点", () => {
    const gate = buildFlowGate([
      fact("f-log", "logInfo", false, "[]"),
      fact("f-set", "setValue", false, '["this.value"]'),
    ]);
    expect([...gate.blocking]).toEqual([flowKey("f-log", "logInfo")]);
  });
});

describe("chainFromCallGraph 数据流剪枝", () => {
  // 链路：ui → handler → logger（logger 只写日志，不回传）
  //      other → logger（logger 的另一个调用方）
  // 改 handler：ui 受影响；logger 自身受影响但 other 不该被点亮。
  const edges = [edge("ui", "handler"), edge("handler", "logger"), edge("other", "logger")];
  const index = buildCallIndex(edges);
  const byFile = symbolsByFileFrom(index);

  it("不传闸门时行为与 R34 完全一致（logger 上游继续展开）", () => {
    const chain = chainFromCallGraph(index, ["f-logger"], 3, byFile);
    expect(chain.pruned).toBe(0);
    // logger 的上游：handler(1 跳) → ui(2 跳)、other(1 跳)
    expect(chain.files.has("f-handler")).toBe(true);
    expect(chain.files.has("f-ui")).toBe(true);
    expect(chain.files.has("f-other")).toBe(true);
  });

  it("阻断函数自身仍受影响，但不再向上游扩散", () => {
    // handler 是阻断的：改 logger → handler 受影响，但 handler 不把变化传给 ui
    const gate = buildFlowGate([fact("f-handler", "handler", false)]);
    const chain = chainFromCallGraph(index, ["f-logger"], 3, byFile, gate);
    expect(chain.files.has("f-handler")).toBe(true); // 自身受影响
    expect(chain.files.has("f-ui")).toBe(false); // 上游被剪
    expect(chain.files.has("f-other")).toBe(true); // 另一条链不受影响
    expect(chain.pruned).toBe(1);
  });

  it("只剪上游，下游方向不受闸门影响", () => {
    // 从 ui 出发看下游：ui → handler → logger，即使 handler 阻断也要完整展示依赖面
    const gate = buildFlowGate([fact("f-handler", "handler", false)]);
    const chain = chainFromCallGraph(index, ["f-ui"], 3, byFile, gate);
    expect(chain.files.get("f-handler")?.side).toBe("downstream");
    expect(chain.files.has("f-logger")).toBe(true);
    expect(chain.pruned).toBe(0);
  });

  it("透传函数不剪枝", () => {
    const gate = buildFlowGate([fact("f-handler", "handler", true)]);
    const chain = chainFromCallGraph(index, ["f-logger"], 3, byFile, gate);
    expect(chain.files.has("f-ui")).toBe(true);
    expect(chain.pruned).toBe(0);
  });

  it("没有摘要的函数按透传处理（保守：宁可高估影响面）", () => {
    // 只给 other 摘要，handler 无摘要 → handler 仍然放行
    const gate = buildFlowGate([fact("f-other", "other", false)]);
    const chain = chainFromCallGraph(index, ["f-logger"], 3, byFile, gate);
    expect(chain.files.has("f-ui")).toBe(true);
  });
});

describe("buildImpactChain 透传闸门", () => {
  const edges = [edge("ui", "handler"), edge("handler", "logger")];
  const index = buildCallIndex(edges);

  it("flowGate 会透传到符号级通道", () => {
    const gate = buildFlowGate([fact("f-handler", "handler", false)]);
    const chain = buildImpactChain({
      rootFileIds: ["f-logger"],
      maxDepth: 3,
      callIndex: index,
      flowGate: gate,
    });
    expect(chain.source).toBe("callGraph");
    expect(chain.pruned).toBe(1);
    expect(chain.files.has("f-ui")).toBe(false);
  });

  it("降级到文件级通道时闸门被忽略（粒度对不上，不硬套）", () => {
    const chain = buildImpactChain({
      rootFileIds: ["b"],
      maxDepth: 2,
      fileDepIndex: buildFileDepIndex([dep("a", "b")]),
      flowGate: buildFlowGate([fact("a", "a", false)]),
    });
    expect(chain.source).toBe("dependency");
    expect(chain.pruned).toBe(0);
    expect(chain.files.has("a")).toBe(true);
  });

  it("summarizeChain 在有剪枝时如实标注", () => {
    const gate = buildFlowGate([fact("f-handler", "handler", false)]);
    const chain = buildImpactChain({
      rootFileIds: ["f-logger"],
      maxDepth: 3,
      callIndex: index,
      flowGate: gate,
    });
    expect(summarizeChain(chain)).toContain("数据流剪枝 1 处");
  });
});
