import { describe, it, expect } from "vitest";
import type { CallEdge, DataFlowFact } from "../../../services/tauri";
import {
  buildTaintPaths,
  filterTaintPaths,
  isRegexReceiverSink,
  layoutTaintPaths,
  matchSanitizer,
  matchSink,
  resolveSanitizer,
} from "../taintFlow";

// ─────────────────────────── 测试夹具 ───────────────────────────

function fact(
  fileId: string,
  functionName: string,
  lineNo: number,
  o: {
    params?: string;
    flows?: Array<{
      callee: string;
      argIndex: number;
      param: string;
      line: number;
      receiver?: string;
      /** 中间调用链（dataflow 局部变量展开产物，求值顺序） */
      via?: string[];
      /** Rust 侧 FlowSemantic 语义结论：`block:<name>` / `pass` / "" */
      sem?: string;
    }>;
    sinks?: string[];
    paramToReturn?: string;
  } = {}
): DataFlowFact {
  return {
    id: `${fileId}#${functionName}`,
    analysisId: "a1",
    fileId,
    filePath: `${fileId}.ts`,
    functionName,
    lineNo,
    params: o.params ?? "",
    paramToReturn: o.paramToReturn ?? "",
    propagates: false,
    returnsCallResult: false,
    callFlows: JSON.stringify(o.flows ?? []),
    sinks: JSON.stringify(o.sinks ?? []),
    createdAt: 0,
  };
}

function edge(callerFileId: string, callerName: string, calleeFileId: string, calleeName: string, lineNo: number): CallEdge {
  return {
    id: `${callerFileId}->${calleeName}@${lineNo}`,
    analysisId: "a1",
    callerSymbolId: `${callerFileId}#${callerName}`,
    callerName,
    callerFileId,
    callerFilePath: `${callerFileId}.ts`,
    calleeSymbolId: `${calleeFileId}#${calleeName}`,
    calleeName,
    calleeFileId,
    calleeFilePath: `${calleeFileId}.ts`,
    lineNo,
    kind: "cross-file",
    createdAt: 0,
  };
}

// ─────────────────────────── 名单规则 ───────────────────────────

