/**
 * ㉘ 日记条目补日期的接线锁（欠账 S22 的兑现）。
 *
 * 本面板既有做法就是"源码审计 + 纯函数单测"（见 ChapterDetailsBeats/EmptyState 两份头注释），
 * 这里沿用它，钉四件肉眼看不出来的事：
 *  ① 渲染闸按体裁走 `writingSchema`，且**其它体裁一个 date 输入都不许出现**；
 *  ② 逐键不写库（这面板的既有交互契约，一旦有人"顺手"改成 onChange 落库就是每敲一字一次 IPC）；
 *  ③ 撞日提示把回收站里的条目排除掉（否则作者刚删了一条，提示还说"那天已经有 1 条"）；
 *  ④ 新组件插在 DraftAtEditor 与 ToggleChip 之间时没把邻居吞掉（本仓真出过截断事故）。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { setLang, t } from '../../i18n';

const panel = readFileSync('src/pages/ChapterDetailsPanel.tsx', 'utf8');
const zhJson = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
const en = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));

const editorBody = panel.slice(panel.indexOf('function EntryDateEditor'), panel.indexOf('/** 人物 / 场景共用绑定 chip'));

describe('㉘ 渲染闸', () => {
  it('只有按日期写的体裁渲染这一行，判据来自 writingSchema', () => {
    // 只锁"这个判据是从 writingSchema 进口的"，不锁同一行里还并了谁
    // （㉙ 往这行加了 surfaceKeyForGenre，把整行拼写当锁的那条锁红得很合理——是锁写得太死，不是接线坏了）
    expect(panel).toMatch(/import \{[^}]*writesByDateForGenre[^}]*\} from '\.\.\/utils\/writingSchema';/);
    expect(panel).toMatch(/writesByDateForGenre\(book\?\.genre \?\? ''\) && \(\s*<EntryDateEditor key=\{`entry-date-\$\{chapter\.id\}`\}/);
  });

  it('渲染层不出现 `genre === \'diary\'` 这类体裁判据', () => {
    expect(panel).not.toMatch(/genre\s*===\s*'diary'/);
  });

  it('换条目靠 key 重挂重置本地态（不是 useEffect setState 反模式）', () => {
    expect(editorBody).not.toMatch(/useEffect\(/);
    expect(editorBody).toMatch(/const savedRef = useRef\(value\);/);
  });
});

describe('㉘ 落账动作', () => {
  it('逐键不写库：onChange 只更新本地态，提交只由失焦/回车触发', () => {
    expect(editorBody).toMatch(/onChange=\{\(e\) => setValue\(e\.target\.value\)\}/);
    expect(editorBody).not.toMatch(/onChange=[^}]*setChapterEntryDate/);
    expect(editorBody).toMatch(/onBlur=\{\(\) => void commit\(\)\}/);
    expect(editorBody).toMatch(/e\.key === 'Enter'/);
  });

  it('未变化不写库；不存在的一天不写库', () => {
    expect(editorBody).toMatch(/if \(saving \|\| v === savedRef\.current\) return;/);
    expect(editorBody).toMatch(/if \(v && !isDiaryDateKey\(v\)\) return;/);
  });

  it('写库只走 store 的那一个动作（合并 extra 的口径不许在组件里自己拼 JSON）', () => {
    expect(editorBody).toContain('useWritingStore.getState().setChapterEntryDate(chapter.id, v)');
    expect(editorBody).not.toContain('saveChapter');
    expect(editorBody).not.toMatch(/JSON\.stringify/);
  });

  it('撞日提示排除回收站里的同日条目', () => {
    expect(editorBody).toMatch(/chapterDeletedAt\(c\) === 0/);
    expect(editorBody).toContain("t('writing.diary.dateClash'");
  });
});

describe('㉘ 邻居没被吞（本仓出过截断事故，位置锁一次）', () => {
  it('DraftAtEditor → EntryDateEditor → 绑定 chip 顺序在场且都在', () => {
    const a = panel.indexOf('function DraftAtEditor');
    const b = panel.indexOf('function EntryDateEditor');
    const c = panel.indexOf('/** 人物 / 场景共用绑定 chip');
    const end = panel.indexOf('export function ChapterDetailsPanel');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(end).toBeGreaterThan(c);
    expect(editorBody.length).toBeGreaterThan(600);
    // 面板自己的成员一个没少（插入位置若把邻居吞了，这里立刻红）
    expect(panel).toContain('const cover = parseChapterCover(chapter.extra);');
    expect(panel).toContain('const toggleCast = async (settingId: string) => {');
    expect(panel).toContain('function ToggleChip(');
  });
});

describe('㉘ 文案双语齐备（缺一条界面就印裸 key）', () => {
  const keys = ['dateField', 'dateHint', 'dateSaved', 'dateCleared', 'dateClash'];
  const cjk = /[\u4e00-\u9fff]/;

  it('五个键在中英两份里都存在且是字符串', () => {
    for (const k of keys) {
      expect(typeof zhJson.writing.diary[k], `zh 缺 writing.diary.${k}`).toBe('string');
      expect(typeof en.writing.diary[k], `en 缺 writing.diary.${k}`).toBe('string');
      expect(zhJson.writing.diary[k], `zh ${k} 不许是英文`).toMatch(cjk);
      expect(en.writing.diary[k], `en ${k} 不许夹汉字`).not.toMatch(cjk);
    }
  });

  it('渲染出来的句子带得上占位符（少一个参就印出 {date}）', () => {
    setLang('zh-CN');
    expect(t('writing.diary.dateSaved', { date: '2026-11-10' })).toContain('2026-11-10');
    expect(t('writing.diary.dateClash', { date: '2026-11-10', n: 2, titles: '加班、暴雨' })).toContain('已经有 2 条');
    setLang('en-US');
    expect(t('writing.diary.dateClash', { date: '2026-11-10', n: 2, titles: 'a, b' })).toContain('already has 2 entries');
    setLang('zh-CN');
  });
});
