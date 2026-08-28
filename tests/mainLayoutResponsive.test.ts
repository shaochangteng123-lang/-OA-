import fs from "fs";
import path from "path";

describe("主布局笔记本屏幕适配", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/layouts/MainLayout.vue"),
    "utf8",
  );
  const appLayoutRule = source.slice(
    source.indexOf(".app-layout {"),
    source.indexOf("/* 侧边栏", source.indexOf(".app-layout {")),
  );
  const appMainStart = source.indexOf(".app-main {");
  const appMainRule = source.slice(
    appMainStart,
    source.indexOf("}", appMainStart) + 1,
  );

  it("主内容宽度可收缩且始终受可视区域约束", () => {
    expect(appMainRule).toContain("min-width: 0");
    expect(appMainRule).toMatch(/max-width:\s*calc\(100%\s*-\s*64px\)/);
    expect(source).toMatch(
      /\.app-main\.sidebar-pinned\s*\{[\s\S]*?max-width:\s*calc\(100%\s*-\s*220px\)/,
    );
  });

  it("笔记本断点收紧主内容留白", () => {
    const usesFluidPadding = /--yl-main-padding-x:\s*clamp\(/.test(appMainRule);
    const usesLaptopBreakpoint =
      /@media \(max-width:\s*(?:1024|1200|1366)px\)[\s\S]*?\.app-main\s*\{[\s\S]*?--yl-main-padding-x:/.test(
        source,
      );

    expect(usesFluidPadding || usesLaptopBreakpoint).toBe(true);
  });

  it("全局容器不设置固定最小宽度且不开放页面级横向滚动", () => {
    expect(appLayoutRule).not.toMatch(/\bmin-width\s*:/);
    expect(appLayoutRule).toContain("overflow-x: hidden");
    expect(appMainRule).toContain("overflow-x: hidden");
    expect(appMainRule).not.toMatch(/overflow-x:\s*(?:auto|scroll|visible)/);
  });
});
