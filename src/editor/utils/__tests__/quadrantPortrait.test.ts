/**
 * 重构四象限画像端到端验证（v2.34）
 *
 * 不信任「文档说已修复」—— 直接 mock 四个 store 跑通 runQuadrantPortrait，
 * 断言落库组件的数量 / 非重叠 / 象限归属 / 排行栏，真实验证「图不再是乱码、且可行动」。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runPortrait } from "../portraits";
import { useProjectStore } from "../../../store/projectStore";
import { useSceneStore } from "../../../store/sceneStore";
import { useEditorStore } from "../../../store/editorStore";
import { useToastStore } from "../../../store/toastStore";

const ANALYSIS = "analysis-1";
const ROOT = "/fake/root";

interface MockFile {
  id: string;
  name: string;
  relPath: string;
  complexity: number;
  churnScore: number;
  lineCount: number;
}

// 15 个文件：覆盖四象限 + 不同优先级，全部 complexity>1 故都会进入 rows。
// lineCount 各异（真实项目形态），用于验证「无 churn/risk/dup 时横轴回退 size 仍二维铺开」。
const SEED: MockFile[] = [
  { id: "f0", name: "godObject.ts", relPath: "src/godObject.ts", complexity: 50, churnScore: 100, lineCount: 820 },
  { id: "f1", name: "legacyCore.ts", relPath: "src/legacyCore.ts", complexity: 48, churnScore: 5, lineCount: 640 },
  { id: "f2", name: "hotUtil.ts", relPath: "src/hotUtil.ts", complexity: 3, churnScore: 90, lineCount: 60 },
  { id: "f3", name: "healthy.ts", relPath: "src/healthy.ts", complexity: 4, churnScore: 2, lineCount: 40 },
  { id: "f4", name: "a.ts", relPath: "src/a.ts", complexity: 20, churnScore: 40, lineCount: 320 },
  { id: "f5", name: "b.ts", relPath: "src/b.ts", complexity: 15, churnScore: 30, lineCount: 260 },
  { id: "f6", name: "c.ts", relPath: "src/c.ts", complexity: 12, churnScore: 20, lineCount: 200 },
  { id: "f7", name: "d.ts", relPath: "src/d.ts", complexity: 10, churnScore: 15, lineCount: 160 },
  { id: "f8", name: "e.ts", relPath: "src/e.ts", complexity: 9, churnScore: 10, lineCount: 140 },
  { id: "f9", name: "f.ts", relPath: "src/f.ts", complexity: 8, churnScore: 8, lineCount: 120 },
  { id: "f10", name: "g.ts", relPath: "src/g.ts", complexity: 7, churnScore: 6, lineCount: 100 },
  { id: "f11", name: "h.ts", relPath: "src/h.ts", complexity: 6, churnScore: 4, lineCount: 80 },
  { id: "f12", name: "i.ts", relPath: "src/i.ts", complexity: 5, churnScore: 3, lineCount: 70 },
  { id: "f13", name: "j.ts", relPath: "src/j.ts", complexity: 4, churnScore: 2, lineCount: 55 },
  { id: "f14", name: "k.ts", relPath: "src/k.ts", complexity: 3, churnScore: 1, lineCount: 45 },
];

let editorComponents: any[] = [];

function installMocks(opts?: { withMetrics?: boolean }) {
  const withMetrics = opts?.withMetrics ?? true;
  const files = SEED.map((s) => ({
    id: s.id,
    analysisId: ANALYSIS,
    path: `${ROOT}/${s.relPath}`,
    relPath: s.relPath,
    name: s.name,
    extension: ".ts",
    language: "typescript",
    size: s.lineCount,
    lineCount: s.lineCount,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: null,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    metadata: "",
    scannedAt: 0,
  }));
  const metrics = withMetrics
    ? SEED.map((s) => ({
        id: `m_${s.id}`,
        analysisId: ANALYSIS,
        fileId: s.id,
        filePath: s.relPath,
        totalLines: 100,
        codeLines: 80,
        commentLines: 10,
        blankLines: 10,
        cyclomaticComplexity: s.complexity,
        complexityLevel: s.complexity >= 20 ? "high" : "medium",
        metadata: "",
        createdAt: 0,
        engine: "ast",
        maxNesting: 3,
        functionCount: 5,
        maxFunctionCc: s.complexity,
      }))
    : [];
  const gitChurn = withMetrics
    ? SEED.map((s) => ({
        id: `c_${s.id}`,
        analysisId: ANALYSIS,
        fileId: s.id,
        filePath: s.relPath,
        commitCount: s.churnScore,
        addedLines: 0,
        deletedLines: 0,
        authorCount: 1,
        lastCommitAt: 0,
        firstCommitAt: 0,
        churnScore: s.churnScore,
        hotspotLevel: s.churnScore >= 50 ? "high" : "low",
        createdAt: 0,
      }))
    : [];

  (useProjectStore as any).getState = () => ({
    files,
    metrics,
    symbols: [],
    patternHits: [],
    symbolRefs: [],
    techDebt: [],
    gitChurn,
    callEdges: [],
    deadSymbols: [],
    findings: [],
    clones: [],
    loadMetrics: async () => {},
    analyzeMetrics: async () => {},
    loadGitChurn: async () => {},
    analyzeGitHistory: async () => {},
  });

  (useSceneStore as any).getState = () => ({
    getActiveScene: () => ({ projectRoot: ROOT }),
    updateScene: async () => {},
  });

  const editorState: any = {
    components: editorComponents,
    beginBatch: () => {},
    endBatch: () => {},
    addComponentsBulk: (items: any[]) => {
      const ids: string[] = [];
      for (const it of items) {
        editorComponents.push({
          id: `c${editorComponents.length}`,
          type: it.type,
          name: it.name,
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
          config: it.config,
        });
        ids.push(`c${editorComponents.length - 1}`);
      }
      return ids;
    },
    requestFit: () => {},
    exportSceneWithViews: () => ({ views: [], globalComponents: [], activeViewId: "v1" }),
  };
  (useEditorStore as any).setState = (updater: any) => {
    if (typeof updater === "function") updater(editorState);
  };
  (useEditorStore as any).getState = () => editorState;
  (useToastStore as any).getState = () => ({ showToast: () => {} });
}

beforeEach(() => {
  editorComponents = [];
  installMocks();
});

describe("runQuadrantPortrait (v2.34)", () => {
  it("renders 4 quadrant backgrounds, non-overlapping scatter, and an actionable ranked rail", async () => {
    const res = await runPortrait("quadrant", ANALYSIS, undefined, ROOT);
    expect(res.ok).toBe(true);

    const zoneBg = editorComponents.filter((c) => c.type === "quadrant-zone-bg");
    expect(zoneBg.length).toBe(4);

    // v2.41 坐标轴 + 刻度数值 + 公式：象限必须是真正的坐标系（十字轴 + 5 档刻度真实数值 + 轴名 + 公式）
    const axis = editorComponents.find((c) => c.type === "quadrant-axis");
    expect(axis).toBeTruthy();
    expect(Array.isArray(axis!.config.xTicks)).toBe(true);
    expect(axis!.config.xTicks.length).toBe(5);
    expect(axis!.config.yTicks.length).toBe(5);
    // 刻度必须携带真实数值（非空、可解析为数字或带 %），而非抽象名次
    for (const tk of axis!.config.xTicks as any[]) expect(String(tk.label).trim().length).toBeGreaterThan(0);
    for (const tk of axis!.config.yTicks as any[]) expect(String(tk.label).trim().length).toBeGreaterThan(0);
    expect(axis!.config.xTitle).toBeTruthy();
    expect(axis!.config.yTitle).toBeTruthy();
    expect(axis!.config.formula).toBeTruthy();
    expect(axis!.config.hint).toBeTruthy(); // 行动指引（右上=优先重构）必须随轴渲染

    const files = editorComponents.filter((c) => c.type === "file");
    // 15 散点（全部进入 rows，PLOT_CAP=70 不截断）+ 排行栏 Top-12 = 27
    expect(files.length).toBe(15 + 12);

    // 散点节点尺寸应为紧凑芯片 118×44
    const scatter = files.filter((c) => c.width === 118 && c.height === 44);
    expect(scatter.length).toBe(15);

    // v2.40 重叠根治回归：散点任意两节点的包围盒不得重叠（即用户直观看到的「实体重叠」根因）。
    // 旧逻辑用 Math.round(x/CELL_W) 点式单元键，相邻单元两节点仍水平重叠 50+px。
    // 新逻辑网格分桶，每格仅一个节点、单元 ≥ 节点尺寸，故任意两卡零重叠。
    const EPS = 0.5;
    for (let i = 0; i < scatter.length; i++) {
      for (let j = i + 1; j < scatter.length; j++) {
        const a = scatter[i];
        const b = scatter[j];
        const overlapX = a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS;
        const overlapY = a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
        expect(overlapX && overlapY).toBe(false);
      }
    }
    // 所有散点必须落在散点区边界内（网格有界，不溢出画布；LEFT=70,TOP=64,W=780,H=720）
    for (const c of scatter) {
      expect(c.x).toBeGreaterThanOrEqual(69);
      expect(c.y).toBeGreaterThanOrEqual(63);
      expect(c.x + c.width).toBeLessThanOrEqual(851);
      expect(c.y + c.height).toBeLessThanOrEqual(785);
    }

    // v2.39 可读性回归：秩百分位铺开，散点必须横跨左右两半（旧 sqrt 把多数文件压在左侧 = 失衡 / 看不出名堂）
    const leftHalf = scatter.filter((c) => c.x <= 401).length;
    const rightHalf = scatter.length - leftHalf;
    expect(leftHalf).toBeGreaterThan(0);
    expect(rightHalf).toBeGreaterThan(0);

    // v2.47 位置↔象限一致性回归：节点视觉落位必须恒等于其逻辑象限，杜绝「红卡却落在左半区」
    // 这类跨中线误标（renderable but misleading）。中线 x=LEFT+W/2=460→用 401 分隔左右带；
    // 中线 y=TOP+H/2=424→用 360 分隔上下带（带间留空，阈值无歧义）。
    for (const s of scatter) {
      const q = s.config.quadrant as string;
      const inRight = s.x > 401;
      const inTop = s.y <= 360;
      if (q === "refactorFirst") expect(inRight && inTop).toBe(true);
      else if (q === "legacyStable") expect(!inRight && inTop).toBe(true);
      else if (q === "activeSimple") expect(inRight && !inTop).toBe(true);
      else if (q === "healthy") expect(!inRight && !inTop).toBe(true);
    }

    // 高复杂 × 高变更 的 godObject 必落「优先重构」象限
    const god = files.find((c) => c.name === "godObject.ts");
    expect(god).toBeTruthy();
    expect(god!.config.quadrant).toBe("refactorFirst");

    // v2.45：重构优先级序号随节点落库，画布卡左上角徽标直接读出「先重构谁」
    // godObject 复合分最高 → 全局 rank = 1
    expect(god!.config.rank).toBe(1);
    for (const s of scatter) {
      expect(typeof s.config.rank === "number" && (s.config.rank as number) > 0).toBe(true);
    }

    // 排行栏：存在带 fileId 的可双击卡片（复用 navigateToSource 既有路径）
    const rail = files.filter((c) => c.width === 286 && c.height === 42);
    expect(rail.length).toBe(12);
    for (const r of rail) expect(r.config.fileId).toBeTruthy();
    // 排行栏卡片同样携带 rank（与散点同口径，面板/tooltip 一致）
    for (const r of rail) expect(typeof r.config.rank === "number").toBe(true);

    // 排行栏标题层标记存在，明确「优先重构 Top-N」
    const railTitle = editorComponents.find(
      (c) => c.type === "layer-marker" && typeof c.name === "string" && c.name.includes("优先重构")
    );
    expect(railTitle).toBeTruthy();

    // 数据契约：画像面板 QuadrantPortraitSection 依赖的字段必须随节点落库
    // （portraitMode=quadrant + churnScore/riskScore/complexity），否则点击散点节点
    // 仍是无专属信息的「死节点」（renderable but useless）。
    const sample = files.find((c) => c.name === "godObject.ts");
    expect(sample).toBeTruthy();
    expect(sample!.config.portraitMode).toBe("quadrant");
    expect(typeof sample!.config.churnScore).toBe("number");
    expect(typeof sample!.config.riskScore).toBe("number");
    expect(typeof sample!.config.complexity).toBe("number");
  });

  it("never renders blank when metrics stage is absent (proxy fallback keeps it usable)", async () => {
    // 模拟用户真实失败形态：扫描未产出 metrics / gitChurn / findings
    // （scan 漏跑、大仓 analyzeMetrics 静默失败、或用户扫描完成前就点开画像）。
    // 旧逻辑会因 complexity 全=1 把全仓文件滤光 → quadNoData 渲染空白 = 「不能用」。
    // v2.35 代理复杂度（符号数+行数）兜底下，画像仍应给出可读散点 + 排行栏。
    editorComponents = [];
    installMocks({ withMetrics: false });

    const res = await runPortrait("quadrant", ANALYSIS, undefined, ROOT);
    expect(res.ok).toBe(true);

    const files = editorComponents.filter((c) => c.type === "file");
    // 15 散点（代理复杂度使全部进入 rows）+ 排行栏 Top-12
    expect(files.length).toBe(15 + 12);

    // 散点节点均带 fileId（可双击跳源码），即「画像可行动」
    for (const f of files) expect(f.config.fileId).toBeTruthy();

    // 代理复杂度已诚实落库（panel 显示分值与散点位置一致，非恒 1）
    const scatter = files.filter((c) => c.width === 118 && c.height === 44);
    for (const s of scatter) expect(s.config.complexityProxy).toBe(true);

    // v2.38 横轴自适应兜底：churn/risk/dup 全缺时回退到 size（文件行数），
    // 散点必须仍是真正的二维铺开（≥2 个相异 x），而非退化成一条竖线 = 「不能用」。
    const xs = new Set<number>();
    for (const s of scatter) xs.add(Math.round(s.x));
    expect(xs.size).toBeGreaterThanOrEqual(2);
    // 节点须携带全局横轴维度，供面板显示一致指标
    for (const s of scatter) expect(s.config.quadrantXAxis).toBe("size");
  });
});
