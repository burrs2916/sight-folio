// 诗歌形式（poetryForms）—— 判的是"几句、每句几字"，这一刀的专业性全在这几行里。
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import {
  POETRY_FORMS,
  POETRY_TRADITION_KEYS,
  checkPoemForm,
  countPoemChars,
  estimateSyllables,
  hasCjk,
  poemLines,
  poetryFormDef,
  poemFormView,
  poetryGroupsForLang,
  readPoemForm,
  withPoemForm,
} from '../poetryForms';

const fiveFour = '<p>床前明月光</p><p>疑是地上霜</p><p>举头望明月</p><p>低头思故乡</p>';

describe('形式表本体', () => {
  it('id 不重复，且四个传统之外的形式一律不许混进来', () => {
    const ids = POETRY_FORMS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of POETRY_FORMS) expect(Object.keys(POETRY_TRADITION_KEYS)).toContain(f.tradition);
  });

  it('标签与传统名在 i18n 里真的翻得出来（翻不出来界面就印裸 key）', () => {
    for (const f of POETRY_FORMS) {
      expect(t(f.labelKey), f.id).not.toBe(f.labelKey);
      expect(t(POETRY_TRADITION_KEYS[f.tradition])).not.toBe(POETRY_TRADITION_KEYS[f.tradition]);
    }
    expect(t('writing.poetryForm.wuJueju')).toBe('五言绝句');
  });
});

describe('行与字数', () => {
  it('硬换行 <br> 与独立段落 </p> 都必须算一句（只认一种，句数必错）', () => {
    expect(poemLines(fiveFour)).toHaveLength(4);
    expect(poemLines('<p>床前明月光<br>疑是地上霜</p><p>举头望明月<br>低头思故乡</p>')).toHaveLength(4);
  });

  it('节与节之间的空行不算句', () => {
    expect(poemLines('<p>一句</p><p></p><p>二句</p>')).toEqual(['一句', '二句']);
  });

  it('标点与空白不计入"言"（五言的五是五个字，不是五个字符）', () => {
    expect(countPoemChars('关关，雎鸠')).toBe(4);
    expect(countPoemChars('床前明月光。')).toBe(5);
    expect(countPoemChars('')).toBe(0);
  });
});

describe('checkPoemForm', () => {
  it('五言绝句：四句各五字 = 合格', () => {
    const c = checkPoemForm(fiveFour, 'wu-jueju');
    expect(c).toMatchObject({ applicable: true, unconstrained: false, lineCountOk: true, badCharLines: 0, ok: true });
  });

  it('每句字数不符要点名到第几句', () => {
    const bad = '<p>床前明月光</p><p>疑是地上霜霜</p><p>举头望明月</p><p>低头思故乡</p>';
    const c = checkPoemForm(bad, 'wu-jueju');
    expect(c.badCharLines).toBe(1);
    expect(c.lines.find((l) => !l.ok)).toMatchObject({ index: 2, chars: 6 });
    expect(c.ok).toBe(false);
  });

  it('句数不符（五律该八句）单独判，不靠字数掩盖', () => {
    const c = checkPoemForm(fiveFour, 'wu-lvshi');
    expect(c.lineCountOk).toBe(false);
    expect(c.badCharLines).toBe(0);
    expect(c.ok).toBe(false);
  });

  it('自由诗 / 散文诗 / 古风：只标注不校验（绝不当它们"出格"）', () => {
    for (const id of ['free-verse', 'prose-poem', 'gu-feng']) {
      const c = checkPoemForm('<p>随便多长的一行</p><p>另一行</p>', id);
      expect(c, id).toMatchObject({ applicable: true, unconstrained: true, ok: true, badCharLines: 0 });
    }
  });

  it('十四行按句数判，不管每句几字', () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => `<p>第${i + 1}行长短不一</p>`).join('');
    expect(checkPoemForm(fourteen, 'sonnet').ok).toBe(true);
    expect(checkPoemForm(fourteen + '<p>多一行</p>', 'sonnet').lineCountOk).toBe(false);
  });

  it('没标形式 / 形式不认识 → 不下结论，绝不"默认合格"', () => {
    for (const id of ['', 'ci-pai-unknown']) {
      const c = checkPoemForm(fiveFour, id);
      expect(c, id).toMatchObject({ applicable: false, unconstrained: false, ok: true });
      expect(c.lines).toEqual([]);
    }
  });

  it('空正文不许被当成"零句 = 合格"', () => {
    const c = checkPoemForm('', 'wu-jueju');
    expect(c.lineCountOk).toBe(false);
    expect(c.ok).toBe(false);
  });
});

