/**
 * 无头分析执行器的纯函数部分测试。
 *
 * 重点保护「省 token 的取数指令」这段文字——它是整套设计能否兑现的关键：
 * 一旦消息里带上原始数据、或忘了劝阻 action="get"，扫描结论就会被塞进每一轮
 * 对话历史反复重放，token 成本瞬间失控，而这类退化不会有任何报错。
 */
import { describe, it, expect } from "vitest";
import { buildAnalysisMessage, classifyReceipt, resolvePreset } from "../analysisRunner";
import type { AiAnalysisPreset } from "../contextTypes";

const presets: AiAnalysisPreset[] = [
  {
    key: "a",
    title: { "zh-CN": "A 预设", "en-US": "Preset A" },
    description: { "zh-CN": "", "en-US": "" },
    prompt: { "zh-CN": "任务 A", "en-US": "Task A" },
    sectionKeys: ["overview"],
  },
  {
    key: "b",
    title: { "zh-CN": "B 预设", "en-US": "Preset B" },
    description: { "zh-CN": "", "en-US": "" },
    prompt: { "zh-CN": "任务 B", "en-US": "Task B" },
  },
];

describe("resolvePreset", () => {
  it("按 key 精确命中", () => {
    expect(resolvePreset(presets, "b")?.key).toBe("b");
  });

  it("key 不存在时回退到第一个（自动化不能因为预设被改名就整条哑掉）", () => {
    expect(resolvePreset(presets, "not-exist")?.key).toBe("a");
  });

  it("不传 key 时用第一个", () => {
    expect(resolvePreset(presets)?.key).toBe("a");
  });

  it("模块没有任何预设时返回 undefined，由调用方报错", () => {
    expect(resolvePreset([], "a")).toBeUndefined();
  });
});

