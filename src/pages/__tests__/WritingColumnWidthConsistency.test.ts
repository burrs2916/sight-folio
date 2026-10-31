// 写作台右栏「列宽口径唯一」回归锁（第十二轮批④，2026-10-31）
//
// 病灶是观感级的「切到章详情/设定卡布局就乱」：右栏三个视图（正文 / 章详情 / 设定卡）
// 各写死或各取一套内容列宽。用户在排版面板把页宽调到 620 或 900 后来回切视图，内容列
// 肉眼可见地跳宽；更隐蔽的一种是**同一屏内上下两块宽度本就不相等**——Box 默认 border-box，
// `maxWidth` 与 `px` 写在同一层时左右内边距被扣进限宽里（md 档净宽 760-32=728），
// 而把 `maxWidth` 放在 padding 之外的内层则净宽 760。两处都写 760 却宽窄不一，
// 就是「没动设置、切个视图版式歪了」的来源。
//
// 锁三件事：① 章详情/设定卡列宽跟随排版页宽；② 右栏不再有硬编码 760 内容列
// （正则只认代码形态 `maxWidth: 760,`/`}`，不误伤说明注释里的「原 maxWidth:760」字样）；
// ③ 限宽层与内边距层分离（外层只给 px、内层才限 maxWidth，规避 border-box 陷阱）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const page = readFileSync(`${ROOT}/src/pages/WritingPage.tsx`, 'utf8');
const panel = readFileSync(`${ROOT}/src/pages/ChapterDetailsPanel.tsx`, 'utf8');

describe('① 章详情/设定卡列宽跟随排版页宽', () => {
  it('章详情分支把排版页宽传给面板（与上方九维统筹卡同一口径）', () => {
    const at = page.indexOf('<ChapterDetailsPanel');
    const call = page.slice(at, at + 800);
    expect(call).toMatch(/contentMaxWidth=\{typo\.pageWidth\}/);
  });
  it('设定卡内容列跟随页宽', () => {
    expect(page).toMatch(/maxWidth: typo\.pageWidth, mx: 'auto', display: 'flex', flexDirection: 'column'/);
  });
});

describe('② 右栏不再有硬编码 760 内容列（仅代码形态，不误伤注释）', () => {
  it('WritingPage 无代码形态 maxWidth: 760（后跟 , 或 }）', () => {
    expect(page).not.toMatch(/maxWidth:\s*760\s*[,}]/);
  });
  it('ChapterDetailsPanel 列宽改为可传参：默认值仅在 props 解构处、限宽用 contentMaxWidth', () => {
    expect(panel).toMatch(/contentMaxWidth = 760/);
    expect(panel).toMatch(/maxWidth:\s*contentMaxWidth/);
    // 不许再出现写死的 maxWidth: 760（代码形态）
    expect(panel).not.toMatch(/maxWidth:\s*760\s*[,}]/);
  });
});

describe('③ 限宽层与内边距层分离（border-box 陷阱）', () => {
  it('设定卡头部：外层只给 px 无 maxWidth', () => {
    expect(page).toMatch(/<Box sx=\{\{ px: \{ xs: 2, md: 6 \}, pt: 2\.5, width: '100%' \}\}>/);
  });
  it('设定卡头部内层：maxWidth 独立成层，其后紧跟 width/mx/display/alignItems（该层不含 px）', () => {
    expect(page).toMatch(
      /maxWidth: typo\.pageWidth,\s*width: '100%',\s*mx: 'auto',\s*display: 'flex',\s*alignItems: 'center',/,
    );
  });
  it('章详情统筹卡同样分离（内层 maxWidth+mx:auto）', () => {
    const details = page.slice(page.indexOf("rightTab === 'details'"), page.indexOf('<ChapterDetailsPanel'));
    expect(details).toMatch(/maxWidth: typo\.pageWidth,\s*\n\s*mx: 'auto',/);
  });
});

describe('④ 正文章头列与正文文字列同位（第十三轮批①）', () => {
  it('章头盒：外层只给 px 无 maxWidth（border-box 分离口径与设定卡/章详情一致；批③后为多行 sx）', () => {
    expect(page).toMatch(/px: \{ xs: 2, md: 6 \},\s*\n\s*pt: 2,\s*\n\s*width: '100%',/);
    // 旧回归：px 与 maxWidth 同层的单行形态不许复活
    expect(page).not.toMatch(/px: \{ xs: 2, md: 6 \}, pt: 2, maxWidth: typo\.pageWidth, mx: 'auto' \}\}/);
  });
  it('章头内层限宽跟随排版页宽（不再与 px 同层）', () => {
    expect(page).toMatch(/maxWidth: typo\.pageWidth, mx: 'auto' \}\}/);
  });
  it('章头不再有「px 与 maxWidth 同层」的旧形态', () => {
    expect(page).not.toMatch(/px: \{ xs: 2, md: 6 \}, pt: 2, maxWidth: typo\.pageWidth/);
  });
});

describe('⑤ 三视图容器内边距同口径（第十三轮批②）', () => {
  // 正文列的净宽 = min(pageWidth, 栏宽 - 2*md6*8)。章详情/设定卡若用更小的 md:4，
  // 右栏窄于 pageWidth+96 时同一页宽下三视图净宽仍差 32px——切视图照样跳宽。
  it('WritingPage 不再有 md:4 档的视图容器内边距', () => {
    expect(page).not.toMatch(/px: \{ xs: 2, md: 4 \}/);
  });
  it('章详情面板容器与正文同用 md:6', () => {
    expect(panel).toMatch(/px: \{ xs: 2, md: 6 \}/);
    expect(panel).not.toMatch(/px: \{ xs: 2, md: 4 \}/);
  });
});

describe('⑥ 章头列几何跟随 focusMode（第十三轮批③）', () => {
  // focus 下正文滚动容器 px 改 md:8、zen 下整条正文变 680 居中列（px md:5）；
  // 章标题头若不吃同一套 override，切沉浸模式时标题与正文列必然错开/悬空。
  const header = page.slice(page.indexOf("批③：外栏几何跟随 focusMode"), page.indexOf('ref={editorScrollRef}'));
  it('章头盒含与正文同型的 zen / focus override', () => {
    expect(header).toMatch(/focusMode === 'zen'/);
    expect(header).toMatch(/maxWidth: 680/);
    expect(header).toMatch(/focusMode === 'focus' \? \{ px: \{ xs: 3, md: 8 \} \}/);
  });
});