describe("taintFlow · 危险汇点名单（对标 joern sink traversal）", () => {
  it("识别 RCE / SQL / XSS / 路径 / SSRF 五类危险调用", () => {
    expect(matchSink("eval")?.kind).toBe("rce");
    expect(matchSink("execSync")?.kind).toBe("rce");
    expect(matchSink("query")?.kind).toBe("sql");
    expect(matchSink("$queryRaw")?.kind).toBe("sql");
    expect(matchSink("innerHTML")?.kind).toBe("xss");
    expect(matchSink("readFileSync")?.kind).toBe("path");
    expect(matchSink("fetch")?.kind).toBe("ssrf");
  });

  it("带接收者的调用按末段匹配：fs.readFileSync / document.write", () => {
    expect(matchSink("fs.readFileSync")?.kind).toBe("path");
    expect(matchSink("document.write")?.kind).toBe("xss");
  });

  it("最严重的类别给最高分（对标 joern Query.score）", () => {
    expect(matchSink("eval")?.score).toBe(5);
    expect(matchSink("query")?.score).toBe(5);
    expect(matchSink("innerHTML")?.score).toBe(4);
    expect(matchSink("fetch")?.score).toBe(3);
  });

  // 这两条是刻意的设计取舍，改了会制造大量假阳性
  it("prepare 不算 sink：参数化预处理恰恰是 SQL 注入的解药", () => {
    expect(matchSink("prepare")).toBeNull();
  });

  it("res.write / stream.write 不算 XSS，只有 document.write 算", () => {
    expect(matchSink("res.write")).toBeNull();
    expect(matchSink("stream.write")).toBeNull();
    expect(matchSink("document.write")?.kind).toBe("xss");
  });

  it("普通业务函数不算 sink", () => {
    expect(matchSink("buildReport")).toBeNull();
    expect(matchSink("formatUserName")).toBeNull();
    expect(matchSink("")).toBeNull();
  });

  // 真实项目数据探针里踩出来的假阳性，锁死不再退化
  it("list_dir_raw / read_raw 之类无辜函数名不算 SQL 注入", () => {
    expect(matchSink("list_dir_raw")).toBeNull();
    expect(matchSink("read_raw")).toBeNull();
    expect(matchSink("parseRawConfig")).toBeNull();
  });

  it("Prisma 风格的 $queryRaw / $executeRaw 仍判为 SQL 注入", () => {
    expect(matchSink("$queryRaw")?.kind).toBe("sql");
    expect(matchSink("$executeRaw")?.kind).toBe("sql");
    expect(matchSink("rawQuery")?.kind).toBe("sql");
  });

  // P0：裸 `exec` 规则已恢复（child_process.exec 是真 RCE 汇点），但 dataFlow 的
  // callFlows 现在带 `receiver`，taintFlow 用接收者守卫区分 `RegExp.exec`/`self.exec`
  // （假阳性）与 `child_process.exec`（真阳性）。真实探针里 5 条误报接收者分别是
  // RegExp/SENTINEL_RE/startRegex/doneRegex（正则）与 self（Rust 内部执行器）。
  it("接收者守卫：RegExp/正则变量/self 接收者的 exec 不报 RCE，child_process.exec 报", () => {
    // matchSink 本身（仅看名字）已恢复 exec → rce
    expect(matchSink("exec")?.kind).toBe("rce");
    // 但接收者守卫能区分：
    expect(isRegexReceiverSink("exec", "RegExp")).toBe(true);
    expect(isRegexReceiverSink("exec", "SENTINEL_RE")).toBe(true); // 名含 _RE
    expect(isRegexReceiverSink("exec", "startRegex")).toBe(true); // 名含 Regex
    expect(isRegexReceiverSink("exec", "self")).toBe(true); // Rust 内部执行器
    expect(isRegexReceiverSink("exec", "child_process")).toBe(false); // 真 RCE
    expect(isRegexReceiverSink("exec", "")).toBe(false); // 无信息→保守报 RCE
    expect(isRegexReceiverSink("execSync", "child_process")).toBe(false); // 非裸 exec 不触发守卫
  });

  it("无歧义的命令执行 API 仍算 RCE：execSync / execFile / spawn / system / popen", () => {
    expect(matchSink("execSync")?.kind).toBe("rce");
    expect(matchSink("execFile")?.kind).toBe("rce");
    expect(matchSink("spawn")?.kind).toBe("rce");
    expect(matchSink("spawnSync")?.kind).toBe("rce");
    expect(matchSink("system")?.kind).toBe("rce");
    expect(matchSink("popen")?.kind).toBe("rce");
    // Function 构造器（new Function(str)）与 getRuntime 这类代码执行入口
    expect(matchSink("Function")?.kind).toBe("rce");
    expect(matchSink("getRuntime")?.kind).toBe("rce");
  });

  it("端到端：RegExp 接收者的 exec 不成链，child_process.exec / execSync 成链", () => {
    const facts = [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [
          { callee: "RegExp.exec".toLowerCase(), argIndex: 0, param: "input", line: 12, receiver: "RegExp" },
          { callee: "exec", argIndex: 0, param: "input", line: 13, receiver: "child_process" },
          { callee: "execSync", argIndex: 0, param: "input", line: 14 },
        ],
      }),
    ];
    const edges = [
      edge("f1", "handler", "f2", "regexp.exec", 12),
      edge("f1", "handler", "f2", "exec", 13),
      edge("f1", "handler", "f2", "execSync", 14),
    ];
    const r = buildTaintPaths(facts, edges);
    // RegExp.exec 被接收者守卫拦下；child_process.exec + execSync 成链 → 2 条 RCE
    expect(r.paths.length).toBe(2);
    expect(r.paths.every((p) => p.endKind === "rce")).toBe(true);
    expect(r.stats.sinks).toBe(2);
  });
});

