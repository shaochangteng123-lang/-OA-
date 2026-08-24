import fs from "fs";
import path from "path";

function source(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("合同按角色区分原生浏览器与受控纯预览", () => {
  const previewSource = source(
    "src/components/contracts/ContractReadOnlyPreview.vue",
  );
  const detailSource = source("src/views/ContractDetail.vue");
  const createSource = source("src/views/ContractDownloadRequestCreate.vue");
  const centerSource = source("src/views/ContractDownloadRequestCenter.vue");

  it("预览操作使用带图标、可访问名称和交互反馈的组合按钮", () => {
    expect(previewSource).toContain('class="contract-readonly-overlay"');
    expect(previewSource).toContain('<Teleport to="body"');
    expect(previewSource).toContain(
      'import { ArrowLeft, Download, Loading } from "@element-plus/icons-vue"',
    );
    expect(previewSource).toContain('class="preview-action back"');
    expect(previewSource).toContain('aria-label="返回原页面"');
    expect(previewSource).toContain("<ArrowLeft />");
    expect(previewSource).toContain("<span>返回</span>");
    expect(previewSource).toContain('v-if="canDownload"');
    expect(previewSource).toContain('class="preview-action download"');
    expect(previewSource).toContain('aria-label="下载当前文件"');
    expect(previewSource).toContain("<Download />");
    expect(previewSource).toContain("<span>下载</span>");
    expect(previewSource).toContain("backdrop-filter: blur(14px)");
    expect(previewSource).toContain(".preview-action.back:hover");
    expect(previewSource).toContain(".preview-action.download:hover");
    expect(previewSource).toContain(".preview-action:active");
    expect(previewSource).toContain(".preview-action:focus-visible");
    expect(previewSource).toContain("emit('close')");
    expect(previewSource).toContain("emit('download')");
    expect(previewSource).not.toContain("window.print");
    expect(previewSource).not.toContain("download=1");
    expect(previewSource).toContain("@media print");
    expect(previewSource).toContain('event.key === "Escape"');
    expect(previewSource).toContain('["s", "p"]');
  });

  it("返回只关闭当前页遮罩并保留打开预览前的页面状态", () => {
    const detailCloseSource = detailSource.slice(
      detailSource.indexOf("function closeReadonlyPreview()"),
      detailSource.indexOf("function downloadReadonlyPreview()"),
    );

    expect(previewSource).toContain("@click=\"emit('close')\"");
    expect(previewSource).not.toContain("useRouter");
    expect(previewSource).not.toContain("window.history");
    expect(detailSource).toContain('@close="closeReadonlyPreview"');
    expect(detailCloseSource).toContain("readonlyPreviewVisible.value = false");
    expect(detailCloseSource).not.toContain("router.");
    for (const page of [createSource, centerSource]) {
      expect(page).toContain('@close="readonlyPreviewVisible = false"');
      expect(page).not.toContain("router.back()");
      expect(page).not.toContain("window.history.back");
    }
  });

  it("PDF按显示宽度与屏幕像素密度高清渲染并只预加载可见页", () => {
    expect(previewSource).toContain(
      'loaded.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs"',
    );
    expect(previewSource).toContain("getPdfPreviewRenderMetrics(");
    expect(previewSource).toContain("window.devicePixelRatio");
    expect(previewSource).toContain("getPdfPreviewPlaceholderMetrics(");
    expect(previewSource).toContain("updateVisiblePages");
    expect(previewSource).toContain("const preload");
    expect(previewSource).toContain("await renderPage(firstPage");
    expect(previewSource).toContain("renderTasks.get(pageNumber)?.cancel()");
  });

  it("员工使用权限受控预览而管理员和总经理使用原生浏览器预览", () => {
    for (const page of [detailSource, createSource, centerSource]) {
      expect(page).toContain("<ContractReadOnlyPreview");
      expect(page).toContain("readonlyPreviewVisible.value = true");
    }
    expect(centerSource).toContain(
      "getContractDownloadApplicationPreviewUrl(item.id)",
    );
    expect(centerSource).toContain("getContractDownloadRequestFilePreviewUrl(");
    expect(detailSource).toContain("if (canDirectDownload.value)");
    expect(detailSource).toContain(
      'window.open(getContractFileUrl(file.id), "_blank", "noopener,noreferrer")',
    );
    expect(centerSource).toContain('if (mode.value !== "mine")');
    expect(centerSource.match(/window\.open\(previewUrl/g)).toHaveLength(2);
    expect(centerSource).toContain('"noopener,noreferrer"');
    expect(detailSource).toContain(':can-download="canDirectDownload"');
    expect(detailSource).toContain(
      'const adminRoles = new Set(["super_admin", "chairman", "admin"]);',
    );
    expect(detailSource).toContain(
      'authStore.user?.role === "general_manager"',
    );
    expect(createSource).not.toContain(":can-download=");
    expect(centerSource).toContain(
      ':can-download="readonlyPreviewCanDownload"',
    );
    expect(centerSource).toContain('mode.value !== "mine"');
  });
});
