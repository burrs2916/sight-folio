/**
 * 重构四象限画像
 *
 * runQuadrantPortrait（变更热度×复杂度二维散点，先重构谁）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place } from './canvas';
import { currentInsights, fileConfig } from './shared';
import { type PortraitOutcome } from './types';
import { t, resolveFragments } from '../../../i18n';
import { type ProjectFile } from '../../../services/tauri';
import { useProjectStore } from '../../../store/projectStore';
import { useSceneStore } from '../../../store/sceneStore';
import { emptyFileInsight, QUADRANT_HINT, QUADRANT_HINT_RISK, QUADRANT_HINT_DUP, QUADRANT_HINT_SIZE, QUADRANT_META, type FileInsight, type RiskQuadrant } from '.././fileInsights';


/**
 * 重构四象限画像：churn（变更频率）× complexity（圈复杂度）散点分区。
 *
 * v2.28 自愈（根治「不能用」）：象限依赖两个维度——complexity 来自 store.metrics、
 * churn 来自 store.gitChurn。两者都是扫描阶段产物，若内存 store 未填充（扫描漏跑
 * metrics/git 阶段、或本会话首次打开画像前未载入），所有文件 churnScore 与 complexity
 * 全是 0 → 被下方 filter 全滤掉 → 永远 quadNoData，且此前无自愈、无强制刷新入口，
 * 与 dataFlow/callGraph 早期「体感不能用」完全同因。现在：store 空或 force 时先
 * loadMetrics/loadGitChurn 从库补回；仍空则 analyzeMetrics/analyzeGitHistory 重算
 * （projectRoot 由 runPortrait 透传；非 git 仓库 analyzeGitHistory 直接返回空数组并把
 * isGitRepo 置 false，象限仍可凭 complexity 维出图，仅缺变更轴）。
 */
