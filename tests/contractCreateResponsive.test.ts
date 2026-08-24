import fs from "fs";
import path from "path";

describe("新增合同响应式布局", () => {
  it("窄屏预览区保持定位上下文，上传遮罩不会覆盖整页", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/views/ContractCreate.vue"),
      "utf8",
    );

    expect(source).toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.preview-column\s*\{\s*position:\s*relative;\s*top:\s*auto;\s*\}/,
    );
    expect(source).not.toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.preview-column\s*\{\s*position:\s*static;/,
    );
    expect(source).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.create-steps :deep\(\.el-step\)\s*\{\s*min-width:\s*132px;\s*flex:\s*0 0 132px;\s*\}/,
    );
  });
});
