/**
 * ㉠ AI-2b″（2026-11-10 轮 13）：`/ai` 快捷动作的最后两处体裁残余 —— 进度栏名与角色诊断指令。
 *
 * 病灶（状态文件 §队列 AI-2b″，轮 11 交账时用新证据抓出）：
 *  ① `AiAgentPage` 四处进度行顶着裸字面「全书进度」—— 剧本那本的正名是**全剧**
 *    （现成口径：`writing.aiChatEmptyScript`「角色表与全剧资料摘要」、`writing.script.statsHint`
 *    「全剧体量与节奏」、`agent.welcome.analyzeDescScript`「审视全剧」），诗集/散文集/日记本领
 *    「全书」轮 11 判过「勉强成立」→ 无事生非者不登记，只有剧本换词；
 *  ② character 卡点下去发的那句整段小说口径（反派动机不足 / 配角脸谱化 / 成长弧线 / 与主线的
 *    关联度），而角色卡对**五种载体都可见**（`aiQuickActionVisible` 没裁 characters）——
 *    诗集作者问角色诊断，模型被要求找「反派」。
 *
 * 锁的三层（沿用 ㉝/㉞ 两轮的形状）：
 *   ① 真调用层：`buildCharacterPrompt` 的**成品串**（novel 含未设/脏值 = 改造前逐字节，基线两串
 *      逐字抄自改造前的磁盘文件，不是凭印象）；四支两两不同、各点名本体裁那一件事；
 *   ② 同源层：被 `hiddenViewKindsForGenre` 裁掉的栏词一个字不许出现在该支文案里（页签表反查）；
 *      「全剧」必须能追溯到现成键；`progressLabel` 五格按轮 11 判定钉死；
 *   ③ 接线层：页面四处进度行全走 `terms.progressLabel`（裸字面绝迹 = 0、插值形态 = 4），
 *      character 模板从页面搬进模块（页面不许自持第二份真源）。AU-7 ⑨ 的教训在这里的对应物：
 *      ChatArea 不是可独立渲染的组件（要整套 store），所以「没接到行上」由**计数锁**拦——
 *      有人在页面里硬编码回一处，`【全书进度】` 计数就 ≠ 0；有人算了栏名不传，计数就 ≠ 4。
 */
import { describe, it, expect } from 'vitest';

// ── novel 基线两串 = 改造前 `AiAgentPage:747` 那一对字符串字面量的**逐字抄录**（零回归锁）──
const BASE_CHARACTER_ZH =
  '请为当前作品进行角色设定诊断与优化。\n\n要求：\n1. 分析现有角色塑造深度：动机层次、性格多面性、成长弧线\n2. 检查角色关系网的密度与张力，标记冗余或孤立角色\n3. 为角色设计标志性语言风格（口头禅、句式偏好、修辞特征）\n4. 评估角色与主线的关联度，给出「合并/删除/强化」建议\n5. 如有空白领域（反派动机不足、配角脸谱化），提出新角色或深化方案\n6. 输出形式：角色卡表格 + 关系拓扑图（文字版）';
const BASE_CHARACTER_EN =
  'Please diagnose and optimize character development for the current work.\n\nRequirements:\n1. Analyze existing character depth: motivation layers, personality facets, growth arcs\n2. Check character relationship network density and tension; flag redundant or isolated characters\n3. Design signature speech patterns (catchphrases, sentence preferences, rhetorical features)\n4. Evaluate character relevance to main plot; suggest merge / remove / strengthen actions\n5. Identify weak areas (e.g., under-motivated antagonist, stereotyped side characters) and propose new or deepened solutions\n6. Output format: character card table + relationship topology (text-based)';

import { readFileSync } from 'node:fs';
import { buildCharacterPrompt, quickActionTermsFor } from '../quickActionPrompts';
import { hiddenViewKindsForGenre } from '../../utils/writingSchema';
import { setLang, t } from '../../i18n';

const NON_NOVEL = ['essay', 'poetry', 'script', 'diary'] as const;
const DIRTY = ['', 'poerty', 'Novel', 'script ', 'diarrry'];

/** 写作域工具名是 API 契约（本轮四支不引工具，此函数留作 en 侧扫描的惯例位） */
const TOOL_NAMES = /list_chapters|read_chapter|read_character_card|search_corpus|update_character_card|add_aliases/g;
const deinstrumented = (s: string) => s.replace(TOOL_NAMES, '');