describe('extra 往返（形式存 writing_chapters.extra，零迁移）', () => {
  it('写入后读得出，且 extra 里原有键一个不丢', () => {
    const extra = withPoemForm(JSON.stringify({ cover: 'a.png', deletedAt: 0 }), 'qi-jueju');
    expect(readPoemForm(extra)).toBe('qi-jueju');
    const obj = JSON.parse(extra);
    expect(obj.cover).toBe('a.png');
    expect(obj.deletedAt).toBe(0);
  });

  it('传空串 = 清除标注；脏 extra 不崩', () => {
    expect(readPoemForm(withPoemForm('{"poemForm":"haiku"}', ''))).toBe('');
    expect(readPoemForm('{坏数据')).toBe('');
    expect(readPoemForm('')).toBe('');
    expect(JSON.parse(withPoemForm('坏数据', 'haiku')).poemForm).toBe('haiku');
  });

  it('表里每个 id 都能被 poetryFormDef 取回（防改表忘改判据）', () => {
    for (const f of POETRY_FORMS) expect(poetryFormDef(f.id)).toBe(f);
  });
});

// ── 英文侧（2026-11-09 李先生：「英文的诗歌肯定不一样，切到英文要切成英文的一套」）
// 关键不是翻译：中文量"言"（每句字数），英文量**音节**与**节结构**。这两套判据不能互串。
describe('英文形式的节结构判定', () => {
  const st = (sizes: number[]) => sizes.map((n) => `<p>${Array.from({ length: n }, (_, i) => `行${i + 1}`).join('<br>')}</p>`).join('');

  it('莎翁体十四行 = 4+4+4+2 才叫合式；只凑够 14 行不算', () => {
    expect(checkPoemForm(st([4, 4, 4, 2]), 'sonnet-shakespearean').stanzaOk).toBe(true);
    const wrong = checkPoemForm(st([3, 3, 3, 3, 2]), 'sonnet-shakespearean');
    expect(wrong.lineCountOk, '总行数是对的（14）').toBe(true);
    expect(wrong.stanzaOk, '但节结构不是 4+4+4+2').toBe(false);
    expect(wrong.ok).toBe(false);
    expect(wrong.stanzaShape).toEqual([3, 3, 3, 3, 2]);
  });

  it('彼特拉克体 = 8+6；villanelle = 3×5+4；sestina = 6×6+3', () => {
    expect(checkPoemForm(st([8, 6]), 'sonnet-petrarchan').ok).toBe(true);
    expect(checkPoemForm(st([3, 3, 3, 3, 3, 4]), 'villanelle').ok).toBe(true);
    expect(checkPoemForm(st([6, 6, 6, 6, 6, 6, 3]), 'sestina').ok).toBe(true);
    expect(checkPoemForm(st([4, 4, 4, 3]), 'sonnet-petrarchan').stanzaOk).toBe(false);
  });

  it('重复节长型（民谣节每节 4 行 / 英雄双句每节 2 行）：节数不限，节长必须整除', () => {
    expect(checkPoemForm(st([4, 4, 4]), 'ballad-stanza').ok).toBe(true);
    expect(checkPoemForm(st([4, 3, 4]), 'ballad-stanza').stanzaOk).toBe(false);
    expect(checkPoemForm(st([2, 2]), 'heroic-couplet').ok).toBe(true);
  });

  it('五行打油诗只钉句数 5，不假装有节结构', () => {
    const c = checkPoemForm(st([5]), 'limerick');
    expect(c).toMatchObject({ lineCountOk: true, stanzaOk: true, ok: true });
  });
});