describe("buildAnalysisMessage", () => {
  const base = {
    preset: presets[0],
    packId: "analysis1:project-scan",
    scopeId: "analysis1",
    sectionKeys: ["overview", "hotspots"],
    withInsight: false,
  };

  it("包含 outline → section 的两步取数指令", () => {
    const msg = buildAnalysisMessage(base);
    expect(msg).toContain('action="outline"');
    expect(msg).toContain('action="section"');
    expect(msg).toContain("analysis1:project-scan");
  });

  it("明确劝阻拉全包（省 token 的核心约束）", () => {
    expect(buildAnalysisMessage(base)).toContain('不要用 action="get"');
  });

  it("列出建议读取的分节，帮 Agent 少走一轮试探", () => {
    expect(buildAnalysisMessage(base)).toContain("overview, hotspots");
  });

  it("未启用洞察工具时不下发无法执行的沉淀指令", () => {
    const msg = buildAnalysisMessage(base);
    expect(msg).not.toContain("context_insight");
  });

  it("启用洞察工具时要求先 list 再 save（避免重复给同样的结论）", () => {
    const msg = buildAnalysisMessage({ ...base, withInsight: true });
    expect(msg).toContain('context_insight(action="list"');
    expect(msg).toContain('context_insight(action="save"');
  });

  it("启用洞察工具时下发收口指令，并强调必须先核实（否则沉淀会被一键清空）", () => {
    const msg = buildAnalysisMessage({ ...base, withInsight: true });
    expect(msg).toContain('context_insight(action="resolve"');
    expect(msg).toContain("reviewQueue");
    expect(msg).toContain("仅在真正核实过时才收口");
  });

  // 保存侧会真的核验 refs 并拒收全幻觉的结论。这条规矩必须提前写进 prompt：
  // 让模型「原样复制路径」的成本，远低于让它先被退回一次再重试一轮。
  it("启用洞察工具时预先声明 refs 会被核验，并给出没有位置时的正确做法", () => {
    const msg = buildAnalysisMessage({ ...base, withInsight: true });
    expect(msg).toContain("核对");
    expect(msg).toContain("拒收");
    expect(msg).toContain("unanchored");
  });

  it("自动触发时带来源说明，Agent 不会反过来找用户确认", () => {
    const msg = buildAnalysisMessage({
      ...base,
      autoNote: "本次分析由系统在数据更新后自动发起，请直接开始，无需向用户确认。",
    });
    expect(msg).toContain("自动发起");
  });

  it("任务指令始终在最前，上下文说明在后（模型对开头指令最敏感）", () => {
    const msg = buildAnalysisMessage(base);
    expect(msg.indexOf("任务 A")).toBeLessThan(msg.indexOf("上下文获取方式"));
  });

  // ——— 原始记录下钻（scan_records）———
  // 分节明细是 Top-N 截断。若不把这件事写给 Agent，它会拿前 15 名当全集下全局结论，
  // 而这种失真不会报错、也不会被任何类型检查拦住，只能靠这几条断言守住。

  it("未启用下钻工具时不提 scan_records（不给它指一个调不到的工具）", () => {
    const msg = buildAnalysisMessage(base);
    expect(msg).not.toContain("scan_records");
  });

  it("未启用下钻工具时仍须声明 Top-N 不是全集，避免过度外推", () => {
    const msg = buildAnalysisMessage(base);
    expect(msg).toContain("Top-N");
    expect(msg).toContain("不要把排名靠前的样本当作全部");
  });

  it("启用下钻工具时给出 datasets → query 的两步下钻路径", () => {
    const msg = buildAnalysisMessage({ ...base, withRecords: true });
    expect(msg).toContain('scan_records(action="datasets"');
    expect(msg).toContain('scan_records(action="query"');
    expect(msg).toContain("analysis1");
  });

  it("启用下钻工具时强调完整性可感知（total/hasMore）与先缩小范围再翻页", () => {
    const msg = buildAnalysisMessage({ ...base, withRecords: true });
    expect(msg).toContain("hasMore");
    expect(msg).toContain("不要盲目翻页");
  });

  it("启用下钻工具时必须警告「0 行 ≠ 没问题」（AI 分析里最贵的误读）", () => {
    const msg = buildAnalysisMessage({ ...base, withRecords: true });
    expect(msg).toContain("safeToConcludeAbsence");
    expect(msg).toContain("不得下阴性结论");
  });

  it("启用下钻工具时劝阻用 file_read 重新推导已算好的数字（省 token 的关键一句）", () => {
    const msg = buildAnalysisMessage({ ...base, withRecords: true });
    expect(msg).toContain("file_read");
  });

  it("下钻指令与洞察沉淀可以叠加，互不覆盖", () => {
    const msg = buildAnalysisMessage({ ...base, withInsight: true, withRecords: true });
    expect(msg).toContain('context_insight(action="save"');
    expect(msg).toContain('scan_records(action="datasets"');
    // 取数顺序仍是「先分节目录，后下钻明细」——下钻是验证手段，不是入口
    expect(msg.indexOf('action="outline"')).toBeLessThan(msg.indexOf("scan_records"));
  });

  // ——— 焦点派单：点名 + 指一条取数的路 ———
  //
  // 点名把任务形状变成了「去看某个文件」，而上下文包的形状是「按维度各给 Top-15」。
  // 被点名的恰恰是每一维都排在十几二十名、在任何分节里都查不到的共振文件。
  // 只点名不指路，Agent 就只能逐个数据集翻（调用爆炸）或 file_read 读源码（token 爆炸），
  // 后者更糟——它等于把整套扫描成果扔掉重算。

  const focus = [
    { filePath: "src/core/hot.ts", resonance: 4, note: "复杂度第 18 / 变更第 21", state: "never" },
    { filePath: "src/util/misc.ts", resonance: 3, note: "扇入第 12", state: "stale-data" },
  ] as never;

  it("不点名时完全不出现焦点段落（绝大多数轮次都不该被这段噪声占位）", () => {
    expect(buildAnalysisMessage(base)).not.toContain("本轮必须覆盖的目标");
    expect(buildAnalysisMessage({ ...base, focusTargets: [] })).not.toContain("本轮必须覆盖的目标");
  });

  it("点名时逐个列出文件路径与共振说明", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus });
    expect(msg).toContain("本轮必须覆盖的目标");
    expect(msg).toContain("src/core/hot.ts");
    expect(msg).toContain("复杂度第 18 / 变更第 21");
  });

  it("上次巡查后数据变了的目标要标出来，Agent 才知道这是复核不是初查", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus });
    expect(msg).toContain("上次巡查后数据已变");
  });

  it("必须先声明「这些文件在单维 Top-N 里查不到」，否则 Agent 会当成数据缺失跳过", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus });
    expect(msg).toContain("不出现");
    expect(msg).toContain("不要因为「别处没提到」就跳过");
  });

  it("启用下钻工具时指路到 dossier —— 一次调用取回单文件全维度画像", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withRecords: true });
    expect(msg).toContain('scan_records(action="dossier"');
    expect(msg).toContain('path="上面的文件路径"');
  });

  it("指路的同时必须堵死两条昂贵歧路：逐数据集拼装、file_read 重算", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withRecords: true });
    expect(msg).toContain("不要**为了拼出同一份信息去逐个数据集 query");
    expect(msg).toContain("file_read");
    expect(msg).toContain("最浪费 token 的动作");
  });

  it("必须交代 clean / blind 的区别（把「没查」说成「没问题」是最贵的失真）", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withRecords: true });
    expect(msg).toContain("`clean`");
    expect(msg).toContain("`blind`");
    expect(msg).toContain("一个字都不要断言");
  });

  it("告知已有结论会随档案返回，避免每轮把同一个问题重新想一遍", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withRecords: true });
    expect(msg).toContain("aiInsights");
  });

  it("路径写不准有救济通道，避免它凭印象编一个路径出来", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withRecords: true });
    expect(msg).toContain("ambiguous");
    expect(msg).toContain("不要凭印象编路径");
  });

  it("未启用下钻工具时点名照旧，但绝不指路到一个它调不到的工具", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus });
    expect(msg).toContain("src/core/hot.ts");
    expect(msg).not.toContain("dossier");
    expect(msg).not.toContain("scan_records");
  });

  it("启用洞察工具时要求「判定没问题也要留 info 级记录」（否则下一轮重复点名白烧钱）", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus, withInsight: true });
    expect(msg).toContain('severity="info"');
    expect(msg).toContain("没有记录的巡查等于没有发生过");
  });

  it("未启用洞察工具时降级为「在回答里单列一段」，不下发存不进去的指令", () => {
    const msg = buildAnalysisMessage({ ...base, focusTargets: focus });
    expect(msg).toContain("在回答里单列一段结论");
    expect(msg).not.toContain('severity="info"');
  });

  it("通用下钻指引里也提到 dossier —— 盯住某个具体文件时它永远比逐维 query 便宜", () => {
    const msg = buildAnalysisMessage({ ...base, withRecords: true });
    expect(msg).toContain('scan_records(action="dossier"');
    expect(msg).toContain("单个文件");
  });
});