// ─── ① 真调用层：组装出来的成品串 ───
describe('㉠ buildCharacterPrompt · 成品串', () => {
  it('novel 与未设/脏体裁值 = 改造前逐字节（中英各一对）', () => {
    setLang('zh-CN');
    for (const g of ['novel', ...DIRTY]) {
      expect(buildCharacterPrompt(g), `genre=${JSON.stringify(g)} 的角色诊断变了`).toBe(BASE_CHARACTER_ZH);
    }
    setLang('en-US');
    for (const g of ['novel', ...DIRTY]) {
      expect(buildCharacterPrompt(g), '英文侧角色诊断变了').toBe(BASE_CHARACTER_EN);
    }
  });

  it('四支各领一套：zh 成品两两不同，且都不是小说那一格', () => {
    setLang('zh-CN');
    const seen = new Set<string>();
    for (const g of NON_NOVEL) {
      const out = buildCharacterPrompt(g);
      expect(out, `${g} 仍领小说那格`).not.toBe(BASE_CHARACTER_ZH);
      seen.add(out);
    }
    expect(seen.size, '四支共用一套 = 覆盖没生效').toBe(4);
  });

  it('四支的成品串不说小说话：zh 无「小说 / 章 / 连载」，诗剧日另禁「篇」，五支里只有小说许提「反派」', () => {
    setLang('zh-CN');
    const extra: Record<string, string[]> = { script: ['篇'], poetry: ['篇'], diary: ['篇'] };
    for (const g of NON_NOVEL) {
      const out = buildCharacterPrompt(g);
      for (const bad of ['小说', '章', '连载', ...(extra[g] ?? [])]) {
        expect(out, `${g} 的成品串里出现「${bad}」`).not.toContain(bad);
      }
      expect(out, `${g} 不许顶着小说词「反派」`).not.toContain('反派');
      expect(out, `${g} 不许顶着小说词「脸谱化」`).not.toContain('脸谱化');
    }
    // 反向锁：小说那一格这些词**必须在**（判据不是「非小说才说话」，是各说各话）
    const novel = buildCharacterPrompt('novel');
    expect(novel).toContain('反派');
    expect(novel).toContain('成长弧线');
  });

  it('en 侧同样不说 novel / chapter / fiction', () => {
    setLang('en-US');
    for (const g of NON_NOVEL) {
      const low = deinstrumented(buildCharacterPrompt(g)).toLowerCase();
      for (const bad of ['novel', 'chapter', 'fiction']) {
        expect(low, `${g} 的英文成品串里出现 ${bad}`).not.toContain(bad);
      }
    }
  });

  it('语义点名：每支问的是本体裁那一行事', () => {
    setLang('zh-CN');
    const must: Record<string, RegExp> = {
      essay: /真实的人事|不得替作者补写记忆/,
      poetry: /说话的人|不得建议作者先补卡|不得建议.*先补卡/,
      script: /角色表/,
      diary: /那天在场|不得替作者/
    };
    for (const g of NON_NOVEL) {
      expect(buildCharacterPrompt(g), `${g} 没领到本体裁那句话`).toMatch(must[g]);
    }
    // 剧本问戏要问「要什么/谁挡着」（与 DIAGNOSE 的冲突回合同一口径），日记不下心理诊断
    expect(buildCharacterPrompt('script')).toContain('谁挡着');
    expect(buildCharacterPrompt('diary')).toContain('不下心理诊断');
  });
});

// ─── ② 同源层 ───
describe('㉠ 同源 · 裁栏词不越界，「全剧」有出处', () => {
  const FORBIDDEN: Record<string, string[]> = {
    worldview: ['世界观', '世界规则'],
    storylines: ['剧情线'],
    foreshadowing: ['伏笔'],
  };
  it('被 hiddenViewKindsForGenre 裁掉的栏，一个字都不许出现在角色诊断里', () => {
    setLang('zh-CN');
    for (const g of ['novel', ...NON_NOVEL]) {
      const hidden = hiddenViewKindsForGenre(g);
      const out = buildCharacterPrompt(g);
      for (const kind of Object.keys(FORBIDDEN)) {
        if (!hidden.includes(kind)) continue;
        for (const word of FORBIDDEN[kind]) {
          expect(out, `${g} 的 ${kind} 栏已被裁，指令里却写着「${word}」`).not.toContain(word);
        }
      }
    }
  });

  it('progressLabel：novel/未设/脏值 = 「全书进度」逐字；只有剧本领「全剧进度」', () => {
    for (const g of ['novel', ...DIRTY]) {
      expect(quickActionTermsFor(g).progressLabel, `genre=${JSON.stringify(g)} 的进度栏名变了`).toBe('全书进度');
    }
    expect(quickActionTermsFor('script').progressLabel).toBe('全剧进度');
    // 轮 11 判定：诗/散文/日「勉强成立」→ 按原格登记，不许有人顺手替它们改名
    for (const g of ['essay', 'poetry', 'diary']) {
      expect(quickActionTermsFor(g).progressLabel, `${g} 的进度栏名被无端改动`).toBe('全书进度');
    }
  });

  it('「全剧」不是自创词：现成 i18n 里就有（aiChatEmptyScript / script.statsHint / analyzeDescScript）', () => {
    setLang('zh-CN');
    expect(t('writing.aiChatEmptyScript')).toContain('全剧');
    expect(t('writing.script.statsHint')).toContain('全剧');
    expect(t('agent.welcome.analyzeDescScript')).toContain('全剧');
  });
});

// ─── ③ 接线层 ───
describe('㉠ 接线层 · 页面不带裸栏名、不自持角色模板', () => {
  const page = readFileSync('src/pages/AiAgentPage.tsx', 'utf-8');
  const pack = readFileSync('src/ai/quickActionPrompts.ts', 'utf-8');

  it('四处进度行全走 terms.progressLabel：裸【全书进度】绝迹，插值形态恰好 4 处', () => {
    expect((page.match(/【全书进度】/g) ?? []).length, '页面又硬编码回「全书进度」了').toBe(0);
    expect((page.match(/【\$\{terms\.progressLabel\}】/g) ?? []).length, '进度栏名没接到行上（AU-7 ⑨）').toBe(4);
  });

  it('character 指令走组装函数，六条小说腔从页面绝迹、只住在模块 novel 格', () => {
    expect(page).toContain('buildCharacterPrompt(currentBook.genre)');
    for (const bad of ['反派动机不足', '请为当前作品进行角色设定诊断与优化', '评估角色与主线的关联度']) {
      expect(page, `页面里还留着「${bad}」= 第二份真源`).not.toContain(bad);
    }
    for (const keep of ['反派动机不足', '请为当前作品进行角色设定诊断与优化']) {
      expect(pack, `模块里丢了 novel 格的「${keep}」`).toContain(keep);
    }
  });

  it('页面零体裁字面判断（判据只准住在 writingSchema）', () => {
    expect(page).not.toMatch(/genre\s*===\s*'/);
    expect(page).not.toMatch(/genre\s*!==\s*'/);
  });
});
