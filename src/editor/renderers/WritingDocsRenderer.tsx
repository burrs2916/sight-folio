// 正文容器视图渲染器（G3：三层视图的 L3 —— 卷/章节文档页签）
//
// 挂在 kind="writing" 的题材容器视图里（writing-docs 载体卡，铺满画布、固定）。
// 页签 = 纯会话态（writingDocsStore，按卷分组展示，绝不落 scene.views —— 防爆炸铁律）：
//   - 点设计视图章节标题 / 拖章节卡 → openChapterCarrierView 打开/激活页签；
//   - 同章多开（对照写）= 页签栏「⧉」强制新页签；
//   - 「＋」新建章节并直接开页签；
//   - 重启后自动打开第一章恢复（页签不持久化）。
// 正文编辑复用 WritingChapterEditor（chrome="embedded"，与纸面卡同一条落库链路）。
// 画布零 Emotion：纯 div + inline style。
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import type { ComponentRendererProps } from '../../types/editor';
import { useWritingStore } from '../../store/writingStore';
import { useEditorStore } from '../../store/editorStore';
import { useWritingDocsStore } from '../../store/writingDocsStore';
import { resolveFragments, t } from '../../i18n';
import { CV } from './canvasTheme';
import { WritingChapterEditor, COLOR_CHAPTER, type SaveState } from './WritingChapterEditor';
import { ChapterOverviewPanel } from '../panels/ChapterOverviewPanel';
import { buildTree, treeRowIndent, type TreeNode } from '../../utils/writingTree';
import { openTypedCarrierView } from '../../utils/studioBook';
import { stripHtmlText } from '../../utils/writingProofread';
import type { ProofreadIssue } from '../proofread/proofreadEngine';
import { logger } from '../../utils/logger';
import { unitNameKey } from '../../utils/writingSchema';

const ACCENT = COLOR_CHAPTER;