describe("taintFlow · 净化函数名单（对标 joern Semantics 阻断语义）", () => {
  it("转义 / 校验 / 数值化函数视为净化", () => {
    expect(matchSanitizer("escapeHtml")).toBe(true);
    expect(matchSanitizer("sanitizeInput")).toBe(true);
    expect(matchSanitizer("encodeURIComponent")).toBe(true);
    expect(matchSanitizer("parseInt")).toBe(true);
    expect(matchSanitizer("Number")).toBe(true);
    expect(matchSanitizer("basename")).toBe(true);
  });

  it("普通函数不算净化", () => {
    expect(matchSanitizer("buildQuery")).toBe(false);
    expect(matchSanitizer("render")).toBe(false);
  });
});

describe("taintFlow · FlowSemantic 语义表（对标 joern DefaultSemantics）", () => {
  /**
   * 判定权在 Rust 侧语义表（`infrastructure/ast/flow_semantics.rs`），
   * 前端只消费结论。三条分支必须各就各位：
   *
   * - `block:<name>` → 净化，且报告里能标出**决定性**调用名；
   * - `pass` → 明确不净化（专治正则误伤）；
   * - 空 / 缺失 → 回退正则，与改动前逐字节一致（旧数据零回归）。
   */
  it("block 分支：净化并携带决定性调用名", () => {
    expect(resolveSanitizer({ callee: "write", argIndex: 0, param: "p", line: 1, sem: "block:escapeHtml" })).toBe(
      "escapeHtml"
    );
  });

  it("pass 分支：语义表收录的透传调用明确不净化", () => {
    expect(resolveSanitizer({ callee: "write", argIndex: 0, param: "p", line: 1, sem: "pass" })).toBeUndefined();
  });

  it("pass 覆盖正则误伤：normalize 不再被当成净化器", () => {
    // 回归锁：SANITIZER_RE 里 normalize 仍在命中（历史行为），
    // 但语义表判定为透传时，语义表优先 —— 这正是路径穿越漏报的修复点。
    expect(matchSanitizer("normalize")).toBe(true);
    expect(
      resolveSanitizer({ callee: "readFileSync", argIndex: 0, param: "p", line: 1, via: ["normalize"], sem: "pass" })
    ).toBeUndefined();
  });

  it("空 sem 回退正则：旧数据行为与改动前一致", () => {
    expect(resolveSanitizer({ callee: "escapeHtml", argIndex: 0, param: "p", line: 1, sem: "" })).toBe("escapeHtml");
    expect(resolveSanitizer({ callee: "render", argIndex: 0, param: "p", line: 1, sem: "" })).toBeUndefined();
    // 字段缺失（真实旧库数据就是没有 sem 字段）
    expect(resolveSanitizer({ callee: "escapeHtml", argIndex: 0, param: "p", line: 1 })).toBe("escapeHtml");
  });

  it("端到端：语义表 pass 让被正则误判的路径重新报出来", () => {
    // const p = path.normalize(req.params.p); fs.readFileSync(p);
    // 语义表未生效前，这条路径被判成 "sanitized"，路径穿越漏洞整条消失。
    const facts = [
      fact("f", "read", 1, {
        params: "req",
        flows: [{ callee: "readFileSync", argIndex: 0, param: "req", line: 3, via: ["normalize"], sem: "pass" }],
      }),
    ];
    const r = buildTaintPaths(facts, [edge("f", "read", "f", "readFileSync", 3)]);
    expect(r.paths.length).toBe(1);
    expect(r.paths[0].endKind).toBe("path");
    expect(r.stats.sanitized).toBe(0);
  });

  it("端到端：语义表 block 仍终止为 sanitized", () => {
    const facts = [
      fact("f", "read", 1, {
        params: "req",
        flows: [{ callee: "readFileSync", argIndex: 0, param: "req", line: 3, via: ["escapeHtml"], sem: "block:escapeHtml" }],
      }),
    ];
    const r = buildTaintPaths(facts, [edge("f", "read", "f", "readFileSync", 3)]);
    expect(r.paths.length).toBe(1);
    expect(r.paths[0].endKind).toBe("sanitized");
    expect(r.paths[0].nodes[r.paths[0].nodes.length - 1].rule).toBe("escapeHtml");
  });
});