export async function runQuadrantPortrait(
  analysisId: string,
  projectRoot?: string | null,
  force?: boolean,
  nameFilter?: string,
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  // v2.31 加固：菜单路径在某些分支下可能未把 projectRoot 透传到画像（历史上曾导致横轴
  // 塌陷成竖线）。活跃场景（AnalysisDSL）必然携带 projectRoot，这里做兜底派生，
  // 保证 churn 自愈（analyzeGitHistory）在 git 仓库下一定能被触发，杜绝「竖线」退化。
  const sceneRoot = useSceneStore.getState().getActiveScene()?.projectRoot;
  const effectiveRoot =
    projectRoot && projectRoot.trim()
      ? projectRoot.trim()
      : sceneRoot && sceneRoot.trim()
        ? sceneRoot.trim()
        : undefined;

  const needMetrics = force || pst.metrics.length === 0;
  const needChurn = force || pst.gitChurn.length === 0;

  if (needMetrics) {
    // 先尝试从库补回（扫描已跑过时零成本）；没有再重算
    if (!force) await pst.loadMetrics(analysisId);
    if (useProjectStore.getState().metrics.length === 0) {
      await pst.analyzeMetrics(analysisId);
    }
  }
  if (needChurn) {
    if (!force) await pst.loadGitChurn(analysisId);
    if (useProjectStore.getState().gitChurn.length === 0 && effectiveRoot) {
      await pst.analyzeGitHistory(analysisId, effectiveRoot);
    }
  }

  // 自愈后重取 store 快照，判定两轴可用性与真实数据存在性
  const afterPst = useProjectStore.getState();

  // v2.32 横轴数据源自适应（根治「非 git 仓库 → 竖线塌缩」这一最典型的「不能用」观感）：
  // - 有 git 变更热度 → 横轴=变更频率（教科书 churn×complexity 四象限）
  // - 无 git 变更但有审查发现 → 横轴回退为「审查风险分」(error×5+warning×2+info)
  // - 以上皆无 → 回退到「代码重复率」（扫描必然落库，仍保持二维意义）
  // - 连重复率都为 0 → 回退到「文件规模（行数）」，scan 永远落库，保证横轴至少有 spread
  // v2.38：把最终 xAxis 的判定推迟到 rows（已带 churnScore/riskScore/duplicationRatio）构建后，
  // 用「真实信号是否存在」而非「数组非空」判定，杜绝「数组有元素但分值全 0 → 竖线」的塌缩。
  // 至此四个候选维度任一有信号画像即为二维散点，size 维度兜底下横轴永不塌缩成竖线。
  let xAxis: 'churn' | 'risk' | 'duplication' | 'size' = 'size';

  // v2.32 真实信号过滤：emptyFileInsight 默认 complexity=1，若沿用旧 `complexity>0`
  // 会把「未扫描/无度量」项目里每个文件都算进来 → 渲染出一坨堆在左上的假点
  // （renderable but useless）。改为只保留「真有信息量」的文件：圈复杂度>1（真实度量）
  // 或 有变更热度 或 有审查风险分 或 有代码重复。无信号文件直接剔除，避免假点阵误导。
  const insights = currentInsights();
  // v2.35 鲁棒兜底：真实圈复杂度来自 metrics 阶段，若该阶段未产出（扫描漏跑 /
  // 大仓 analyzeMetrics 静默失败 / 用户在扫描完成前就点开画像），所有文件
  // complexity 退化成 1 → 旧 filter `complexity>1` 把全仓文件滤光 → quadNoData
  // 渲染空白，用户体感即「不能用」。这里派生代理复杂度（符号数 + 行数，二者
  // 都是扫描必然落库的数据），让真实代码文件永远拿到 >1 的可区分分值，
  // 画像始终能回答「先重构谁」；只有 0 文件（真无数据）才诚实 quadNoData。
  const effComplexityOf = (f: ProjectFile, ins: FileInsight): number =>
    ins.complexity > 1 ? ins.complexity : Math.max(1, Math.round((ins.symbolCount || 0) / 3 + (f.lineCount || 0) / 25));
  const nf = nameFilter && nameFilter.trim() ? nameFilter.trim().toLowerCase() : '';
  const rows = afterPst.files
    .filter((f) => !f.isDirectory)
    .map((f) => ({ file: f, ins: insights.get(f.id) ?? emptyFileInsight() }))
    .map((r) => ({ ...r, effCc: effComplexityOf(r.file, r.ins) }))
    .filter(
      (r) =>
        (r.effCc > 1 || r.ins.churnScore > 0 || r.ins.riskScore > 0 || r.ins.duplicationRatio > 0) &&
        (!nf || r.file.name.toLowerCase().includes(nf)),
    );

  // v2.38 横轴最终判定（基于真实信号，优先级 churn>risk>dup>size）：
  // 只要 rows 里任一文件在对应维度有正值，就铺开该横轴；否则顺延到下一个候选。
  // size（文件行数）几乎恒有正值，故 rows 非空时横轴恒为二维，根治「竖线=不能用」。
  if (rows.some((r) => r.ins.churnScore > 0)) xAxis = 'churn';
  else if (rows.some((r) => r.ins.riskScore > 0)) xAxis = 'risk';
  else if (rows.some((r) => r.ins.duplicationRatio > 0)) xAxis = 'duplication';
  else xAxis = 'size';

  if (rows.length === 0) {
    // v2.37 可行动兜底：此前无数据/无匹配时返回 ok:false → handlePortrait 静默移除空白视图，
    // 用户看到「点了没反应、什么都没出现」= 体感「不能用」。改为在视图内渲染引导卡
    // （视图保留、可见、可解释），明确告知「为何无图 / 该做什么」，把沉默失效变成可行动指引。
    const emptyMsg = nf ? t('portrait.msg.quadNoMatch', { q: nameFilter!.trim() }) : t('portrait.msg.quadNoData');
    clearCanvas();
    place('layer-marker', { x: 380, y: 360 }, emptyMsg, { layerName: emptyMsg, layerColor: '#EF9F27', layerOrder: 0 });
    if (!nf) {
      const hint = t('portrait.msg.quadNoDataHint');
      place('layer-marker', { x: 300, y: 398 }, hint, { layerName: hint, layerColor: '#94a3b8', layerOrder: 0 });
    }
    await persist(analysisId, 'quadrant');
    return { ok: true, message: emptyMsg, severity: 'info', placed: 0 };
  }

  clearCanvas();

  // v2.34 紧凑可定位节点：把 180×60 大卡换成 118×44 紧凑芯片，配合「按节点尺寸分桶」的
  // 网格避让，让散点真正互不重叠（此前 453 张 180×60 大卡挤成一团色块，是「图是乱的 /
  // 不能用」根源）。节点越小，fit 全览退化成色块后的可读性反而越高，放大后 compact 档仍是可读卡。
  const LEFT = 70;
  const TOP = 64;
  const W = 780; // 散点区宽度（右侧留作「优先重构」排行栏）
  const H = 720;
  const NODE_W = 118;
  const NODE_H = 44;

  // v2.30 避免超大仓库（>~65k 文件）时 Math.max(...spread) 触发 RangeError: Maximum call stack。
  // 改用 reduce 扫描求极值，零栈深开销。
  const xValOf = (r: { file: ProjectFile; ins: FileInsight }): number =>
    xAxis === 'churn'
      ? r.ins.churnScore
      : xAxis === 'risk'
        ? r.ins.riskScore
        : xAxis === 'duplication'
          ? Math.round((r.ins.duplicationRatio ?? 0) * 100)
          : xAxis === 'size'
            ? r.file.lineCount || 0
            : 0;
  const maxX = rows.reduce((m, r) => Math.max(m, xValOf(r)), 1);

  // v2.39 可读性根治：真实仓库 churn/复杂度呈长尾分布（少数文件极高、多数极低），
  // 旧 sqrt 归一化把绝大多数文件压在左下角，四象限严重失衡、可读性崩坏 = 用户体感「图看不出名堂 / 不能用」。
  // 改用「秩百分位」铺开：每文件按横轴/纵轴真实值从高到低排名，名次均匀映射 0~1，
  // 四象限恒为均衡分位（各约 1/4），既保留「高复杂×高变更=右上优先重构」语义，又让每个文件都可见、可定位。
  const sortedByX = [...rows].sort((a, b) => xValOf(b) - xValOf(a));
  const rankXOf = new Map<string, number>();
  // 名次 i=0 为最高值 → 映射 1（右侧/上方）；i 越大值越低 → 映射 0，保证「高变更在右、高复杂在上」
  sortedByX.forEach((r, i) => rankXOf.set(r.file.id, rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5));
  const sortedByCc = [...rows].sort((a, b) => b.effCc - a.effCc);
  const rankYOf = new Map<string, number>();
  sortedByCc.forEach((r, i) => rankYOf.set(r.file.id, rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5));
  const nxOf = (r: { file: ProjectFile }): number => rankXOf.get(r.file.id) ?? 0.5;
  const nyOf = (r: { file: ProjectFile }): number => rankYOf.get(r.file.id) ?? 0.5;

  // v2.41 坐标轴 + 刻度数值 + 公式：把「象限」做成真正的坐标系，而非只有四块色区。
  // 刻度按「节点中心映射」定位（与散点落点、象限分界线严格对齐），数值取 0/25/50/75/100
  // 百分位对应的真实度量值（横轴=当前 xAxis 维度，纵轴=圈复杂度）—— 刻度即真实数据，
  // 不是抽象名次；十字轴落在象限中线上，既对齐分区边界、又压在对应文件列上。
  const axisXFrac = (p: number): number => (p * (W - NODE_W) + NODE_W / 2) / W;
  const axisYFrac = (p: number): number => ((1 - p) * (H - NODE_H) + NODE_H / 2) / H;
  const fmtX = (v: number): string => (xAxis === 'duplication' ? `${Math.round(v)}%` : `${Math.round(v)}`);
  const pcts = [0, 0.25, 0.5, 0.75, 1];
  const nRows = rows.length;
  const xTicks = pcts.map((p) => {
    const idx = Math.min(nRows - 1, Math.max(0, Math.round(p * (nRows - 1))));
    return { frac: axisXFrac(p), label: fmtX(xValOf(sortedByX[idx])) };
  });
  const yTicks = pcts.map((p) => {
    const idx = Math.min(nRows - 1, Math.max(0, Math.round(p * (nRows - 1))));
    return { frac: axisYFrac(p), label: `${Math.round(sortedByCc[idx].effCc)}` };
  });
  const axisXTitle =
    xAxis === 'churn'
      ? t('portrait.msg.quadAxisXChurn')
      : xAxis === 'risk'
        ? t('portrait.msg.quadAxisXRisk')
        : xAxis === 'duplication'
          ? t('portrait.msg.quadAxisXDup')
          : t('portrait.msg.quadAxisXSize');
  const axisYTitle = t('portrait.msg.quadAxisY');
  const axisFormula = t('portrait.msg.quadAxisFormula');
  const axisHint = t('portrait.msg.quadAxisHint');

  // v2.33 可读性收敛：大仓下文件节点可达数百（如本项目 445+），全量绘制会让散点
  // 在画布上严重重叠成一团不可读的色块，用户体感即「图是乱的 / 不能用」。
  // 按「重构优先级」取 Top-N 绘制 —— 复合分 = 复杂度 ×(1 + 横轴值/最大值)，
  // 自然把「高复杂×高变更」的优先重构文件排在最前；其余低复杂度/低变更文件
  // 本就不是「先重构谁」的关注对象，省略绘制并在底部说明已省略数量。
  // 散点区 780×720 配 130×52 避让单元约 78 格，70 ≤ 78 保证 Top-N 无需螺旋即可各自占位。
  const PLOT_CAP = 70;
  const rankScore = (r: { file: ProjectFile; ins: FileInsight; effCc: number }): number =>
    r.effCc * (1 + xValOf(r) / (maxX || 1));
  const ranked = [...rows].sort((a, b) => rankScore(b) - rankScore(a));
  // v2.37：带文件名筛选时不再截断（匹配集通常很小），确保「用户要找的文件」一定出现，
  // 不被 Top-70 优先级门槛挡掉；无筛选才保留 Top-70 紧凑布局。
  const truncated = !nf && ranked.length > PLOT_CAP;
  const plotted = nf ? ranked : truncated ? ranked.slice(0, PLOT_CAP) : ranked;

  // v2.32 标题/图例区：两轴含义与当前横轴数据源的说明，现由 quadrant-axis 渲染器
  // 统一承载（轴名 + 秩百分位公式 + 右上=优先重构 行动指引），单一可信源、零冗余。
  // 此处不再重复放置底部长公式 layer-marker（避免与坐标轴渲染器重复、造成「公式不完整」观感）。

  // v2.33 截断提示：大仓省略了低优先级文件时，在底部明确告知「只画了 Top-N，
  // 共 N 个文件参与评估」，避免用户误以为画像漏了数据。
  if (truncated) {
    place(
      'layer-marker',
      { x: LEFT + W / 2 - 250, y: TOP + H + 44 },
      t('portrait.msg.quadTopN', { shown: PLOT_CAP, total: rows.length }),
      {
        layerName: t('portrait.msg.quadTopN', { shown: PLOT_CAP, total: rows.length }),
        layerColor: '#a855f7',
        layerOrder: 0,
      },
    );
    // v2.39 大仓定位可达性：散点仅画 Top-N，其余文件被截断，用户常找不到自己关心的文件
    // = 体感「图里没有我要的 / 不能用」。补一行提示：顶部搜索框按文件名筛选可绕过截断、任意文件必现。
    place('layer-marker', { x: LEFT + W / 2 - 250, y: TOP + H + 74 }, t('portrait.msg.quadSearchHint'), {
      layerName: t('portrait.msg.quadSearchHint'),
      layerColor: '#64748b',
      layerOrder: 0,
    });
  }

  // v2.29 象限背景区：在散点图底层铺四块半透明色区，让「高复杂×高变更」等四象限
  // 一眼可辨（散点图若无分区边界，用户无法判断「右上角=优先重构」），回答「先重构谁」。
  // 背景区不可点击（pointer-events:none，命中测试让给上方 file 节点），仅作视觉分区。
  const ZONE_BG: { key: RiskQuadrant; rx: number; ry: number }[] = [
    { key: 'legacyStable', rx: LEFT, ry: TOP }, // 左上：高复杂×低变更
    { key: 'refactorFirst', rx: LEFT + W / 2, ry: TOP }, // 右上：高复杂×高变更
    { key: 'healthy', rx: LEFT, ry: TOP + H / 2 }, // 左下：低复杂×低变更
    { key: 'activeSimple', rx: LEFT + W / 2, ry: TOP + H / 2 }, // 右下：低复杂×高变更
  ];
  for (const z of ZONE_BG) {
    const meta = QUADRANT_META[z.key];
    // v2.47 给背景组件一个有意义的名称（解析后的 i18n 文案），避免实体列表/选中信息里
    // 显示原始 key `entityProj.quadrantZoneBg.name`（此前 name 传空 → 回退到注册类型原始 key）。
    place(
      'quadrant-zone-bg',
      { x: z.rx, y: z.ry },
      t('entityProj.quadrantZoneBg.name'),
      {
        zoneColor: meta.color,
        zoneKey: z.key,
        w: W / 2,
        h: H / 2,
      },
      { w: W / 2, h: H / 2 },
    );
  }

  // 四象限背景标记（layer-marker 复用为区域标签）
  const zones: { key: RiskQuadrant; x: number; y: number }[] = [
    { key: 'legacyStable', x: LEFT, y: TOP - 34 },
    { key: 'refactorFirst', x: LEFT + W / 2, y: TOP - 34 },
    { key: 'healthy', x: LEFT, y: TOP + H / 2 - 34 },
    { key: 'activeSimple', x: LEFT + W / 2, y: TOP + H / 2 - 34 },
  ];
  for (const z of zones) {
    const meta = QUADRANT_META[z.key];
    // v2.32 横轴数据源自适应：非 git 仓库（横轴=审查风险分）时，区域标签的行动建议
    // 同步从「变更」口径切到「风险」口径，避免标签写「高变更」而真实横轴是风险分。
    // v2.38 横轴数据源自适应：重复率/规模回退时，区域标签行动建议同步切到对应口径，
    // 避免标签写「高变更」而真实横轴是重复率/规模（renderable but misleading）。
    const hintKey =
      xAxis === 'risk'
        ? QUADRANT_HINT_RISK[z.key]
        : xAxis === 'duplication'
          ? QUADRANT_HINT_DUP[z.key]
          : xAxis === 'size'
            ? QUADRANT_HINT_SIZE[z.key]
            : QUADRANT_HINT[z.key];
    place('layer-marker', { x: z.x, y: z.y }, resolveFragments(meta.label), {
      layerName: `${resolveFragments(meta.label)}（${resolveFragments(hintKey)}）`,
      layerColor: meta.color,
      layerOrder: 0,
      // v2.28 象限聚焦：区域标签携带 quadrantZone，单击即可高亮该象限全部文件、淡化其余
      // （SceneEditor onClick 捕获 layer-marker + quadrantZone → setQuadrantFocusZone）。
      quadrantZone: z.key,
    });
  }

  // v2.40 重叠根治：改为「网格分桶 + 唯一格占用」（见下），单元尺寸严格 ≥ 节点尺寸。
  const occupiedCell = new Set<number>();
  const counts: Record<RiskQuadrant, number> = {
    refactorFirst: 0,
    legacyStable: 0,
    activeSimple: 0,
    healthy: 0,
  };

  // v2.40 重叠根治：旧网格避让用 Math.round(x/CELL_W) 的「点式」单元键，但节点宽 118 ≈
  // 单元宽 130，相邻单元两节点水平仍重叠 50+px —— 即用户直观看到的「实体重叠」。
  // 改为「网格分桶 + 唯一格占用」：把散点区切成 COLS×ROWS 个严格 ≥ 节点尺寸的格，
  // 每个节点按归一化坐标定位到最近空闲格（螺旋搜索最近空格），每格只放一个节点。
  // 单元尺寸 ≥ 节点尺寸 + 间距，故任意两节点零重叠；网格有界，不会溢出画布。
  // 节点象限归属仍按数据归一化坐标 nx/ny 判定（与背景区对齐），与落格位置解耦，
  // 既保证「右上方=优先重构」语义，又彻底消除视觉重叠。
  const GAP_X = 10;
  const GAP_Y = 8;
  const CELL_W = NODE_W + GAP_X; // 128
  const CELL_H = NODE_H + GAP_Y; // 52
  const COLS = Math.max(1, Math.floor(W / CELL_W)); // ≈ 6
  const ROWS = Math.max(1, Math.floor(H / CELL_H)); // ≈ 13 → 78 格 ≥ PLOT_CAP(70)
  // v2.47 象限带约束（根治「位置≠象限」可视化错位）：散点按秩百分位定位后在网格内螺旋找
  // 最近空格，但旧逻辑不限制象限带 —— 理想格被占时螺旋可能把节点推到中线另一侧，
  // 导致「红卡（refactorFirst）却落在左半区」的视觉矛盾，用户读图困惑（renderable but misleading）。
  // 改为优先把螺旋搜索约束在节点「真实象限带」内（不越中线），保证视觉位置恒等于逻辑象限；
  // 仅在极端偏斜（某象限节点数超过带内容量）时回退全局搜索保零重叠（牺牲极少数位置精度）。
  const halfC = Math.floor(COLS / 2);
  const halfR = Math.floor(ROWS / 2);
  const quadBandOf = (zone: RiskQuadrant): { cMin: number; cMax: number; rMin: number; rMax: number } => {
    const right = zone === 'refactorFirst' || zone === 'activeSimple';
    const bottom = zone === 'activeSimple' || zone === 'healthy';
    return {
      cMin: right ? halfC : 0,
      cMax: right ? COLS - 1 : halfC - 1,
      rMin: bottom ? halfR : 0,
      rMax: bottom ? ROWS - 1 : halfR - 1,
    };
  };
  const spiralFreeCell = (c0: number, r0: number, cMin: number, cMax: number, rMin: number, rMax: number): number => {
    c0 = Math.min(cMax, Math.max(cMin, c0));
    r0 = Math.min(rMax, Math.max(rMin, r0));
    const maxR = Math.max(cMax - cMin, rMax - rMin) + 2;
    for (let radius = 0; radius <= maxR; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // 仅环
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < cMin || c > cMax || r < rMin || r > rMax) continue;
          const idx = r * COLS + c;
          if (!occupiedCell.has(idx)) {
            occupiedCell.add(idx);
            return idx;
          }
        }
      }
    }
    return -1;
  };
  const fitCell = (
    c0: number,
    r0: number,
    band: { cMin: number; cMax: number; rMin: number; rMax: number },
  ): number => {
    const inBand = spiralFreeCell(c0, r0, band.cMin, band.cMax, band.rMin, band.rMax);
    if (inBand >= 0) return inBand;
    // 兜底全局（极端偏斜时牺牲位置精度保零重叠，避免跨象限误标）
    return spiralFreeCell(c0, r0, 0, COLS - 1, 0, ROWS - 1);
  };

  let placedCount = 0;
  for (let i = 0; i < plotted.length; i++) {
    const { file: f, ins, effCc } = plotted[i];
    const rank = i + 1; // 全局重构优先级（ranked 降序，与排行栏一致）
    const nx = nxOf({ file: f });
    const ny = nyOf({ file: f });
    // v2.30 象限落区与散点坐标严格一致：按归一化坐标是否过中线（0.5）判定所属象限，
    // 与背景区 W/2、H/2 分界线完全对齐 —— 视觉位置即逻辑象限，聚焦命中零错位。
    // v2.47 此处先于落格计算，作为网格带约束（fitCell）的输入，杜绝跨中线漂移。
    const zoneByPos: RiskQuadrant =
      nx > 0.5 && ny > 0.5
        ? 'refactorFirst'
        : nx <= 0.5 && ny > 0.5
          ? 'legacyStable'
          : nx > 0.5 && ny <= 0.5
            ? 'activeSimple'
            : 'healthy';
    const idealX = LEFT + nx * (W - NODE_W);
    const idealY = TOP + (1 - ny) * (H - NODE_H); // 复杂度高 → 靠上
    const c0 = Math.floor((idealX - LEFT) / CELL_W);
    const r0 = Math.floor((idealY - TOP) / CELL_H);
    // v2.47 把网格落位约束在节点真实象限带内，保证视觉位置恒等于逻辑象限
    const idx = fitCell(c0, r0, quadBandOf(zoneByPos));
    let x: number;
    let y: number;
    if (idx >= 0) {
      const cc = idx % COLS;
      const rr = Math.floor(idx / COLS);
      x = LEFT + cc * CELL_W + (CELL_W - NODE_W) / 2;
      y = TOP + rr * CELL_H + (CELL_H - NODE_H) / 2;
    } else {
      x = Math.max(LEFT, Math.min(idealX, LEFT + W - NODE_W));
      y = Math.max(TOP, Math.min(idealY, TOP + H - NODE_H));
    }

    // 象限位置已编码「变更×复杂度」两维，左侧色条再编码第三维风险分（综合性热点）：
    // 高风险红、中风险橙、低风险绿。FileRenderer 的 stripe 优先用 accentColor 覆盖复杂度色条。
    // v2.20 修复：riskScore 是 0~N 的加权整数（error*5+warning*2+info*1，fileInsights.ts:441），
    // 对齐 gridStyle 风险口径（portraits.ts:436 的整数阈值）。
    const riskColor = ins.riskScore >= 40 ? '#EF4444' : ins.riskScore >= 15 ? '#F97316' : '#22c55e';
    const proxy = ins.complexity <= 1;
    const id = place(
      'file',
      { x, y },
      f.name,
      fileConfig(f, ins, 'quadrant', {
        accentColor: riskColor,
        quadrant: zoneByPos,
        // v2.45：全局重构优先级序号，画布卡左上角徽标直接读出「先重构谁」
        rank,
        // v2.38：把当前生效的横轴维度写进节点 config，画像面板据此显示一致的指标与建议
        quadrantXAxis: xAxis,
        // v2.35：代理复杂度诚实落库，使画像面板显示的分值与实际散点位置一致
        complexity: proxy ? effCc : ins.complexity,
        complexityProxy: proxy,
      }),
      { w: NODE_W, h: NODE_H },
    );
    if (id) {
      placedCount += 1;
      counts[zoneByPos] += 1;
    }
  }

  // v2.34 可行动排行栏：把「先重构谁」从散点里拎出来，右侧列出优先级 Top-N
  // 文件（复合分 rankScore 降序，即 plotted 的最优先者）。每张是带 fileId 的 file 实体
  // —— 双击即跳源码（复用 SceneEditor 双击 → navigateToSource 既有路径），比在散点里
  // 逐个找点更直给，真正落实「画像可行动」而非只「能渲染」（见项目铁律 renderable ≠ useful）。
  const RAIL_X = LEFT + W + 44;
  const RAIL_W = 286;
  const RAIL_ITEM_H = 42;
  const RAIL_GAP = 8;
  const RAIL_N = Math.min(12, ranked.length);
  place('layer-marker', { x: RAIL_X, y: TOP - 36 }, t('portrait.msg.quadRailTitle', { n: RAIL_N }), {
    layerName: t('portrait.msg.quadRailTitle', { n: RAIL_N }),
    layerColor: '#EF9F27',
    layerOrder: 0,
  });
  for (let i = 0; i < RAIL_N; i++) {
    const { file: f, ins, effCc } = ranked[i];
    const nxr = nxOf({ file: f });
    const nyr = nyOf({ file: f });
    const rk = ins.riskScore >= 40 ? '#EF4444' : ins.riskScore >= 15 ? '#F97316' : '#22c55e';
    const proxy = ins.complexity <= 1;
    const id = place(
      'file',
      { x: RAIL_X, y: TOP + i * (RAIL_ITEM_H + RAIL_GAP) },
      `#${i + 1} ${f.name}`,
      fileConfig(f, ins, 'quadrant', {
        accentColor: rk,
        quadrant:
          nxr > 0.5 && nyr > 0.5
            ? 'refactorFirst'
            : nxr <= 0.5 && nyr > 0.5
              ? 'legacyStable'
              : nxr > 0.5 && nyr <= 0.5
                ? 'activeSimple'
                : 'healthy',
        quadrantRail: true,
        rank: i + 1,
        quadrantXAxis: xAxis,
        complexity: proxy ? effCc : ins.complexity,
        complexityProxy: proxy,
      }),
      { w: RAIL_W, h: RAIL_ITEM_H },
    );
    if (id) placedCount += 1;
  }

  // v2.41 坐标轴 + 刻度数值 + 公式：最后绘制（覆盖在 file 节点之上）以保证刻度可读，
  // 但 pointer-events:none 不拦截节点交互。十字轴落在象限中线上（与 quadrant-zone-bg 分区
  // 边界严格对齐），刻度数值由上方 xTicks/yTicks 携带真实度量值。
  // v2.47 同象限背景：解析后的名称避免实体列表显示原始 key `entityProj.quadrantAxis.name`
  place(
    'quadrant-axis',
    { x: LEFT, y: TOP },
    t('entityProj.quadrantAxis.name'),
    { xTicks, yTicks, xTitle: axisXTitle, yTitle: axisYTitle, formula: axisFormula, hint: axisHint },
    { w: W, h: H },
  );

  await persist(analysisId, 'quadrant');

  const first = counts.refactorFirst;
  // v2.28：补四象限完整计数统计，让用户一眼看清分布（回答「先重构谁」的可行动信息），
  // 不再只报「优先重构」一档。counts 已在上方循环按 ins.quadrant 累加。
  return {
    ok: true,
    message:
      t('portrait.msg.quadDone', {
        n: placedCount,
        first: first > 0 ? t('portrait.msg.quadFirst', { n: first }) : t('portrait.msg.quadHealthy'),
      }) +
      t('portrait.msg.quadStats', {
        rf: counts.refactorFirst,
        ls: counts.legacyStable,
        as: counts.activeSimple,
        h: counts.healthy,
      }) +
      (truncated ? t('portrait.msg.quadTopNMsg', { shown: PLOT_CAP, total: rows.length }) : ''),
    severity: first > 0 ? 'warning' : 'success',
    placed: placedCount,
  };
}
