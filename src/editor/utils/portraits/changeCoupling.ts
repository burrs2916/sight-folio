/**
 * 变更耦合画像
 *
 * rankRisk + runChangeCouplingPortrait（总在一起改的模块聚类）。
 * 本文件由 portraits.ts 按域切分生成（纯移动零行为变更），对外路径保持 '../portraits' 不变。
 */
import { persist, clearCanvas, place, connect } from './canvas';
import { MODULE_PALETTE } from './constants';
import { currentInsights, fileConfig, topDirOf } from './shared';
import { type PortraitOutcome } from './types';
import { t } from '../../../i18n';
import { useEditorStore } from '../../../store/editorStore';
import { useProjectStore } from '../../../store/projectStore';
import { emptyFileInsight } from '.././fileInsights';
import { forceDirectedLayout } from '.././forceLayout';


// ───────────────────── 变更耦合画像（时间维度） ─────────────────────

/**
 * 风险等级数值化（与 Rust 端 `commands/change_coupling.rs` 的 `rank` 函数同形）：
 * - extreme → 3 / high → 2 / medium → 1 / low → 0
 * 前端切片后排序用，保证"切时窗 / 切 filter"后图上仍是"最该处理的"在前。
 */
function rankRisk(lv: string | undefined): number {
  if (lv === 'extreme') return 3;
  if (lv === 'high') return 2;
  if (lv === 'medium') return 1;
  return 0;
}

/**
 * 变更耦合视图：把「总是一起改的文件对」画成无向图
 *
 * 与依赖画像的根本差别：
 * - 依赖画像画的是 **代码里写着的** 关系（import/use），编译器都知道
 * - 本画像画的是 **代码里没写、只存在于 git 历史里的** 关系
 *
 * 最有价值的是 `hidden` 边：两个文件之间没有任何 import，却总是一起改。
 * 这类耦合不会被任何静态工具提醒，新人改了 A 不知道要改 B —— 缺陷正是
 * 从这种地方溜出去的。画布上用**加粗实线 + 暖色**强调，跨模块的再加「!」。
 *
 * 布局用力导向 + 耦合度作为边权：耦合越强的文件被拉得越近，
 * 「命运共同体」会自己聚成团 —— 这些团往往就是真实的（而非文档上的）模块边界。
 */