describe("taintFlow · 局部变量展开的中间调用链（对标 joern 到达定义）", () => {
  /**
   * dataflow 把 `const v = escapeHtml(req.body); render(v)` 展开成直达边
   * `req → render` 之后，净化痕迹只存在于 via 里。不看 via 就会把已净化的
   * 数据报成漏洞 —— 展开带来召回，净化判定必须跟着一起展开。
   */
  it("via 里的净化调用终止污点链，不把已净化数据报成漏洞", () => {
    const facts = [
      fact("f", "handler", 1, {
        params: "req",
        flows: [{ callee: "render", argIndex: 0, param: "req", line: 5, via: ["escapeHtml"] }],
      }),
    ];
    const r = buildTaintPaths(facts, []);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].endKind).toBe("sanitized");
    expect(r.paths[0].nodes[r.paths[0].nodes.length - 1].rule).toBe("escapeHtml");
  });

  it("via 里没有净化调用时，展开链照常报出汇点", () => {
    const facts = [
      fact("f", "handler", 1, {
        params: "req",
        flows: [{ callee: "query", argIndex: 0, param: "req", line: 5, via: ["buildQuery"] }],
      }),
    ];
    const r = buildTaintPaths(facts, []);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].endKind).toBe("sql");
  });

  it("零回归：无 via 的直接流行为不变", () => {
    const facts = [
      fact("f", "handler", 1, {
        params: "req",
        flows: [{ callee: "query", argIndex: 0, param: "req", line: 5 }],
      }),
    ];
    const r = buildTaintPaths(facts, []);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].endKind).toBe("sql");
    expect(r.paths[0].nodes[r.paths[0].nodes.length - 1].rule).toBe("query");
  });

  it("边标签画出中间调用链，而不是假装直达", () => {
    const facts = [
      fact("f", "handler", 1, {
        params: "req",
        flows: [{ callee: "query", argIndex: 0, param: "req", line: 5, via: ["buildQuery"] }],
      }),
    ];
    const r = buildTaintPaths(facts, []);
    expect(r.paths[0].edges[0].label).toBe("req → buildQuery() → query() #0");
  });

  it("净化判定只看 via 不解绑被调方本身的汇点", () => {
    // 中间链路干净、末端是危险 API —— 必须报，不能被 via 逻辑误伤
    const facts = [
      fact("f", "handler", 1, {
        params: "req",
        flows: [{ callee: "exec", argIndex: 0, param: "req", line: 7, via: ["wrap"] }],
      }),
    ];
    const r = buildTaintPaths(facts, []);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].endKind).toBe("rce");
  });
});

// ─────────────────────────── 路径求解 ───────────────────────────

