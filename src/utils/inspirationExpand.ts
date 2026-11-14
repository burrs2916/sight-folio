// sight-folio: 灵感念头池 → AI 扩写（O7）· 纯函数与提示词约定
//
// 职责边界：
// - 与 agent 会话/流式、UI、store 无耦合，单测直跑（不 mock 任何模块）。
// - inspirationExpandSystemHintFor：首轮注入的「灵感扩写」人设（按体裁，㉟ AI-5）+ 版本输出约定
//   （约定与 extractInspirationVersions 的解析规则必须同步维护，改一边必须改另一边）。
// - buildInspirationExpandPrompt：构造扩写指令（念头条目信息 + 版本数 + 体裁，双语）。
// - extractInspirationVersions：从 AI 回复中切出候选版本（`>>> 标题` 行 + 段落正文），
//   供前端逐版本预览并一键插入正文。
import { L } from '../ai/aiLang';
import { workbenchCommandSet } from './writingSchema';

/** 扩写版本数上限（防一次生成过长，前端滑块范围 1–3） */
export const INSPIRATION_EXPAND_MAX_VERSIONS = 3;

/**
 * 灵感扩写人设尾句（㉟ AI-5，2026-11-10 轮 12）：扩写成品是什么形状，本体裁说了算。
 *
 * 病灶（状态文件 §队列 AI-5）：这句写死「可直接放进**小说正文**的段落或场景」——
 * 给诗集扩写会产出散文段落（与 ㉑ 诗歌开闸拦下的同一类越界），给日记扩写则天然 invite
 * 编记忆。novel 一格 = 改造前逐字（零回归线）；**输出格式约定与人味约束全载体共用**
 * （与 `extractInspirationVersions` 的解析规则锁死，不许随体裁漂移）。
 */
const EXPAND_TARGET: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', string> = {
  novel: '可直接放进小说正文的段落或场景',
  essay: '可直接放进散文正文的段落',
  poetry: '可直接放进诗作的片段（按分行写，不要排成散文段落）',
  script: '可直接放进剧本的场次片段（角色名起行、台词另起一行、舞台指示用括注）',
  diary: '可直接放进当天条目的补充内容（只围绕念头里已写明的事展开，不得替作者补写没记的经过）',
};

/** 首轮注入的灵感扩写系统提示（人设按体裁；输出约定与人味约束复用语料参谋那五条） */
export function inspirationExpandSystemHintFor(genre: string): string {
  return `你现在的身份是「本书灵感扩写师」。用户会给你一条尚未成文的灵感念头（标题 + 摘要 + 可能挂载的角色/场景），你把它扩写成${EXPAND_TARGET[workbenchCommandSet(genre)]}。

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
}

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
  /** 作品体裁（㉟ AI-5：空/未设/脏值 = 小说口径，改造前逐字零回归） */
  genre?: string;
}

/** 扩写指令里「N 个 ___」那一格（与 `EXPAND_TARGET` 同域，形状换成「候选…」；novel = 原句逐字） */
const EXPAND_CANDIDATE: Record<'novel' | 'essay' | 'poetry' | 'script' | 'diary', [string, string]> = {
  novel: ['可直接放进小说正文的候选段落/场景', 'candidate passages/scenes directly usable in the novel body'],
  essay: ['可直接放进散文正文的候选段落', 'candidate passages directly usable in the prose piece'],
  poetry: [
    '可直接放进诗作的候选片段（按分行写，不要排成散文段落）',
    'candidate poem fragments (written in lines, never as prose paragraphs)',
  ],
  script: [
    '可直接放进剧本的候选场次片段（角色名起行、台词另起一行）',
    'candidate scene fragments for the play (character name on its own line, dialogue beneath it)',
  ],
  diary: [
    '可直接放进当天条目的候选补充内容（只写念头里已写明的事，不替作者补记忆）',
    "candidate addenda for today's entry (only what the note already states - never supplied memory)",
  ],
};

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
  const [candZh, candEn] = EXPAND_CANDIDATE[workbenchCommandSet(input.genre)];
  parts.push(
    L(
      `\n请基于以上灵感扩写 ${count} 个${candZh}（每个版本以 ">>> " 标题行开头，正文可多段，版本间风格有差异），不要输出其他内容。`,
      `\nPlease expand the inspiration into ${count} ${candEn} (each version starts with a ">>> " title line, body may span multiple paragraphs, versions should differ in approach), and output nothing else.`,
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