export async function runChangeCouplingPortrait(
  analysisId: string,
  opts?: {
    /** 前端切片：all=不过滤 / hidden=仅隐性 / highRisk=仅高风险 / crossModule=仅跨模块 */
    filter?: 'all' | 'hidden' | 'highRisk' | 'crossModule';
    /** 前端兜底时窗（天）：>0 时再按 lastCoChangeAt 二次切片。正常路径在 UI 切时窗已触发后端重扫入库。 */
    windowDays?: number | null;
    /** 焦点文件 1-跳子图：B3 详细实施，B1 先占位透传 store 会话态 */
    focusFileId?: string | null;
    /** v2.18 布局模式：force=力导向自然聚团 / cluster=按顶层目录硬分区+模块簇染色 */
    layoutMode?: 'force' | 'cluster';
  },
): Promise<PortraitOutcome> {
  const pst = useProjectStore.getState();
  const st = useEditorStore.getState();
  const filter = opts?.filter ?? st.couplingFilter;
  const windowDays = opts?.windowDays ?? st.couplingWindowDays;
  const focusFileId = opts?.focusFileId ?? st.couplingFocusFileId;
  const layoutMode = opts?.layoutMode ?? st.couplingLayoutMode;
  // 前端切片：filter + windowDays（focusFileId 在 B3 处理，本轮不画单文件子图）
  const allPairs = pst.changeCoupling;
  let pairs = allPairs;
  if (filter !== 'all') {
    pairs = pairs.filter((p) => {
      if (filter === 'hidden') return p.couplingKind === 'hidden';
      if (filter === 'highRisk') return p.riskLevel === 'high' || p.riskLevel === 'extreme';
      if (filter === 'crossModule') return p.crossModule === true;
      return true;
    });
  }
  if (typeof windowDays === 'number' && windowDays > 0) {
    const cutSec = Math.floor(Date.now() / 1000) - windowDays * 86400;
    pairs = pairs.filter((p) => (p.lastCoChangeAt || 0) >= cutSec);
  }

  // v2.18 焦点 1-跳子图（B3）：与 dep v2.17 修正版同形态 —— 保留全图观点 + 焦点文件 + 它
  // 的全部 1-跳邻居都并入画布（含邻居间横向边，避免"局部失真"），焦点节点 isFocus=true。
  // 与 dep 的差异：filter / window 仍生效（让用户能"在过滤视角下聚焦"）；
  // 但子图判定用「焦点 file 的所有 partner」从 allPairs 算，不受 filter/window 影响。
  // （具体实现挪到 fileById 定义之后，因需要 fileById.has() 校验焦点合法性）

  if (filter !== 'all' || (typeof windowDays === 'number' && windowDays > 0)) {
    pairs = [...pairs].sort(
      (a, b) =>
        // 与后端排序口径对齐：风险等级 desc → 耦合度 desc → 共变次数 desc
        rankRisk(b.riskLevel) - rankRisk(a.riskLevel) ||
        (b.degree || 0) - (a.degree || 0) ||
        (b.coChanges || 0) - (a.coChanges || 0),
    );
  }

  if (pairs.length === 0) {
    return {
      ok: false,
      message: pst.isGitRepo ? t('portrait.msg.couplingNone') : t('portrait.msg.couplingNoGit'),
      severity: 'info',
      placed: 0,
    };
  }

  const fileById = new Map(pst.files.filter((f) => !f.isDirectory).map((f) => [f.id, f]));

  // v2.18 焦点 1-跳子图（B3）：与 dep v2.17 修正版同形态 —— 焦点文件 + 它的全部 1-跳邻居
  // 都并入画布（含邻居间横向边，避免「局部失真」），焦点节点 isFocus=true（FileRenderer
  // 已有品牌金 #EF9F27 外环 + 「焦点」药丸，直接复用）。子图判定用 allPairs 算 partner，
  // 不受 filter/window 影响（让用户能"在过滤视角下聚焦"）。
  let focusNodeId: string | null = null;
  if (focusFileId && fileById.has(focusFileId)) {
    focusNodeId = focusFileId;
    const partnerSet = new Set<string>([focusFileId]);
    for (const p of allPairs) {
      if (p.fileAId === focusFileId) partnerSet.add(p.fileBId);
      if (p.fileBId === focusFileId) partnerSet.add(p.fileAId);
    }
    pairs = pairs.filter((p) => partnerSet.has(p.fileAId) && partnerSet.has(p.fileBId));
  }

  // 上限 140 对：再多画布就成毛线团了，且后端已按风险降序排好，截断只丢弱信号
  const kept = pairs.filter((p) => fileById.has(p.fileAId) && fileById.has(p.fileBId)).slice(0, 140);

  if (kept.length === 0) {
    return {
      ok: false,
      message: t('portrait.msg.couplingStale'),
      severity: 'info',
      placed: 0,
    };
  }

  // 节点侧统计：每个文件有几个耦合伙伴、其中几个是隐性的、最强耦合度多少
  interface NodeStat {
    partners: number;
    hiddenPartners: number;
    maxDegree: number;
    totalCoChanges: number;
  }
  const stats = new Map<string, NodeStat>();
  const bump = (id: string, p: (typeof kept)[number]) => {
    const s = stats.get(id) ?? {
      partners: 0,
      hiddenPartners: 0,
      maxDegree: 0,
      totalCoChanges: 0,
    };
    s.partners += 1;
    if (p.couplingKind === 'hidden') s.hiddenPartners += 1;
    s.maxDegree = Math.max(s.maxDegree, p.degree);
    s.totalCoChanges += p.coChanges;
    stats.set(id, s);
  };
  for (const p of kept) {
    bump(p.fileAId, p);
    bump(p.fileBId, p);
  }

  clearCanvas();

  const insights = currentInsights();
  const NODE_W = 176;
  const NODE_H = 64;
  const nodeIds = Array.from(stats.keys());

  // v2.18 模块归属与配色（cluster 布局和模块簇染色都依赖）—— 复用 dep 画像的
  // topDirOf + MODULE_PALETTE 哈希取色方案，让「命运共同体的真实模块边界」视觉化。
  const moduleOf = new Map<string, string>();
  for (const id of nodeIds) {
    const f = fileById.get(id);
    if (f && !f.isDirectory) moduleOf.set(id, topDirOf(f.relPath));
  }
  const moduleColorOf = (id: string): string => {
    const m = moduleOf.get(id) ?? '';
    let h = 0;
    for (let i = 0; i < m.length; i++) h = (h * 31 + m.charCodeAt(i)) >>> 0;
    return MODULE_PALETTE[h % MODULE_PALETTE.length];
  };

  // ─── 布局算法（v2.18 双模式：force / cluster）───
  // force   ：力导向自然聚团（耦合伙伴数做 weight），与 v2.18 之前行为一致
  // cluster ：按 topDirOf 把节点分桶 → 各桶独立力导向 → 平移到 2D 网格子区；
  //           同时把 moduleColor 写到 config.accentColor 让 FileRenderer 染色，
  //           跨模块边按 cluster 模式视觉强化（strokeWidth/strokeOpacity 上调）
  let positions: Map<string, { x: number; y: number }>;
  if (layoutMode === 'cluster') {
    // 桶：module 名 → 节点 id 列表
    const buckets = new Map<string, string[]>();
    for (const id of nodeIds) {
      const m = moduleOf.get(id) ?? 'root';
      const arr = buckets.get(m) ?? [];
      arr.push(id);
      buckets.set(m, arr);
    }
    // 网格列数 = ceil(sqrt(M))：水平优先铺，桶多时仍可控
    const M = buckets.size;
    const COLS = Math.max(1, Math.ceil(Math.sqrt(M)));
    // 子区大小按最大桶动态算，保证最大桶内也能铺开
    const maxBucket = Math.max(...Array.from(buckets.values()).map((a) => a.length));
    const subW = Math.max(360, Math.round(Math.sqrt(maxBucket) * 220) + NODE_W + 80);
    const subH = Math.max(280, Math.round(Math.sqrt(maxBucket) * 110) + NODE_H + 60);
    positions = new Map();
    let bi = 0;
    for (const [, ids] of buckets) {
      const col = bi % COLS;
      const row = Math.floor(bi / COLS);
      const ox = 60 + col * subW;
      const oy = 60 + row * subH;
      // 桶内也用 force 让天然亲密关系（耦合对）优先聚拢
      const localForce = forceDirectedLayout(
        ids.map((id) => ({ id, weight: stats.get(id)?.partners ?? 1 })),
        kept
          .filter((p) => ids.includes(p.fileAId) && ids.includes(p.fileBId))
          .map((p) => ({ from: p.fileAId, to: p.fileBId })),
        {
          width: subW - 40,
          height: subH - 40,
          nodeWidth: NODE_W,
          nodeHeight: NODE_H,
          originX: ox,
          originY: oy,
        },
      );
      for (const [id, p] of localForce.positions) positions.set(id, p);
      bi += 1;
    }
  } else {
    const forceResult = forceDirectedLayout(
      // 权重用「耦合伙伴数」：耦合中心（改一处牵动一片的文件）被推到布局核心
      nodeIds.map((id) => ({ id, weight: stats.get(id)?.partners ?? 1 })),
      kept.map((p) => ({ from: p.fileAId, to: p.fileBId })),
      {
        width: Math.max(1200, Math.round(Math.sqrt(nodeIds.length) * 330)),
        height: Math.max(760, Math.round(Math.sqrt(nodeIds.length) * 220)),
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
        originX: 60,
        originY: 60,
      },
    );
    positions = forceResult.positions;
  }

  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  // 按耦合伙伴数降序放置，保证画布上限触顶时留下的是耦合中心
  const ordered = nodeIds.sort((a, b) => (stats.get(b)?.partners ?? 0) - (stats.get(a)?.partners ?? 0));
  for (const id of ordered) {
    const f = fileById.get(id);
    const p = positions.get(id);
    if (!f || !p) continue;
    const ins = insights.get(id) ?? emptyFileInsight();
    const st = stats.get(id)!;
    // v2.18 模块簇配色 + 节点徽标：与 dep 画像共用同一套字段语义，
    // FileRenderer 已消费 accentColor（卡片底色/色条）+ metricBadge（指标药丸）+ metricTitle（hover）
    const mod = moduleOf.get(id) ?? '';
    const moduleColor = moduleColorOf(id);
    const metricBadge = `⇄${st.partners}` + (st.hiddenPartners > 0 ? ` · ⚠${st.hiddenPartners}` : '');
    const metricTitle = [
      t('portrait.metric.couplingNodeTitle', {
        module: mod || '—',
        partners: st.partners,
        hidden: st.hiddenPartners,
        total: st.totalCoChanges,
      }),
    ]
      .filter(Boolean)
      .join('\n');
    if (
      place('file', { x: p.x, y: p.y }, f.name, {
        ...fileConfig(f, ins, 'changeCoupling'),
        couplingPartners: st.partners,
        hiddenPartners: st.hiddenPartners,
        maxCouplingDegree: Math.round(st.maxDegree * 100) / 100,
        coChangeTotal: st.totalCoChanges,
        // v2.18 模块簇视觉化（与 dep v2.17 共用 FileRenderer 通道）
        moduleName: mod,
        moduleColor,
        accentColor: moduleColor,
        metricBadge,
        metricTitle,
        // v2.18 焦点子图：FileRenderer 消费 isFocus 画品牌金外环 + 「焦点」药丸
        isFocus: id === focusNodeId,
      })
    ) {
      pos.set(id, { x: p.x, y: p.y, w: NODE_W, h: NODE_H });
    }
  }

  let edgeCount = 0;
  let hiddenCount = 0;
  let crossModuleHidden = 0;
  for (const p of kept) {
    const a = pos.get(p.fileAId);
    const b = pos.get(p.fileBId);
    if (!a || !b) continue;
    const hidden = p.couplingKind === 'hidden';
    if (
      connect(a, b, `${fileById.get(p.fileAId)?.name} ⇄ ${fileById.get(p.fileBId)?.name}`, {
        couplingEdge: true,
        couplingKind: p.couplingKind,
        degree: p.degree,
        jaccard: p.jaccard,
        coChanges: p.coChanges,
        riskLevel: p.riskLevel,
        crossModule: p.crossModule,
        isStructural: p.isStructural,
        // v2.18 cluster 模式：跨模块边在 DependencyEdgeRenderer 里被进一步加粗加深
        // （让「绕过模块边界」的隐性耦合一眼可见），同模块边正常；force 模式不加粗
        clusterMode: layoutMode === 'cluster',
        // 双向 id 供画布联动（选中文件 → 高亮其耦合伙伴）复用既有邻居机制
        fromFileId: p.fileAId,
        toFileId: p.fileBId,
      })
    ) {
      edgeCount += 1;
      if (hidden) {
        hiddenCount += 1;
        if (p.crossModule) crossModuleHidden += 1;
      }
    }
  }

  await persist(analysisId, 'changeCoupling');

  const worst = kept.find((p) => p.couplingKind === 'hidden') ?? kept[0];
  const worstName = worst
    ? `${fileById.get(worst.fileAId)?.name} ⇄ ${fileById.get(worst.fileBId)?.name} ${t('portrait.msg.couplingWorstName', { n: worst.coChanges, pct: (worst.degree * 100).toFixed(0) })}`
    : '';

  // v2.18 工具栏反馈：filter / timeWindow 任一激活时，把"已过滤 N/M"打到 message 里
  // 让用户明确知道当前画布是子集而不是缺数据。
  const filterActive = filter !== 'all';
  const windowActive = typeof windowDays === 'number' && windowDays > 0;
  const filterNote = filterActive
    ? t('portrait.msg.couplingFilterApplied', {
        filter: t(`editor.couplingFilter${filter[0].toUpperCase()}${filter.slice(1)}`),
        kept: kept.length,
        total: pairs.length,
      })
    : '';
  const windowNote = windowActive ? t('portrait.msg.couplingWindowApplied', { days: windowDays ?? 0 }) : '';
  const suffix = [filterNote, windowNote].filter(Boolean).join(' · ');
  // v2.18 焦点子图反馈（B3）：focusNodeId 非空时把「焦点+邻居数+边数」打到 message
  const focusNote = focusNodeId
    ? t('portrait.msg.couplingFocus', {
        name: fileById.get(focusNodeId)?.name ?? focusNodeId,
        neighbors: pos.size - 1,
        files: pos.size,
        edges: edgeCount,
      })
    : '';
  const baseMsg = t('portrait.msg.couplingDone', {
    n: pos.size,
    edges: edgeCount,
    hidden:
      hiddenCount > 0
        ? t('portrait.msg.couplingHidden', {
            n: hiddenCount,
            cross: crossModuleHidden > 0 ? t('portrait.msg.couplingCross', { n: crossModuleHidden }) : '',
          })
        : t('portrait.msg.couplingNormal'),
    worst: worstName ? t('portrait.msg.couplingWorst', { name: worstName }) : '',
  });
  const fullMsg = [baseMsg, suffix, focusNote].filter(Boolean).join(' · ');

  return {
    ok: true,
    message: fullMsg,
    severity: crossModuleHidden > 0 ? 'warning' : 'success',
    placed: pos.size,
  };
}