describe('音节是估算：只出提示，永不与硬判定混成一个红叉', () => {
  const penta = 'That time of year that thou mayest perceive in me';

  it('无韵五步抑扬格给出 meterOk 提示，但不因它翻掉硬结论', () => {
    const c = checkPoemForm(`<p>${penta}</p><p>${penta}</p>`, 'blank-verse');
    expect(c.meterOk, '音节是估算，值本身只要求"判得出"').not.toBeNull();
    expect(typeof c.meterOk).toBe('boolean');
    expect(c.unconstrained, '无韵体没有句数/节结构硬约束').toBe(true);
    expect(c.ok, '硬判定为空 → 一律 ok（绝不拿估算当不合格）').toBe(true);
  });

  it('中文形式没有音节要求 → meterOk 恒 null（不无中生有）', () => {
    expect(checkPoemForm('<p>床前明月光</p><p>疑是地上霜</p><p>举头望明月</p><p>低头思故乡</p>', 'wu-jueju').meterOk).toBeNull();
  });

  it('估算函数本身：单音节=1，不发音 -e 不加量，-le 成音节', () => {
    expect(estimateSyllables('day')).toBe(1);
    expect(estimateSyllables('made')).toBe(1);
    expect(estimateSyllables('bottle')).toBe(2);
    expect(estimateSyllables('Shakespeare')).toBeGreaterThanOrEqual(2);
  });

  it('俳句按 5-7-5 出提示（英文正文），句数硬判定仍是 3 行', () => {
    const c = checkPoemForm('<p>old pond</p><p>a frog leaps into</p><p>water sound</p>', 'haiku');
    expect(c.lineCountOk).toBe(true);
    expect(c.meterOk === true || c.meterOk === false).toBe(true);
  });
});

describe('语种不匹配就不下判定（五言套英文诗 = 废话结论，禁止产出）', () => {
  it('五言绝句标在纯英文正文上 → measureSkipped，且不报"每句字数不符"', () => {
    const c = checkPoemForm('<p>Shall I compare thee to a summer day</p><p>Thou hast a summer never dimmed away</p><p>And this but breath</p><p>And this but air</p>', 'wu-jueju');
    expect(c.measureSkipped).toBe('zh-form-on-non-cjk');
    expect(c.badCharLines, '每句字数判定整体跳过 → 不该报出 4 句全出格').toBe(0);
    expect(c.lines.every((l) => l.ok)).toBe(true);
  });

  it('反向：英文形式标在中文诗上同样跳过（并保留能硬判的部分）', () => {
    const c = checkPoemForm('<p>莎翁体若被标在汉字上</p><p>每句音节数根本无从谈起</p><p>那就只判行吧</p>', 'blank-verse');
    expect(c.measureSkipped).toBe('en-form-on-cjk');
    expect(c.meterOk).toBeNull();
  });

  it('空正文不触发语种跳过（没内容就没得判）', () => {
    expect(checkPoemForm('', 'wu-jueju').measureSkipped).toBe('');
  });

  it('hasCjk 只认汉字存在与否，不做比例判定', () => {
    expect(hasCjk('床前')).toBe(true);
    expect(hasCjk('summer day')).toBe(false);
    expect(hasCjk('')).toBe(false);
  });
});

describe('界面语言切换：换排序与主次，绝不把另一边的形式抹掉', () => {
  it('中文界面第一组是中国古典；英文界面第一组是西方传统', () => {
    expect(poetryGroupsForLang('zh-CN')[0].tradition).toBe('cn-classic');
    expect(poetryGroupsForLang('en-US')[0].tradition).toBe('west');
  });

  it('两种语言下的分组并集必须等于整张表，且每项只出现一次（折叠的是展示，不是事实）', () => {
    for (const lang of ['zh-CN', 'en-US'] as const) {
      const flat = poetryGroupsForLang(lang).flatMap((g) => g.forms.map((f) => f.id));
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.slice().sort()).toEqual(POETRY_FORMS.map((f) => f.id).slice().sort());
    }
  });

  it('fit 字段必须在两种语言下都拿得到，且只认三个值', () => {
    for (const f of POETRY_FORMS) expect(['zh', 'en', 'any']).toContain(f.fit);
  });
});

