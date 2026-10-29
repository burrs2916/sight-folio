/**
 * 章级跳转分发回归测试（正文纸面卡 / 写作台提醒条 → 主窗口 L2 页签精确联动）。
 *
 * 这套分发两个方向的失败代价不对称：
 *   · 主窗口场景误走 emit → 提醒条点击无效果（同窗口却广播给虚空），用户以为坏了；
 *   · 写作台场景误走就地执行 → 在独立窗口里 openTypedCarrierView 跳到不存在的
 *     L2 视图，越级越窗且无法定位。
 * 同时精确载荷（selectedId / issueKey / chapterId）一旦丢失，提醒条就退化回
 * 「只切页签不定位」，与 T5（proofreadFocusKey）/ S4（statsFocusChapterId）
 * 建立的"点到即定位"标准不一致。两条分支 + 四类载荷都必须钉死，防回归。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emit } from '@tauri-apps/api/event';
import { isWritingDeskWindow } from '../writingDeskWindow';
import { openTypedCarrierView } from '../studioBook';

// 顶层 create() 无副作用（编辑设备份），但测试需要观察 setter 调用 → mock 掉
const selectForeshadowing = vi.fn();
const selectInspiration = vi.fn();
const setProofreadFocusKey = vi.fn();
const setStatsFocusChapterId = vi.fn();
// 剧情线页签：体检报告的线级发现要落到具体那条线上（切视角 + 选中）
const selectStoryline = vi.fn();
const setTimelineViewMode = vi.fn();
vi.mock('../../store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      selectForeshadowing,
      selectInspiration,
      setProofreadFocusKey,
      setStatsFocusChapterId,
      selectStoryline,
      setTimelineViewMode,
      timelineViewMode: 'chapter',
    }),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(() => Promise.resolve()) }));
vi.mock('../writingDeskWindow', () => ({ isWritingDeskWindow: vi.fn() }));
vi.mock('../studioBook', () => ({ openTypedCarrierView: vi.fn() }));

import { dispatchChapterJump, applyDeskGotoView, DESK_GOTO_VIEW_EVENT } from '../writingDeskJump';

const mockedEmit = vi.mocked(emit);
const mockedIsDesk = vi.mocked(isWritingDeskWindow);
const mockedOpen = vi.mocked(openTypedCarrierView);

beforeEach(() => {
  mockedEmit.mockClear();
  mockedOpen.mockClear();
  mockedIsDesk.mockClear();
  selectForeshadowing.mockClear();
  selectInspiration.mockClear();
  setProofreadFocusKey.mockClear();
  setStatsFocusChapterId.mockClear();
  selectStoryline.mockClear();
  setTimelineViewMode.mockClear();
});

describe('剧情线页签跳转（体检报告线级发现）', () => {
  it('kind=storylines 带着线 id：切剧情线视角 + 选中该线 + 开剧情线页签', () => {
    dispatchChapterJump({ genre: 'novel', kind: 'storylines', storylineId: 'sl1' });
    expect(setTimelineViewMode).toHaveBeenCalledWith('storyline');
    expect(selectStoryline).toHaveBeenCalledWith('sl1');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'storylines');
  });

  it('只开页签不带线 id 时不乱设视角（否则主窗口会出现无端切换）', () => {
    dispatchChapterJump({ genre: 'novel', kind: 'storylines' });
    expect(setTimelineViewMode).not.toHaveBeenCalled();
    expect(selectStoryline).not.toHaveBeenCalled();
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'storylines');
  });
});

describe('dispatchChapterJump（窗口形态分发）', () => {
  it('写作台窗口：emit desk-goto-view 且携带完整载荷，不就地执行', () => {
    mockedIsDesk.mockReturnValue(true);
    dispatchChapterJump({ genre: 'novel', kind: 'proofread', issueKey: 'ch1:TypoPhrase' });
    expect(mockedEmit).toHaveBeenCalledWith(DESK_GOTO_VIEW_EVENT, {
      genre: 'novel',
      kind: 'proofread',
      issueKey: 'ch1:TypoPhrase',
    });
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('主窗口：就地执行跳转，不发事件', () => {
    mockedIsDesk.mockReturnValue(false);
    dispatchChapterJump({ genre: 'novel', kind: 'inspiration', selectedId: 'b1' });
    expect(mockedEmit).not.toHaveBeenCalled();
    expect(selectInspiration).toHaveBeenCalledWith('b1');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'inspiration');
  });
});

describe('applyDeskGotoView（主窗口侧统一执行，含跨窗口事件对端）', () => {
  it('foreshadowing：先选中伏笔再切页签', () => {
    applyDeskGotoView({ genre: 'novel', kind: 'foreshadowing', selectedId: 'f1' });
    expect(selectForeshadowing).toHaveBeenCalledWith('f1');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'foreshadowing');
  });

  it('inspiration：先选中念头再切页签', () => {
    applyDeskGotoView({ genre: 'novel', kind: 'inspiration', selectedId: 'b2' });
    expect(selectInspiration).toHaveBeenCalledWith('b2');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'inspiration');
  });

  it('proofread：携带 issueKey（T5 proofreadFocusKey 语义），不丢定位载荷', () => {
    applyDeskGotoView({ genre: 'novel', kind: 'proofread', issueKey: 'ch1:TypoPhrase' });
    expect(setProofreadFocusKey).toHaveBeenCalledWith('ch1:TypoPhrase');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'proofread');
  });

  it('stats：携带 chapterId（S4 statsFocusChapterId 语义），不丢定位载荷', () => {
    applyDeskGotoView({ genre: 'novel', kind: 'stats', chapterId: 'c9' });
    expect(setStatsFocusChapterId).toHaveBeenCalledWith('c9');
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'stats');
  });

  it('空载荷缺字段：跳过对应 setter，仅切页签（不抛错）', () => {
    applyDeskGotoView({ genre: 'novel', kind: 'proofread' });
    expect(setProofreadFocusKey).not.toHaveBeenCalled();
    expect(mockedOpen).toHaveBeenCalledWith('novel', 'proofread');
  });
});