export function WritingDocsRenderer({ config, componentId, mode }: ComponentRendererProps) {
  const filePath = typeof config.filePath === 'string' ? config.filePath : '';
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? '';

  const chapters = useWritingStore((s) => s.chapters);
  const createChapter = useWritingStore((s) => s.createChapter);
  const books = useWritingStore((s) => s.books);

  // T3 校对往返上下文：非空 = 本页签由校对页签跳转而来（返回按钮显示）；跳转锚点
  // 由 editor 定位消费后清空（onJumpAnchorConsumed），防止二次跳同章同锚点被去重吞掉。
  const proofreadReturnCtx = useEditorStore((s) => s.proofreadReturnCtx);
  const proofreadJumpAnchor = useEditorStore((s) => s.proofreadJumpAnchor);
  const setProofreadJumpAnchor = useEditorStore((s) => s.setProofreadJumpAnchor);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';

  // tab→chapter 预建索引：每页签渲染不再 chapters.find（每 tab 至多 3 次线性扫），
  // 改为 chapterId → chapter 的 O(1) 查表（2026-09-28 拍板；行为与 find 完全一致）。
  const chapterById = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);

  const tabs = useWritingDocsStore((s) => s.tabs[componentId]) ?? [];
  const activeTabId = useWritingDocsStore((s) => s.activeTab[componentId]);
  const openTab = useWritingDocsStore((s) => s.openTab);
  const closeTab = useWritingDocsStore((s) => s.closeTab);
  const closeTo = useWritingDocsStore((s) => s.closeTo);
  const setActive = useWritingDocsStore((s) => s.setActive);
  const setActiveChapterForBook = useWritingDocsStore((s) => s.setActiveChapterForBook);

  // 每页签独立会话态：脏标记（●）+ 实时字数。只读审阅下 save 恒 idle。
  const [tabStates, setTabStates] = useState<Record<string, { save?: SaveState; words?: number }>>({});
  // ⚠️ 回调必须是**稳定引用**：WritingChapterEditor 的 effect 依赖 onSaveStateChange/
  // onWordCountChange——若每渲染传入新闭包（`reportTabSave(tabId)` 工厂式调用），
  // effect 重跑 → setTabStates → 重渲染 → 又建新闭包 = Maximum update depth 无限循环
  // （2026-09-19 真实事故）。用 ref 缓存 per-tab 回调 + 值 guard 双保险。
  const tabCallbacksRef = useRef<Map<string, { save: (s: SaveState) => void; words: (n: number) => void }>>(new Map());
  const getTabCallbacks = useCallback((tabId: string) => {
    let c = tabCallbacksRef.current.get(tabId);
    if (!c) {
      c = {
        save: (s: SaveState) =>
          setTabStates((prev) => (prev[tabId]?.save === s ? prev : { ...prev, [tabId]: { ...prev[tabId], save: s } })),
        words: (n: number) =>
          setTabStates((prev) =>
            prev[tabId]?.words === n ? prev : { ...prev, [tabId]: { ...prev[tabId], words: n } },
          ),
      };
      tabCallbacksRef.current.set(tabId, c);
    }
    return c;
  }, []);

  // ─── 书接线：装载章节列表（与设计视图/纸面卡同一模式） ───
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.books.length === 0) void ws.loadBooks().catch(() => {});
    if (ws.activeBookId !== bookId) {
      void ws.setActiveBook(bookId).catch(() => {});
    }
  }, [bookId]);

  // ─── 首开恢复：无页签且章节就绪 → 自动打开第一章（页签是会话态，重启后从这里恢复） ───
  useEffect(() => {
    if (!bookId || tabs.length > 0 || chapters.length === 0) return;
    const first = chapters[0];
    openTab(componentId, first.id, resolveFragments(first.title));
    // 刻意只依赖「是否有页签」：避免每次章节列表变化都自动开页签
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, tabs.length > 0, chapters.length, componentId, openTab]);

  // ─── 激活章登记：供正文视图右栏「本章」上下文与 AI 语料消费（writingDocsStore 会话态） ───
  const activeEntryForSync = tabs.find((x) => x.tabId === activeTabId) ?? null;
  useEffect(() => {
    if (!bookId) return;
    setActiveChapterForBook(bookId, activeEntryForSync?.chapterId ?? null);
  }, [bookId, activeEntryForSync?.chapterId, setActiveChapterForBook]);

  // ─── 只读审阅（2026-09-19 拍板）：画布正文=设计/审阅，编辑收敛到写作台独立窗口 ───
  // 页签跳章 + 右栏本章上下文 + AI 语料全保留（设计联动），编辑动线 = 「⇢ 写作台」按钮。
  const openInWritingDesk = useCallback(() => {
    logger.info('WritingDocsRenderer', 'openInWritingDesk clicked', {
      bookId,
      chapterId: activeEntryForSync?.chapterId ?? null,
    });
    if (!bookId || !activeEntryForSync) return;
    void openWritingDesk({ bookId, chapterId: activeEntryForSync.chapterId });
  }, [bookId, activeEntryForSync]);

  const activeEntry = tabs.find((x) => x.tabId === activeTabId) ?? null;
  // T5「章内逐条闭环」：校对页签跳章行时携带引擎全量 textHits，正文容器在此展开逐条面板。
  // 必须快照到本地 state：jumpAnchor 由 editor 定位消费（onJumpAnchorConsumed 即清），
  // 直接依赖 store 值渲染会闪没；快照在「跳转到达活动章」时更新、切章时清空。
  const [proofreadHits, setProofreadHits] = useState<ProofreadIssue[] | null>(null);
  useEffect(() => {
    if (!proofreadJumpAnchor || proofreadJumpAnchor.chapterId !== activeEntry?.chapterId) return;
    if (proofreadJumpAnchor.textHits?.length) {
      setProofreadHits(proofreadJumpAnchor.textHits);
    }
     
  }, [proofreadJumpAnchor, activeEntry?.chapterId]);
  useEffect(() => {
    if (!activeEntry) setProofreadHits(null);
  }, [activeEntry]);
  const tabTitle = (chapterId: string, fallback: string) =>
    resolveFragments(chapterById.get(chapterId)?.title ?? fallback);

  const handleAddChapter = () => {
    // 默认名随体裁（散文「第 N 篇」）；genre 本组件已有（见 :42）
    void createChapter(t(unitNameKey(genre), { n: chapters.length + 1 })).then((c) => {
      if (c) openTab(componentId, c.id, resolveFragments(c.title));
    });
  };

  const handleDuplicateTab = () => {
    if (!activeEntry) return;
    openTab(componentId, activeEntry.chapterId, tabTitle(activeEntry.chapterId, activeEntry.name), { forceNew: true });
  };

  // ─── 章统筹面板（②）：正文只读 + 右侧九维本章上下文（可折叠；preview 纯阅读不显示） ───
  const [overviewOpen, setOverviewOpen] = useState(true);

  // ─── 页签右键菜单（③）：关闭本页签 / 关闭其他 / 关闭所有（2026-09-28 拍板） ───
  const [ctxMenu, setCtxMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  // ─── 章节目录（②）：全章树形下拉 + 搜索过滤 + 当前章高亮，点选即开页签 ───
  // 2026-09-28 修复：此前只按 sortOrder 平铺、按旧字段 volume 分组头渲染，从未用 parentId
  // 建树——带子级的章节在目录里被平铺、子节点没挂在父节点下。现在与左栏目录树/写作台
  // 同一口径（utils/writingTree.buildTree + treeRowIndent）：parentId 串树、子章节归属到
  // 父章节之下按深度缩进。仅旧模型书（全书无 parentId）保留 volume 分组头（LegacyOnly，
  // 对齐 ChapterTreePanel）：此时所有节点都是根、外观与改动前扁平列表一致。
  const [dirOpen, setDirOpen] = useState(false);
  const [dirQuery, setDirQuery] = useState('');
  const bookChapters = useMemo(
    () => chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder),
    [chapters, bookId],
  );
  const dirTree = useMemo(() => buildTree(bookChapters), [bookChapters]);
  const dirRows = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    const legacyOnly = !bookChapters.some((c) => c.parentId);
    // 搜索：后序标记「本子树内是否有命中」，只输出命中根 + 祖先链（兄弟不命中不输出）——
    // 与写作台 ChapterTreePanel 检索期口径一致，命中子章节时父级仍可见、缩进不塌。
    const kept = q ? new Map<string, boolean>() : null;
    const mark = (n: TreeNode): boolean => {
      let k = resolveFragments(n.node.title).toLowerCase().includes(q);
      for (const c of n.children) if (mark(c)) k = true;
      kept!.set(n.node.id, k);
      return k;
    };
    if (kept) dirTree.forEach(mark);
    // 搜索期根序列 = 过滤后的根；volume 分组头在过滤后的根间计算（对齐 ChapterTreePanel）
    const roots = dirTree.filter((n) => !kept || kept.get(n.node.id));
    const volumeHeaderAt = legacyOnly
      ? new Set(
          roots.filter((n, i) => n.node.volume !== (i > 0 ? roots[i - 1]?.node.volume : null)).map((n) => n.node.id),
        )
      : null;
    const out: { node: TreeNode['node']; depth: number; volumeHeader: boolean }[] = [];
    const walk = (n: TreeNode) => {
      if (kept && !kept.get(n.node.id)) return;
      out.push({ node: n.node, depth: n.depth, volumeHeader: !!volumeHeaderAt?.has(n.node.id) });
      n.children.forEach(walk);
    };
    dirTree.forEach(walk);
    return out;
  }, [bookChapters, dirTree, dirQuery]);

  // 早退必须放在所有 Hook 之后：bookId 在 null ↔ string 之间切换时 Hook 数量才一致，
  // 否则 React 抛 "Rendered fewer hooks than expected"。上方几个 useEffect 本就在此之前，
  // 且各自 `if (!bookId) return` 自守卫（行为零变化）；此处之后只剩纯派生的 useState/useMemo。
  if (!bookId) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: CV.text3,
          fontSize: 12,
          padding: 16,
          textAlign: 'center',
          lineHeight: 1.7,
        }}
      >
        {t('writingWorkbench.unbound')}
      </div>
    );
  }

  const handleDirPick = (chapterId: string, name: string) => {
    // 点击已在当前页签的章：openTab 命中已有 tab 仅重激活、正文/右栏零变化，
    // 若仍收起目录会给「点了没反应 → 不联动」的错觉（2026-09-28 真实反馈）。
    // 此时**不收起**，让行高亮 + 「当前」徽标成为可见反馈；点其他章照常切换并收起。
    const alreadyActive = activeEntry?.chapterId === chapterId;
    openTab(componentId, chapterId, name);
    setDirQuery('');
    if (!alreadyActive) setDirOpen(false);
  };

  // 页签右键菜单项统一样式（纯 div + inline style，画布零 Emotion）
  const ctxMenuStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11.5,
    color: CV.text,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 5,
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      // 容器卡根层拦截画布事件（同纸面卡：整卡不拖不选，卡内控件照常工作）
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // 同题材编辑面：正文容器也由 SceneEditor 视口贴面铺满整块画布
        // （writingPaneSeed.findFullBleedCard），圆角/边框/投影一律去掉 ——
        // 否则四角漏底纹、四面留边框，正文编辑区又变回「画布上浮着的卡」。
        borderRadius: 0,
        border: 'none',
        background: 'linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02))',
        overflow: 'hidden',
        boxShadow: 'none',
        boxSizing: 'border-box',
      }}
    >
      {/* L3 文档页签栏：章节目录 + 按卷分组 + 新建章节 + 同章多开 + 保存态 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: `1px solid ${ACCENT}33`,
          background: `${ACCENT}14`,
          flexShrink: 0,
          minWidth: 0,
          position: 'relative',
        }}
      >
        {mode !== 'preview' && (
          <>
            <span
              title={t('writing.dirButton')}
              onClick={() => {
                setDirOpen((v) => !v);
                setDirQuery('');
              }}
              style={{
                fontSize: 12,
                color: dirOpen ? '#fff' : ACCENT,
                cursor: 'pointer',
                background: dirOpen ? ACCENT : 'transparent',
                border: `1px solid ${dirOpen ? ACCENT : `${ACCENT}33`}`,
                borderRadius: 6,
                padding: '1px 7px',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              ☰
            </span>
            {dirOpen && (
              <>
                {/* 点透遮罩：点面板外任意处收起 */}
                <div
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDirOpen(false);
                  }}
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                />
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 6,
                    zIndex: 41,
                    width: 280,
                    maxHeight: 360,
                    overflowY: 'auto',
                    border: `1px solid ${ACCENT}44`,
                    borderRadius: 8,
                    background: CV.paper,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <input
                    autoFocus
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder={t('writing.dirSearch')}
                    style={{
                      fontSize: 11.5,
                      padding: '4px 8px',
                      marginBottom: 4,
                      border: `1px solid ${CV.divider}`,
                      borderRadius: 6,
                      background: 'transparent',
                      color: CV.text,
                      outline: 'none',
                    }}
                  />
                  {dirRows.length === 0 && (
                    <span style={{ fontSize: 10.5, color: CV.text3, padding: '4px 6px' }}>{t('writing.dirEmpty')}</span>
                  )}
                  {dirRows.map(({ node: c, depth, volumeHeader }) => {
                    const active = activeEntry?.chapterId === c.id;
                    return (
                      <div key={c.id} data-testid={`dir-row-${c.id}`}>
                        {volumeHeader && (
                          <span
                            data-testid={`dir-volume-${c.id}`}
                            style={{
                              display: 'block',
                              fontSize: 9.5,
                              fontWeight: 700,
                              color: ACCENT,
                              padding: '3px 5px 1px',
                              borderLeft: `2px solid ${ACCENT}55`,
                            }}
                          >
                            {resolveFragments(c.volume ?? '')}
                          </span>
                        )}
                        <span
                          onClick={() => handleDirPick(c.id, resolveFragments(c.title))}
                          title={resolveFragments(c.title)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            width: '100%',
                            padding: '3px 6px',
                            paddingLeft: treeRowIndent(depth),
                            borderRadius: 5,
                            cursor: 'pointer',
                            minWidth: 0,
                            background: active ? `${ACCENT}1f` : 'transparent',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11.5,
                              color: active ? ACCENT : CV.text2,
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontWeight: active ? 700 : 400,
                            }}
                          >
                            {resolveFragments(c.title)}
                          </span>
                          <span style={{ fontSize: 9.5, color: CV.text3, flexShrink: 0 }}>
                            {(c.wordCount || 0).toLocaleString()}
                          </span>
                          {active && (
                            <span
                              style={{
                                fontSize: 8.5,
                                fontWeight: 700,
                                color: '#fff',
                                background: ACCENT,
                                borderRadius: 4,
                                padding: '0 4px',
                                lineHeight: '14px',
                                flexShrink: 0,
                              }}
                            >
                              {t('writing.dirCurrent')}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        <div
          className="writing-docs-tabs"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
          }}
        >
          {tabs.length === 0 && (
            <span style={{ fontSize: 10.5, color: CV.text3, padding: '2px 4px' }}>
              {t('writingWorkbench.docsEmptyTabs')}
            </span>
          )}
          {tabs.map((tab, i) => {
            const chapter = chapterById.get(tab.chapterId);
            const volume = chapter?.volume ?? '';
            const prev = i > 0 ? (chapterById.get(tabs[i - 1].chapterId) ?? null) : null;
            const showVolume = volume && (!prev || (prev.volume ?? '') !== volume);
            const active = tab.tabId === activeTabId;
            return (
              <div key={tab.tabId} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                {showVolume && (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: ACCENT,
                      padding: '1px 5px',
                      borderLeft: `2px solid ${ACCENT}55`,
                      marginLeft: i === 0 ? 0 : 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {resolveFragments(volume)}
                  </span>
                )}
                <span
                  onClick={() => setActive(componentId, tab.tabId)}
                  // 中键点击 = 关闭页签（浏览器文档页签习惯）
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.stopPropagation();
                      closeTab(componentId, tab.tabId);
                    }
                  }}
                  // 右键 = 页签上下文菜单（关闭本页签/其他/所有）
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ tabId: tab.tabId, x: e.clientX, y: e.clientY });
                  }}
                  title={tabTitle(tab.chapterId, tab.name)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 11.5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    maxWidth: 180,
                    overflow: 'hidden',
                    color: active ? '#fff' : CV.text2,
                    background: active ? ACCENT : 'transparent',
                    border: `1px solid ${active ? ACCENT : `${ACCENT}33`}`,
                  }}
                >
                  {(tabStates[tab.tabId]?.save === 'dirty' || tabStates[tab.tabId]?.save === 'saving') && (
                    <span
                      title={tabStates[tab.tabId]?.save === 'saving' ? t('writing.saving') : t('writing.unsaved')}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background:
                          tabStates[tab.tabId]?.save === 'saving'
                            ? 'rgba(255,255,255,0.6)'
                            : active
                              ? '#ffd54f'
                              : '#f59e0b',
                      }}
                    />
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tabTitle(tab.chapterId, tab.name)}
                  </span>
                  {tabs.length > 1 && mode !== 'preview' && (
                    <span
                      title={t('writingWorkbench.docsCloseTab')}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(componentId, tab.tabId);
                      }}
                      style={{ fontSize: 10, opacity: active ? 0.85 : 0.5, cursor: 'pointer', flexShrink: 0 }}
                    >
                      ×
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {activeEntry && tabStates[activeEntry.tabId]?.words !== undefined
            ? `${t('writing.words', { n: tabStates[activeEntry.tabId]?.words ?? 0 })} · `
            : ''}
          {t('writing.readonlyHint')}
        </span>
        {mode !== 'preview' && proofreadReturnCtx && (
          <span
            title={t('writing.proofreadBackToPane')}
            onClick={() => {
              void openTypedCarrierView(genre, 'proofread');
            }}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: '#fff',
              cursor: 'pointer',
              background: ACCENT,
              border: `1px solid ${ACCENT}`,
              padding: '1px 8px',
              borderRadius: 6,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            ← {t('writing.proofreadBackToPane')}
          </span>
        )}
        {mode !== 'preview' && activeEntry && (
          <span
            title={t('writing.openInWritingDesk')}
            onClick={openInWritingDesk}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: ACCENT,
              cursor: 'pointer',
              border: `1px solid ${ACCENT}44`,
              background: `${ACCENT}0f`,
              padding: '1px 8px',
              borderRadius: 6,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            ⇢ {t('writing.openInWritingDesk')}
          </span>
        )}
        {mode !== 'preview' && activeEntry && (
          <span
            title={t('writing.overviewToggle')}
            onClick={() => setOverviewOpen((v) => !v)}
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: overviewOpen ? '#fff' : ACCENT,
              cursor: 'pointer',
              background: overviewOpen ? ACCENT : 'transparent',
              border: `1px solid ${overviewOpen ? ACCENT : `${ACCENT}33`}`,
              padding: '1px 7px',
              borderRadius: 6,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            ◫
          </span>
        )}
        {mode !== 'preview' && (
          <>
            <span
              title={t('writingWorkbench.docsNewTab')}
              onClick={handleDuplicateTab}
              style={{
                fontSize: 12,
                color: activeEntry ? ACCENT : CV.text3,
                cursor: activeEntry ? 'pointer' : 'default',
                padding: '0 3px',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              ⧉
            </span>
            <span
              title={t(unitNameKey(genre), { n: chapters.length + 1 })}
              onClick={handleAddChapter}
              style={{
                fontSize: 14,
                color: ACCENT,
                cursor: 'pointer',
                padding: '0 3px',
                flexShrink: 0,
                userSelect: 'none',
              }}
            >
              ＋
            </span>
          </>
        )}
      </div>

      {/* 页签右键菜单浮层（fixed 跟随点击点；document mousedown 关闭，画布零 Emotion） */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 90,
            minWidth: 148,
            padding: '4px',
            borderRadius: 8,
            border: `1px solid ${ACCENT}44`,
            background: CV.paper,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <span
            onClick={() => {
              closeTab(componentId, ctxMenu.tabId);
              setCtxMenu(null);
            }}
            style={ctxMenuStyle}
          >
            {t('writingWorkbench.docsCloseTab')}
          </span>
          <span
            onClick={() => {
              closeTo(componentId, { keepTabId: ctxMenu.tabId });
              setCtxMenu(null);
            }}
            style={{
              ...ctxMenuStyle,
              opacity: tabs.length > 1 ? 1 : 0.45,
              pointerEvents: tabs.length > 1 ? 'auto' : 'none',
            }}
          >
            {t('writingWorkbench.docsCtxCloseOthers')}
          </span>
          <span
            onClick={() => {
              closeTo(componentId);
              setCtxMenu(null);
            }}
            style={{
              ...ctxMenuStyle,
              opacity: tabs.length > 1 ? 1 : 0.45,
              pointerEvents: tabs.length > 1 ? 'auto' : 'none',
            }}
          >
            {t('writingWorkbench.docsCtxCloseAll')}
          </span>
        </div>
      )}

      {/* 激活页签：左侧只读正文 + 右侧章统筹面板（九维本章上下文，可折叠） */}
      {activeEntry ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          {/* T5 章内逐条闭环：校对跳章行携带的引擎全量命中，逐条横排（点条复用包含匹配定位滚动高亮） */}
          {mode !== 'preview' && proofreadHits && proofreadHits.length > 0 && (
            <div
              style={{
                flexShrink: 0,
                borderBottom: `1px solid ${ACCENT}33`,
                background: `${ACCENT}0a`,
                padding: '4px 8px 6px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, flexShrink: 0 }}>
                  ⛭ {t('writing.viewKind.proofread')} · {proofreadHits.length}
                </span>
                <span
                  style={{
                    fontSize: 9.5,
                    color: CV.text3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chapterById.get(activeEntry.chapterId)?.title ?? ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto', minWidth: 0 }}>
                {proofreadHits.map((hit, idx) => {
                  const kindKey =
                    hit.kind === 'typo'
                      ? 'writing.proofreadTypo'
                      : hit.kind === 'repeat'
                        ? 'writing.proofreadRepeat'
                        : hit.kind === 'sensitive'
                          ? 'writing.proofreadSensitive'
                          : hit.kind === 'punct'
                            ? 'writing.proofreadPunct'
                            : 'writing.proofreadRedundant';
                  const label = stripHtmlText(hit.excerpt).slice(0, 16);
                  return (
                    <button
                      key={`${hit.kind}-${hit.start}-${idx}`}
                      type="button"
                      title={
                        hit.suggestion ? `${label} · ${t(kindKey)} · ${hit.suggestion}` : `${label} · ${t(kindKey)}`
                      }
                      onClick={() => {
                        if (!label) return;
                        setProofreadJumpAnchor({
                          chapterId: activeEntry.chapterId,
                          anchor: label,
                          textHits: proofreadHits,
                        });
                      }}
                      style={{
                        flexShrink: 0,
                        fontSize: 9.5,
                        color: CV.text,
                        background: CV.paper,
                        border: `1px solid ${ACCENT}33`,
                        borderRadius: 5,
                        padding: '2px 6px',
                        cursor: 'pointer',
                        maxWidth: 220,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'inherit',
                      }}
                    >
                      [{t(kindKey)}] {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
            <WritingChapterEditor
              key={activeEntry.tabId}
              chrome="embedded"
              chapterId={activeEntry.chapterId}
              config={config}
              readOnly
              jumpAnchor={proofreadJumpAnchor?.chapterId === activeEntry.chapterId ? proofreadJumpAnchor.anchor : null}
              onJumpAnchorConsumed={() => setProofreadJumpAnchor(null)}
              onSaveStateChange={getTabCallbacks(activeEntry.tabId).save}
              onWordCountChange={getTabCallbacks(activeEntry.tabId).words}
            />
            {mode !== 'preview' && overviewOpen && (
              <div
                style={{
                  width: 300,
                  flexShrink: 0,
                  overflow: 'hidden',
                  borderLeft: `1px solid ${ACCENT}33`,
                  background: `${ACCENT}08`,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                }}
              >
                <ChapterOverviewPanel bookId={bookId} chapterId={activeEntry.chapterId} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: CV.text3,
          }}
        >
          {t('writingWorkbench.docsEmptyTabs')}
        </div>
      )}
    </div>
  );
}