describe("taintFlow · 污点路径求解", () => {
  /** handler(input) → build(raw) → query(sql) —— 经典 SQL 注入链 */
  function sqlInjectionFixture() {
    const facts = [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [{ callee: "build", argIndex: 0, param: "input", line: 12 }],
      }),
      fact("f2", "build", 20, {
        params: "raw",
        flows: [{ callee: "query", argIndex: 0, param: "raw", line: 22 }],
      }),
    ];
    const edges = [
      edge("f1", "handler", "f2", "build", 12),
      edge("f2", "build", "f3", "query", 22),
    ];
    return { facts, edges };
  }

  it("求出入参 → 中转 → 危险调用的完整链路", () => {
    const { facts, edges } = sqlInjectionFixture();
    const r = buildTaintPaths(facts, edges);
    expect(r.paths.length).toBe(1);
    const p = r.paths[0];
    expect(p.endKind).toBe("sql");
    expect(p.severity).toBe(5);
    expect(p.nodes.map((n) => n.role)).toEqual(["source", "hop", "sink"]);
    expect(p.nodes[0].name).toBe("handler");
    expect(p.nodes[1].name).toBe("build");
    expect(p.nodes[2].name).toBe("query()");
  });

  it("sink 节点锚定在危险调用所在行，而不是函数定义行（双击直达出事那一行）", () => {
    const { facts, edges } = sqlInjectionFixture();
    const p = buildTaintPaths(facts, edges).paths[0];
    const sink = p.nodes[p.nodes.length - 1];
    expect(sink.line).toBe(22); // f2.ts 第 22 行 = build 里调用 query 的那一行
    expect(sink.fileId).toBe("f2");
  });

  it("链路标签带参数位置（参数位置感知，不是笼统的函数到函数）", () => {
    const { facts, edges } = sqlInjectionFixture();
    const p = buildTaintPaths(facts, edges).paths[0];
    expect(p.edges[0].label).toBe("input → build() #0");
    expect(p.edges[1].label).toBe("raw → query() #0");
  });

  /**
   * 参数位置感知的核心断言：污染从 #1 进入时，不会顺着 #0 的流向继续传播。
   * 夹具里 `feeder` 负责喂 #0(raw)，`handler` 负责喂 #1(prefix)，使 build 自身
   * 不构成 source —— 这样能干净地隔离「位置」这一个变量。
   */
  function positionFixture(buildOutParam: string) {
    const facts = [
      fact("f0", "feeder", 5, {
        params: "seed",
        flows: [{ callee: "build", argIndex: 0, param: "seed", line: 6 }],
      }),
      fact("f1", "handler", 10, {
        params: "input",
        flows: [{ callee: "build", argIndex: 1, param: "input", line: 12 }],
      }),
      fact("f2", "build", 20, {
        params: "raw,prefix",
        flows: [{ callee: "query", argIndex: 0, param: buildOutParam, line: 22 }],
      }),
    ];
    const edges = [
      edge("f0", "feeder", "f2", "build", 6),
      edge("f1", "handler", "f2", "build", 12),
      edge("f2", "build", "f3", "query", 22),
    ];
    return { facts, edges };
  }

  it("参数位置匹配时成链：#0 进 #0 出", () => {
    const { facts, edges } = positionFixture("raw");
    const r = buildTaintPaths(facts, edges);
    expect(r.paths.length).toBe(1);
    // 只有 feeder→build.raw→query 这条成链；handler 送入的 prefix 无人外传，不成链
    expect(r.paths[0].nodes[0].name).toBe("feeder");
    expect(r.paths[0].nodes[1].tainted).toEqual(["raw"]);
  });

  it("参数位置不匹配时不成链：handler 从 #1 送入，但 build 只外传 #0", () => {
    const { facts, edges } = positionFixture("raw");
    const r = buildTaintPaths(facts, edges);
    const fromHandler = r.paths.filter((p) => p.nodes[0].name === "handler");
    expect(fromHandler.length).toBe(0);
  });

  it("换成 #1 进 #1 出，成链方换成 handler", () => {
    const { facts, edges } = positionFixture("prefix");
    const r = buildTaintPaths(facts, edges);
    expect(r.paths.length).toBe(1);
    expect(r.paths[0].nodes[0].name).toBe("handler");
    expect(r.paths[0].nodes[1].tainted).toEqual(["prefix"]);
  });

  it("净化函数拦下污染：链路终止且不计为危险", () => {
    const facts = [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [{ callee: "escapeHtml", argIndex: 0, param: "input", line: 12 }],
      }),
    ];
    const edges = [edge("f1", "handler", "f2", "escapeHtml", 12)];
    const r = buildTaintPaths(facts, edges);
    expect(r.paths.length).toBe(1);
    const p = r.paths[0];
    expect(p.endKind).toBe("sanitized");
    expect(p.severity).toBe(0);
    expect(p.nodes[p.nodes.length - 1].role).toBe("sanitized");
    expect(r.stats.sanitized).toBe(1);
    expect(r.stats.sinks).toBe(0);
  });

  it("解析不到摘要也归不上类的调用点，如实计入 unresolved 而不静默吞掉", () => {
    // `eval` 让该入口可证明走到 sink（否则会被 ④ 的可达性预筛判成「走不到任何落点」
    // 而不予探索 —— 那条行为由下方预筛用例单独锁定）。
    // 入口被探索之后，`someUnknownHelper` 解析不到摘要又归不上类，必须如实计入。
    const facts = [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [
          { callee: "someUnknownHelper", argIndex: 0, param: "input", line: 12 },
          { callee: "eval", argIndex: 0, param: "input", line: 14 },
        ],
      }),
    ];
    const r = buildTaintPaths(facts, []); // 没有调用边 → someUnknownHelper 无法解析
    expect(r.stats.unresolved).toBeGreaterThan(0);
    expect(r.paths.length).toBe(1); // eval 仍正常成链，未被预筛连坐
  });

  it("可达性预筛：走不到任何落点的入口不占用探索预算，走得到的照常成链", () => {
    // 两个函数都只调 someUnknownHelper（无调用边 → 不可解析，且既非 sink 也非净化器），
    // 差别只在 hopeless 没有 sink、hopeful 有一条 eval。
    const dead = fact("f1", "hopeless", 10, {
      params: "input",
      flows: [{ callee: "someUnknownHelper", argIndex: 0, param: "input", line: 12 }],
    });
    const alive = fact("f1", "hopeful", 30, {
      params: "input",
      flows: [
        { callee: "someUnknownHelper", argIndex: 0, param: "input", line: 32 },
        { callee: "eval", argIndex: 0, param: "input", line: 34 },
      ],
    });
    const r = buildTaintPaths([dead, alive], []);
    const roots = new Set(r.paths.map((p) => p.nodes[0].name));
    // 预筛是保守的：能产路径的入口绝不被剪；产不出路径的不浪费预算
    expect(roots.has("hopeful")).toBe(true);
    expect(roots.has("hopeless")).toBe(false);
    expect(r.stats.unresolved).toBe(1); // 只有被探索的入口贡献 unresolved
  });

  it("被调方把污染写进外部状态时按副作用汇点落地（低严重度）", () => {
    const facts = [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [{ callee: "cachePut", argIndex: 0, param: "input", line: 12 }],
      }),
      fact("f2", "cachePut", 20, { params: "value", sinks: ["this.cache"] }),
    ];
    const edges = [edge("f1", "handler", "f2", "cachePut", 12)];
    const r = buildTaintPaths(facts, edges);
    expect(r.paths.length).toBe(1);
    expect(r.paths[0].endKind).toBe("sideEffect");
    expect(r.paths[0].severity).toBe(2);
  });

  it("空输入不炸、不产出路径", () => {
    expect(buildTaintPaths([], []).paths).toEqual([]);
    expect(buildTaintPaths([fact("f1", "a", 1, { params: "x" })], []).paths).toEqual([]);
  });

  it("确定性：同一份输入重复求解结果完全一致（joern UnorderedIteration 教训）", () => {
    const { facts, edges } = sqlInjectionFixture();
    const a = buildTaintPaths(facts, edges);
    const b = buildTaintPaths(facts, edges);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─────────────────────────── 三视图与布局 ───────────────────────────

describe("taintFlow · 视图过滤", () => {
  function mixedFixture() {
    return [
      fact("f1", "handler", 10, {
        params: "input",
        flows: [
          { callee: "query", argIndex: 0, param: "input", line: 12 }, // 高危 SQL
          { callee: "escapeHtml", argIndex: 0, param: "input", line: 14 }, // 已净化
        ],
      }),
    ];
  }

  it("critical 视图只留 score≥4 的链路", () => {
    const r = buildTaintPaths(mixedFixture(), [
      edge("f1", "handler", "f2", "query", 12),
      edge("f1", "handler", "f2", "escapeHtml", 14),
    ]);
    expect(r.paths.length).toBe(2);
    const crit = filterTaintPaths(r, "critical");
    expect(crit.paths.length).toBe(1);
    expect(crit.paths[0].endKind).toBe("sql");
  });

  it("sanitized 视图只留被拦下的链路", () => {
    const r = buildTaintPaths(mixedFixture(), [
      edge("f1", "handler", "f2", "query", 12),
      edge("f1", "handler", "f2", "escapeHtml", 14),
    ]);
    const san = filterTaintPaths(r, "sanitized");
    expect(san.paths.length).toBe(1);
    expect(san.paths[0].endKind).toBe("sanitized");
  });

  it("all 视图不过滤", () => {
    const r = buildTaintPaths(mixedFixture(), [
      edge("f1", "handler", "f2", "query", 12),
      edge("f1", "handler", "f2", "escapeHtml", 14),
    ]);
    expect(filterTaintPaths(r, "all").paths.length).toBe(2);
  });
});

describe("taintFlow · 布局", () => {
  it("每条路径一列、节点自上而下（每条依赖占一行）", () => {
    const r = buildTaintPaths(
      [
        fact("f1", "handler", 10, {
          params: "input",
          flows: [{ callee: "query", argIndex: 0, param: "input", line: 12 }],
        }),
      ],
      [edge("f1", "handler", "f2", "query", 12)]
    );
    const layout = layoutTaintPaths(r, { left: 60, top: 80, nodeW: 250, nodeH: 46, rowGap: 18, colGap: 70 });
    expect(layout.paths.length).toBe(1);
    const nodes = layout.paths[0].nodes;
    expect(nodes[0].x).toBe(60);
    expect(nodes[0].y).toBe(80);
    // 第二行 = top + (nodeH + rowGap)
    expect(nodes[1].y).toBe(80 + 46 + 18);
    expect(nodes[1].x).toBe(60);
  });

  it("第二条路径整体右移一列", () => {
    const r = buildTaintPaths(
      [
        fact("f1", "handler", 10, {
          params: "input",
          flows: [
            { callee: "query", argIndex: 0, param: "input", line: 12 },
            { callee: "eval", argIndex: 0, param: "input", line: 13 },
          ],
        }),
      ],
      [edge("f1", "handler", "f2", "query", 12), edge("f1", "handler", "f2", "eval", 13)]
    );
    const layout = layoutTaintPaths(r, { left: 60, top: 80, nodeW: 250, nodeH: 46, rowGap: 18, colGap: 70 });
    expect(layout.paths.length).toBe(2);
    expect(layout.paths[1].nodes[0].x).toBe(60 + 250 + 70);
  });

  it("节点携带 fileId + line，满足双击直达源码的前提", () => {
    const r = buildTaintPaths(
      [
        fact("f1", "handler", 10, {
          params: "input",
          flows: [{ callee: "query", argIndex: 0, param: "input", line: 12 }],
        }),
      ],
      [edge("f1", "handler", "f2", "query", 12)]
    );
    for (const n of layoutTaintPaths(r).paths[0].nodes) {
      expect(typeof n.fileId).toBe("string");
      expect(n.fileId.length).toBeGreaterThan(0);
      expect(typeof n.line).toBe("number");
      expect(n.line).toBeGreaterThan(0);
    }
  });

  it("空洞房：无路径时布局为空且不抛错", () => {
    const layout = layoutTaintPaths(buildTaintPaths([], []));
    expect(layout.paths).toEqual([]);
  });
});

// ─────────────────────────── 路径枚举语义（对标 joern TaskCreator） ───────────────────────────
//
// joern `TaskCreator.removeTasksWithLoopsAndTooHighCallDepth` 的判定是
// `t.taskStack.dedup.size == t.taskStack.size` —— **路径内**不得重复；
// package.scala:57-59 进一步要求：同一节点若经不同调用序列到达，应视为不同路径元素。
// 下面两组是这条语义的回归锁，改回「全局 visited」会立刻红。

describe("taintFlow · 路径枚举（joern taskStack 路径级去重）", () => {
  /** entry(req) ─┬─> branchA(x) ─┐
   *              └─> branchB(y) ─┴─> merge(m) ─> eval()  */
  function diamond() {
    return {
      facts: [
        fact("f", "entry", 1, {
          params: "req",
          flows: [
            { callee: "branchA", argIndex: 0, param: "req", line: 2 },
            { callee: "branchB", argIndex: 0, param: "req", line: 3 },
          ],
        }),
        fact("f", "branchA", 10, {
          params: "x",
          flows: [{ callee: "merge", argIndex: 0, param: "x", line: 11 }],
        }),
        fact("f", "branchB", 20, {
          params: "y",
          flows: [{ callee: "merge", argIndex: 0, param: "y", line: 21 }],
        }),
        fact("f", "merge", 30, {
          params: "m",
          flows: [{ callee: "eval", argIndex: 0, param: "m", line: 31 }],
        }),
      ],
      edges: [
        edge("f", "entry", "f", "branchA", 2),
        edge("f", "entry", "f", "branchB", 3),
        edge("f", "branchA", "f", "merge", 11),
        edge("f", "branchB", "f", "merge", 21),
        edge("f", "merge", "f", "eval", 31),
      ],
    };
  }

  it("菱形汇聚：两条分叉各自成链，不被先到的分叉吞掉", () => {
    const { facts, edges } = diamond();
    const r = buildTaintPaths(facts, edges);
    const shown = r.paths.map((p) => p.nodes.map((n) => n.name).join(" > "));
    expect(shown).toContain("entry > branchA > merge > eval()");
    expect(shown).toContain("entry > branchB > merge > eval()");
    expect(r.paths.length).toBe(2);
  });

  it("环 entry→a→b→a：终止、路径内无重复节点、sink 仍可达", () => {
    // 入口形参必须「未被上游喂入」，否则 source 启发式（步骤②）不会选它做起点。
    const r = buildTaintPaths(
      [
        fact("f", "entry", 1, {
          params: "req",
          flows: [{ callee: "a", argIndex: 0, param: "req", line: 2 }],
        }),
        fact("f", "a", 10, {
          params: "p",
          flows: [{ callee: "b", argIndex: 0, param: "p", line: 11 }],
        }),
        fact("f", "b", 20, {
          params: "q",
          flows: [
            { callee: "a", argIndex: 0, param: "q", line: 21 },
            { callee: "eval", argIndex: 0, param: "q", line: 22 },
          ],
        }),
      ],
      [
        edge("f", "entry", "f", "a", 2),
        edge("f", "a", "f", "b", 11),
        edge("f", "b", "f", "a", 21),
        edge("f", "b", "f", "eval", 22),
      ]
    );
    expect(r.stats.stepBudgetExhausted).toBe(false);
    for (const p of r.paths) {
      const names = p.nodes.map((n) => n.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(r.paths.some((p) => p.endKind === "rce")).toBe(true);
  });

  it("预算丢失必须置位 truncated —— 绝不静默", () => {
    // 步数预算压到极小，必然烧穿；此时 truncated 必须为 true，
    // 否则画像不会提示，用户以为看到的就是全部。
    const { facts, edges } = diamond();
    const r = buildTaintPaths(facts, edges, { maxSteps: 1 });
    expect(r.stats.stepBudgetExhausted).toBe(true);
    expect(r.stats.truncated).toBe(true);
  });

  it("单 source 配额：一个入口不能独占全部路径预算", () => {
    const { facts, edges } = diamond();
    const r = buildTaintPaths(facts, edges, { maxPathsPerSource: 1 });
    expect(r.paths.length).toBe(1);
    expect(r.stats.sourceBudgetExhausted).toBe(true);
    expect(r.stats.truncated).toBe(true);
  });

  it("扇出闸门：单节点展开超限即整体放弃该节点（对标 maxArgsToAllow fail-closed）", () => {
    // `eval` 置于首位：既让该入口可证明走到 sink（否则被 ④ 预筛掉、走不到扇出判定），
    // 又保证闸门触发前先有一条路径落袋，验证「放弃该节点」而非「放弃整个入口」。
    const flows = [
      { callee: "eval", argIndex: 0, param: "req", line: 99 },
      ...Array.from({ length: 80 }, (_, i) => ({
        callee: `sink${i}`,
        argIndex: 0,
        param: "req",
        line: 100 + i,
      })),
    ];
    const r = buildTaintPaths(
      [fact("f", "hub", 1, { params: "req", flows })],
      [edge("f", "hub", "f", "sink0", 100)],
      { maxFanOut: 8 }
    );
    expect(r.stats.fanOutTruncated).toBe(true);
    expect(r.stats.truncated).toBe(true);
  });
});
