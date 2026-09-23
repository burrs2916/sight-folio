// 创作体系（utils/writingSchema）纯函数单测
//
// 这里锁的是**建书入口的口径**：建书有三条通路（L1 页签「＋」菜单、拖载体进画布、
// 书库页），它们都必须落到同一套「体裁 → 默认载体」规则上。口径散了会出现
// 「拖散文进来的书是篇目集、点＋建的散文书是未指定」这种看不出坏、但数据不一致的故障。

import { describe, it, expect } from "vitest";
import {
  WRITING_GENRES,
  WRITING_MEDIUMS,
  defaultMediumForGenre,
  genreDef,
  genreLabelKey,
  mediumDef,
  mediumLabelKey,
} from "../writingSchema";

describe("defaultMediumForGenre", () => {
  it("小说 → serial（连载），散文 → collection（篇目集）", () => {
    expect(defaultMediumForGenre("novel")).toBe("serial");
    expect(defaultMediumForGenre("essay")).toBe("collection");
  });

  it("取到的载体必须真的适配该体裁（不是随便返回第一个）", () => {
    for (const g of WRITING_GENRES.filter((x) => x.ready)) {
      const m = mediumDef(defaultMediumForGenre(g.id));
      expect(m, `${g.id} 应能取到载体`).toBeDefined();
      expect(m!.fits).toContain(g.id);
    }
  });

  it("未实装体裁（poetry / script）返回空串 = 未指定，绝不硬塞一个载体", () => {
    for (const g of WRITING_GENRES.filter((x) => !x.ready)) {
      expect(defaultMediumForGenre(g.id)).toBe("");
      expect(WRITING_MEDIUMS.some((m) => m.fits.includes(g.id))).toBe(false);
    }
  });

  it("未知/空体裁返回空串（旧书 genre=\"\" 的零回归路径）", () => {
    expect(defaultMediumForGenre("")).toBe("");
    expect(defaultMediumForGenre("scribble")).toBe("");
  });
});

describe("genre / medium 回落", () => {
  it("未设置的旧书回落到「未设置」文案键，不抛错", () => {
    expect(genreDef("")).toBeUndefined();
    expect(genreLabelKey("")).toBe("writing.genre.unset");
    expect(mediumDef("")).toBeUndefined();
    expect(mediumLabelKey("")).toBe("writing.medium.unset");
  });

  it("每个体裁/载体都有 labelKey —— 缺了就是页签上直接显示 i18n key", () => {
    for (const g of WRITING_GENRES) expect(g.labelKey).toBeTruthy();
    for (const m of WRITING_MEDIUMS) {
      expect(m.labelKey).toBeTruthy();
      expect(m.descKey).toBeTruthy();
      // fits 必须指向已声明的体裁 id，否则建书时永远取不到默认载体
      for (const f of m.fits) expect(genreDef(f), `${m.id}.fits 含未知体裁 ${f}`).toBeDefined();
    }
  });
});
