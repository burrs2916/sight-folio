import { describe, expect, it } from "vitest";
import zhCN from "../zh-CN.json";
import enUS from "../en-US.json";
import { t } from "../index";
import { GRADE_HINT } from "../../editor/utils/architectureMetrics";
import { RISK_DIMENSIONS } from "../../ai/providers/riskCorrelation";

/**
 * 语言包结构完整性守卫。
 *
 * 背景（为什么需要这个测试）：
 * t() 的查找只有两条路 —— ① 整键在根层扁平命中；② 按 '.' 逐层下钻。
 * 因此「键名自身含点」的嵌套键是一条**谁也走不到的死路**：
 *
 *   risk.dim: { "complexity.unit": "CC" }   ← 键名含点
 *   代码写 t("risk.dim.complexity.unit")     ← 下钻到 risk.dim.complexity 时
 *                                              拿到的是字符串 "复杂度"，再进不去 unit
 *
 * 结果就是 t() 走到最终兜底、把**原始 key 直接渲染到界面上**。
 * 2026-09 排查时全包有 9 个这种键（risk.dim.*.unit 8 个 + analyzer.svelte 1 个），
 * 连带 10 条引用全部不可达，界面漏出 `health.grade.A`、`risk.dim.complexity.unit`
 * 之类的裸 key。
 *
 * 这个测试从结构上堵死这一类复发：只要键名里出现点，就直接失败。
 */

type Dict = { [k: string]: string | Dict };

interface PackScan {
  /** 完整点分路径 → 文案 */
  values: Map<string, string>;
  /** 「嵌套层级上的含点键名」完整路径（本文件要防死的形态） */
  nestedDottedKeys: string[];
}

function scan(node: Dict, prefix = "", acc?: PackScan): PackScan {
  const out: PackScan = acc ?? { values: new Map(), nestedDottedKeys: [] };
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // 注意：含点判定必须在**判类型之前**做。风险案例里 "complexity.unit" 的值是
    // 字符串，若只在对象分支里检查，恰好漏掉的就是真正会漏裸 key 的那一类。
    // 根层键允许含点（resolve 的「整键扁平命中」分支就是为此存在的）；
    // 只有嵌套层级的含点键名是死路。
    if (prefix !== "" && k.includes(".")) out.nestedDottedKeys.push(path);
    if (typeof v === "string") {
      out.values.set(path, v);
    } else {
      scan(v, path, out);
    }
  }
  return out;
}

const zhScan = scan(zhCN as unknown as Dict);
const enScan = scan(enUS as unknown as Dict);

/** t() 未命中时会原样返回 key —— 用这个判别「可解析」 */
const resolves = (key: string) => t(key) !== key;

describe("语言包结构完整性", () => {
  it("嵌套键名不得含点（含点键名是下钻走不到的死路，会漏出裸 key）", () => {
    expect(zhScan.nestedDottedKeys).toEqual([]);
    expect(enScan.nestedDottedKeys).toEqual([]);
  });

  it("中文包与英文包键位必须完全一致（切语言不允许出现空洞）", () => {
    const zhKeys = [...zhScan.values.keys()].sort();
    const enKeys = [...enScan.values.keys()].sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("架构健康度等级判语必须可解析", () => {
    const grades = Object.entries(GRADE_HINT);
    expect(grades.length).toBe(5);
    for (const [grade, key] of grades) {
      expect(resolves(key), `${grade} 等级判语 ${key} 解析不到`).toBe(true);
    }
  });

  it("风险维度的标签与单位必须可解析", () => {
    expect(RISK_DIMENSIONS.length).toBeGreaterThan(0);
    for (const dim of RISK_DIMENSIONS) {
      expect(resolves(dim.labelKey), `${dim.key} 标签 ${dim.labelKey} 解析不到`).toBe(true);
      expect(resolves(dim.unitKey), `${dim.key} 单位 ${dim.unitKey} 解析不到`).toBe(true);
    }
  });

  it("AI 洞察面板文案必须可解析", () => {
    const keys = [
      "aiPanel.insights.title",
      "aiPanel.insights.pending",
      "aiPanel.insights.resolved",
      "aiPanel.insights.empty",
      "aiPanel.insights.canvasOn",
      "aiPanel.insights.canvasOff",
      "aiPanel.insights.refresh",
      "aiPanel.insights.unresolvedTip",
      "aiPanel.insights.unresolvedCount",
      "aiPanel.insights.filterEmpty",
      "aiPanel.insights.refPositions",
      "aiPanel.insights.confirmedTip",
      "aiPanel.insights.confirmedTimes",
      "aiPanel.insights.stableLine",
      "aiPanel.insights.evidenceChanged",
      "aiPanel.insights.morePlaces",
      "aiPanel.insights.evidenceGone",
      "aiPanel.insights.locateCanvasTip",
      "aiPanel.insights.locateCanvas",
      "aiPanel.insights.openSourceTip",
      "aiPanel.insights.resolvedAt",
      "aiPanel.insights.resolvedBy",
      "aiPanel.insights.noReason",
      "aiPanel.insights.resolvePlaceholder",
      "aiPanel.insights.confirmBtn",
      "aiPanel.insights.markResolvedTip",
      "aiPanel.insights.markResolved",
      "aiPanel.insights.refLocateToast",
    ];
    for (const key of keys) {
      expect(resolves(key), `${key} 解析不到`).toBe(true);
    }
  });
});