// ── poemFormView：界面上那枚颜色到底能不能信（⑫ 的假红防线）
describe('poemFormView（判定视图，组件只渲染这一层）', () => {
  const ex = (id: string) => JSON.stringify({ poemForm: id });
  const good = '<p>床前明月光</p><p>疑是地上霜</p><p>举头望明月</p><p>低头思故乡</p>';

  it('没标形式 → null（由界面显示空态，不在这里造 tone）', () => {
    expect(poemFormView(good, '{}')).toBeNull();
    expect(poemFormView(good, '{坏数据')).toBeNull();
  });

  it('正文为空 / 只有空段落 → notMeasured，**绝不出"零句不合格"的假红**', () => {
    for (const blank of ['', '   ', '<p></p><p></p>']) {
      const v = poemFormView(blank, ex('wu-jueju'));
      expect(v, JSON.stringify(blank)).not.toBeNull();
      expect(v!.notMeasured).toBe(true);
      expect(v!.tone).toBe('none');
      expect(v!.messageKey).toBe('writing.poemFormUI.formNone');
    }
  });

  it('合式给绿；某句多一字给红并带出格句数', () => {
    const ok = poemFormView(good, ex('wu-jueju'))!;
    expect(ok.tone).toBe('ok');
    expect(ok.messageKey).toBe('writing.poemFormUI.formOk');
    const bad = poemFormView('<p>床前明月光</p><p>疑是地上霜霜</p><p>举头望明月</p><p>低头是故乡</p>', ex('wu-jueju'))!;
    expect(bad.tone).toBe('bad');
    expect(bad.messageKey).toBe('writing.poemFormUI.formBad');
    expect(bad.messageParams).toEqual({ n: 1 });
  });

  it('节结构不符 → 报"实际 vs 应为"，读数可直接印出来（4+4+4+2）', () => {
    // 夹具必须是**英文正文**：标的是英文形式，用中文占位文本会被语种护栏判成 skip（灰）而非 bad（红）——
    // 这不是测试找茬，正是 ⑫ 那条护栏该有的行为。
    const shape = (sizes: number[]) => sizes.map((n) => `<p>${Array.from({ length: n }, (_, i) => `line ${i + 1} of the poem`).join('<br>')}</p>`).join('');
    const v = poemFormView(shape([3, 3, 3, 3, 2]), ex('sonnet-shakespearean'))!;
    expect(v.tone).toBe('bad');
    expect(v.messageKey).toBe('writing.poemFormUI.formStanzaBad');
    expect(v.messageParams.actual).toBe('3+3+3+3+2');
    expect(v.messageParams.expect).toBe('4+4+4+2');
    expect(v.stanzaShape).toBe('3+3+3+3+2');
    expect(poemFormView(shape([4, 4, 4, 2]), ex('sonnet-shakespearean'))!.stanzaShape).toBe('4+4+4+2');
  });

  it('语种不匹配 → tone=skip（灰，不是红）', () => {
    const v = poemFormView('<p>Shall I compare thee to a summer day</p><p>And this but breath</p>', ex('wu-jueju'))!;
    expect(v.tone).toBe('skip');
    expect(v.messageKey).toBe('writing.poemFormUI.formLangSkip');
  });

  it('音节读数只给有音节要求的形式；且它是提示不是判决', () => {
    const bv = poemFormView('<p>That time of year that thou mayest perceive in me</p>', ex('blank-verse'))!;
    expect(bv.meterHint).not.toBeNull();
    expect(bv.tone, '无韵体无硬约束 → 不许拿估算判红').toBe('none');
    expect(poemFormView(good, ex('wu-jueju'))!.meterHint).toBeNull();
  });

  it('自由诗 / 散文诗：有标注也无判定（tone=none，不是 ok 也不是 bad）', () => {
    for (const id of ['free-verse', 'prose-poem']) {
      const v = poemFormView('<p>随便写</p>', ex(id))!;
      expect(v, id).not.toBeNull();
      expect(v!.tone, id).toBe('none');
    }
  });

  it('八个状态文案键在两种语言都翻得出来', () => {
    for (const k of ['form', 'formNone', 'formOk', 'formBad', 'formStanzaBad', 'formMeterHint', 'formLangSkip', 'formClear']) {
      const key = `writing.poemFormUI.${k}`;
      expect(t(key)).not.toBe(key);
    }
  });
});
