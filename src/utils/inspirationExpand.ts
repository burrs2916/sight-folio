// sight-folio: 灵感念头池 → AI 扩写（O7）· 纯函数与提示词约定
//
// 职责边界：
// - 与 agent 会话/流式、UI、store 无耦合，单测直跑（不 mock 任何模块）。
// - INSPIRATION_EXPAND_SYSTEM_HINT：首轮注入的「灵感扩写」人设 + 版本输出约定
//   （约定与 extractInspirationVersions 的解析规则必须同步维护，改一边必须改另一边）。
// - buildInspirationExpandPrompt：构造扩写指令（念头条目信息 + 版本数，双语）。
// - extractInspirationVersions：从 AI 回复中切出候选版本（`>>> 标题` 行 + 段落正文），
//   供前端逐版本预览并一键插入正文。
import { L } from '../ai/aiLang';

/** 扩写版本数上限（防一次生成过长，前端滑块范围 1–3） */
export const INSPIRATION_EXPAND_MAX_VERSIONS = 3;

/** 首轮注入的灵感扩写系统提示（双语；复用语料参谋的人味约束 5 条） */
export const INSPIRATION_EXPAND_SYSTEM_HINT = `你现在的身份是「本书灵感扩写师」。用户会给你一条尚未成文的灵感念头（标题 + 摘要 + 可能挂载的角色/场景），你把它扩写成可直接放进小说正文的段落或场景。

输出格式约定（非常重要）：
1. 每个候选版本以仅含 ">>> " 的一行开始，行内紧跟该版本的一句话标题（例如：>>> 版本一：雨巷重逢）；标题行会被前端解析为版本切分标记。
2. 标题行之后的全部行是该版本正文，可多段（段与段之间空一行）。
3. 一次输出 ${INSPIRATION_EXPAND_MAX_VERSIONS} 个以内候选版本，每个版本风格与侧重有可感知差异（如侧重动作 / 侧重对白 / 侧重内心）。
4. 除版本块外不要输出任何解释、编号、分隔线或其他内容。

写作人味约束（对你所有版本正文生效，目标是避免让用户感到"AI 味/情感空洞"）：
1. 避免机械感：句子长短交替，允许口语化的断点与不完美；
2. 禁用模板套话：不使用"首先/其次/最后""值得注意的是""总而言之""不是……而是……"等连接套路；
3. 具体优先：用可感细节（动作、感官、具体物件）代替抽象评价，不得用空泛形容词堆叠情感；
4. 情节大于铺陈：关键情节要有实质推进，不得靠堆砌心理与环境描写凑篇幅；
5. 给立场：明确倾向与判断，不回避表态，不用含糊词语填充。`;

export interface InspirationExpandInput {
  /** 念头标题（必填；空则用摘要首句兜底） */
  title: string;
  /** 念头摘要/备注（可为空） */
  summary?: string;
  /** 已解析为名称的角色列表（可空） */
  castNames?: string[];
  /** 已解析为名称的场景列表（可空） */
  sceneNames?: string[];
  /** 期望候选版本数（1–3，越界自动收敛） */
  count?: number;
}

export interface InspirationExpandVersion {
  /** 版本标题（`>>> ` 行去除前缀后的内容；异常输出回退为序号标题） */
  title: string;
  /** 版本正文（多段，段间空行保留），可直接进 textToParagraphHtml */
  body: string;
}

/**
 * 构造「灵感扩写」指令（双语）。
 * 把念头条目信息（标题/摘要/挂载角色、场景）打包成 AI 可见的扩写素材，
 * 要求直接输出 count 个 `>>> ` 版本块，不做过程解释。
 */
export function buildInspirationExpandPrompt(input: InspirationExpandInput): string {
  const count = Math.min(INSPIRATION_EXPAND_MAX_VERSIONS, Math.max(1, Math.floor(input.count ?? 1)));
  const title = input.title.trim() || (input.summary ?? '').trim().slice(0, 40) || '未命名念头';
  const parts: string[] = [L(`【灵感念头】${title}`, `[Inspiration prompt] ${title}`)];
  if (input.summary?.trim()) parts.push(L(`【摘要】${input.summary.trim()}`, `[Summary] ${input.summary.trim()}`));
  if (input.castNames?.length)
    parts.push(L(`【角色】${input.castNames.join('、')}`, `[Characters] ${input.castNames.join(', ')}`));
  if (input.sceneNames?.length)
    parts.push(L(`【场景】${input.sceneNames.join('、')}`, `[Scenes] ${input.sceneNames.join(', ')}`));
  parts.push(
    L(
      `\n请基于以上灵感扩写 ${count} 个可直接放进小说正文的候选段落/场景（每个版本以 ">>> " 标题行开头，正文可多段，版本间风格有差异），不要输出其他内容。`,
      `\nPlease expand the inspiration into ${count} candidate passages/scenes directly usable in the novel body (each version starts with a ">>> " title line, body may span multiple paragraphs, versions should differ in approach), and output nothing else.`,
    ),
  );
  return parts.join('\n');
}

/**
 * 从 AI 回复中切出候选版本。
 * 协议：`>>> 标题` 行开启新版本，其后非空行累积为版本正文，
 * 直到下一 `>>> ` 行或文本结束；版本块之间的空行不进入正文边界——正文内段落
 * 保留空行（textToParagraphHtml 按空行分段），仅版本块之间的间隔会被忽略。
 * 无 `>>> ` 行时整体回退为单个版本（标题用序号兜底），完全无内容返回空数组。
 */
export function extractInspirationVersions(text: string): InspirationExpandVersion[] {
  if (!text) return [];
  const lines = text.split('\n');
  const versions: InspirationExpandVersion[] = [];
  let current: Pick<InspirationExpandVersion, 'title' | 'body'> | null = null;
  let sawMarker = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('>>>')) {
      sawMarker = true;
      if (current) versions.push(current);
      const title = line.replace(/^>>>+\s*/, '').trim() || `版本 ${versions.length + 1}`;
      current = { title, body: '' };
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${raw}` : raw;
    }
  }
  if (current) versions.push(current);

  if (versions.length === 0) {
    if (!sawMarker && text.trim()) {
      return [{ title: '版本 1', body: text.trim() }];
    }
    return [];
  }

  // 收敛多余空行：去掉版本正文头部/尾部的空行；正文内连续空行压成一个（段落分隔）
  return versions.map((v, i) => ({
    title: v.title.trim() || `版本 ${i + 1}`,
    body: v.body
      .split('\n')
      .reduce<string[]>((acc, line) => {
        if (line.trim()) {
          acc.push(line);
        } else if (acc.length > 0 && acc[acc.length - 1] !== '') {
          acc.push('');
        }
        return acc;
      }, [])
      .join('\n')
      .trim(),
  }));
}