/**
 * 回执判定 —— 「已发起」与「已分析」之间那道容易漏掉的闸门。
 *
 * 覆盖台账把 triggered 读作「这个维度分析过了」。若结局无人回填，
 * 一次半路夭折的对话就会永久点亮绿灯，而用户看到的只是「它说分析过了，可我啥也没看到」。
 */
describe("classifyReceipt", () => {
  const START = 1_700_000_000;

  it("对话抛错记为 error，并把原始消息留在 detail 里便于排查", () => {
    const v = classifyReceipt({ failure: new Error("model timeout"), startedAtSec: START });
    expect(v.outcome).toBe("error");
    expect(v.count).toBe(0);
    expect(v.detail).toContain("model timeout");
  });

  it("非 Error 类型的抛出物也要能记下来（模型 SDK 常抛字符串）", () => {
    const v = classifyReceipt({ failure: "connection reset", startedAtSec: START });
    expect(v.outcome).toBe("error");
    expect(v.detail).toContain("connection reset");
  });

  it("本轮之后被写过的洞察算作产出，记为 completed", () => {
    const v = classifyReceipt({
      insights: [{ lastSeen: START + 30 }, { lastSeen: START + 90 }, { lastSeen: START - 8000 }],
      startedAtSec: START,
    });
    expect(v.outcome).toBe("completed");
    expect(v.count).toBe(2);
  });

  it("同秒发起的那条不能被边界判掉（lastSeen 是秒级，允许 1 秒抖动）", () => {
    const v = classifyReceipt({ insights: [{ lastSeen: START - 1 }], startedAtSec: START });
    expect(v.count).toBe(1);
  });

  it("重新确认老结论也算产出——洞察去重只累加 seenCount 不新建行，按行数差算会冤枉复核", () => {
    // 一条老洞察被本轮重新确认：行还是那一行，但 lastSeen 被刷新到本轮之后
    const v = classifyReceipt({ insights: [{ lastSeen: START + 5 }], startedAtSec: START });
    expect(v.outcome).toBe("completed");
    expect(v.count).toBe(1);
  });

  it("跑完一条都没沉淀记为 no-output，绿灯不能给空转", () => {
    const v = classifyReceipt({ insights: [{ lastSeen: START - 3600 }], startedAtSec: START });
    expect(v.outcome).toBe("no-output");
    expect(v.count).toBe(0);
  });

  it("产出数取不到时记为 completed 而非 no-output——数不出来不等于没产出", () => {
    const v = classifyReceipt({ insights: undefined, startedAtSec: START });
    expect(v.outcome).toBe("completed");
    expect(v.detail).toContain("产出数不可用");
  });

  it("失败优先于产出统计：报错的那轮不该因为恰好有别的洞察被刷新而记成成功", () => {
    const v = classifyReceipt({
      failure: new Error("boom"),
      insights: [{ lastSeen: START + 10 }],
      startedAtSec: START,
    });
    expect(v.outcome).toBe("error");
  });
});
