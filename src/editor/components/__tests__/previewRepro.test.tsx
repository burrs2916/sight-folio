// EntityRendererPreview 健壮性：任何调用方传空/缺失 config 都不崩溃（画布/实体管理/画像面板共用）
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { EntityRendererPreview } from "../EntityRendererPreview";

describe("EntityRendererPreview 渲染器 config 兜底", () => {
  it("module：config 为 undefined/null/缺失均正常渲染（兜底 {}）", () => {
    for (const cfg of [undefined, null, undefined as unknown]) {
      const html = renderToString(
        <EntityRendererPreview type="module" config={cfg as any} width={158} height={66} />
      );
      expect(html).toContain("unnamed");
    }
    const noCfg = renderToString(<EntityRendererPreview type="module" width={158} height={66} />);
    expect(noCfg).toContain("unnamed");
  });

  it("class / function / interface：config 缺失不崩溃", () => {
    for (const type of ["class", "function", "interface"]) {
      const html = renderToString(<EntityRendererPreview type={type} width={158} height={66} />);
      expect(html).toBeTruthy();
    }
  });

  it("extraProps 含 config 时不会覆盖兜底（config 最后传）", () => {
    const html = renderToString(
      <EntityRendererPreview
        type="module"
        width={158}
        height={66}
        extraProps={{ config: undefined, depType: "import" }}
      />
    );
    // config 未被 extraProps 覆盖 → 正常渲染出占位名
    expect(html).toContain("unnamed");
  });
});
