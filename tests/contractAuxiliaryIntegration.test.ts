jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import {
  appendContractAuxiliaryFiles,
  createContractAuxiliaryPackage,
} from "@/utils/contractApi";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("辅助合同档案包全链路隔离", () => {
  const schemaSource = source("server/db/index.ts");
  const routeSource = source("server/routes/contractAuxiliaryPackages.ts");
  const serviceSource = source("server/services/contractAuxiliaryPackage.ts");
  const indexSource = source("server/index.ts");
  const apiSource = source("src/utils/contractApi.ts");
  const componentSource = source(
    "src/components/contracts/ContractAuxiliaryPackageManager.vue",
  );
  const createSource = source("src/views/ContractCreate.vue");
  const detailSource = source("src/views/ContractDetail.vue");
  const listSource = source("src/views/ContractList.vue");
  const formalContractRouteSource = source("server/routes/contracts.ts");
  const formalContractServiceSource = source(
    "server/services/contractService.ts",
  );

  it("数据库用专属表、必选父合同和固定 false 核算约束形成物理隔离", () => {
    const packageSchema = schemaSource.slice(
      schemaSource.indexOf(
        "CREATE TABLE IF NOT EXISTS contract_auxiliary_packages",
      ),
      schemaSource.indexOf("CREATE TABLE IF NOT EXISTS contract_ocr_jobs"),
    );
    expect(packageSchema).toContain(
      "parent_contract_id TEXT NOT NULL REFERENCES contracts(id)",
    );
    expect(packageSchema).toContain(
      "CHECK(status IN ('processing', 'succeeded', 'partial', 'failed'))",
    );
    expect(packageSchema).toContain("ocr_fields_json JSONB");
    expect(packageSchema).toContain("ocr_lines_json JSONB");
    expect(packageSchema).toContain(
      "accounting_included BOOLEAN NOT NULL DEFAULT FALSE",
    );
    expect(packageSchema).toContain("CHECK(accounting_included = FALSE)");
    expect(packageSchema).toContain(
      "file_kind TEXT NOT NULL CHECK(file_kind IN ('contract', 'invoice', 'receipt'))",
    );
    expect(packageSchema).toContain("UNIQUE(package_id, file_hash)");
    expect(packageSchema).not.toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_auxiliary_files_current_contract",
    );
  });

  it("旧库显式补齐四个档案运行列并移除全部按文件类型唯一索引", () => {
    for (const column of [
      "ocr_lines_json",
      "error_message",
      "retry_count",
      "version",
    ]) {
      expect(schemaSource).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(schemaSource).toContain(
      "DROP INDEX IF EXISTS idx_contract_auxiliary_files_current_kind",
    );
    expect(schemaSource).toContain(
      "DROP INDEX IF EXISTS idx_contract_auxiliary_files_current_contract",
    );
    expect(schemaSource).not.toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_auxiliary_files_current_contract",
    );
  });

  it("辅助服务不写正式合同金额和财务流水，客户端也没有核算开关", () => {
    for (const forbidden of [
      "INSERT INTO contracts",
      "INSERT INTO contract_invoices",
      "INSERT INTO contract_receipts",
      "INSERT INTO contract_payments",
      "UPDATE worklog_projects",
    ]) {
      expect(serviceSource).not.toContain(forbidden);
    }
    expect(serviceSource).toContain(
      "CONTRACT_AUXILIARY_ACCOUNTING_SCOPE_IMMUTABLE",
    );
    expect(apiSource).not.toContain("accountingIncluded");
    const auxiliarySettingRoute = formalContractRouteSource.slice(
      formalContractRouteSource.indexOf('"/:id/auxiliary-material-setting"'),
      formalContractRouteSource.indexOf('router.delete("/:id"'),
    );
    expect(auxiliarySettingRoute).toContain("contract_auxiliary_packages");
    expect(auxiliarySettingRoute).toContain("SELECT EXISTS");
    expect(formalContractServiceSource).not.toContain(
      "contract_auxiliary_packages",
    );
  });

  it("上传接口要求至少一份合同并允许三类多份，总文件不超过二十份", () => {
    expect(serviceSource).toContain("CONTRACT_AUXILIARY_MAX_FILES = 20");
    expect(routeSource).toMatch(
      /(?:const MAX_AUXILIARY_FILES = 20|CONTRACT_AUXILIARY_MAX_FILES)/u,
    );
    expect(routeSource).toMatch(
      /\{ name: "contract", maxCount: (?:20|MAX_AUXILIARY_FILES) \}/u,
    );
    expect(routeSource).toMatch(
      /\{ name: "invoice", maxCount: (?:20|MAX_AUXILIARY_FILES|CONTRACT_AUXILIARY_MAX_FILES) \}/u,
    );
    expect(routeSource).toMatch(
      /\{ name: "receipt", maxCount: (?:20|MAX_AUXILIARY_FILES|CONTRACT_AUXILIARY_MAX_FILES) \}/u,
    );
    expect(routeSource).toContain("fileSize: 30 * 1024 * 1024");
    expect(routeSource).toMatch(
      /files:\s*(?:MAX_AUXILIARY_FILES|CONTRACT_AUXILIARY_MAX_FILES)/u,
    );
    expect(routeSource).toMatch(/if \(contractFiles\.length === 0\)/u);
    expect(routeSource).toContain("必须上传辅助合同文件");
    expect(serviceSource).toContain("CONTRACT_AUXILIARY_FILE_COUNT_EXCEEDED");
    expect(componentSource).toContain(':disabled="!canArchiveSelection"');
    expect(componentSource).toContain("appendTargetPackage");
    expect(componentSource).toContain("isAppendingToExistingPackage");
    expect(componentSource).toContain("追加并归档");
    expect(componentSource).toContain("contract: []");
    expect(componentSource).toContain("invoice: []");
    expect(componentSource).toContain("receipt: []");
    expect(componentSource).toContain("MAX_AUXILIARY_FILES = 20");
    expect(componentSource).not.toContain(
      ":multiple=\"option.kind !== 'contract'\"",
    );
    expect(componentSource).toMatch(/(?:\smultiple\b|:multiple="true")/u);
    expect(apiSource).toMatch(
      /for \(const contract of payload\.contract(?: \|\| \[\])?\)/u,
    );
    expect(apiSource).toContain("for (const invoice of payload.invoice || [])");
    expect(apiSource).toContain("for (const receipt of payload.receipt || [])");
    expect(componentSource).toContain('label: "发票"');
    expect(componentSource).toContain('label: "银行回单"');
    expect(componentSource).not.toContain("（如有）");
    expect(componentSource).toContain('class="create-panel"');
    expect(componentSource).not.toContain("<el-drawer");
  });

  it("前端接口把多份合同、发票和回单分别追加到表单", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { packageId: "package-1", status: "succeeded", version: 1 },
      },
    });
    const contracts = [
      new File(["contract-1"], "辅助合同-1.pdf", {
        type: "application/pdf",
      }),
      new File(["contract-2"], "辅助合同-2.pdf", {
        type: "application/pdf",
      }),
    ];
    const invoices = [
      new File(["invoice-1"], "发票-1.pdf", { type: "application/pdf" }),
      new File(["invoice-2"], "发票-2.pdf", { type: "application/pdf" }),
    ];
    const receipts = [
      new File(["receipt-1"], "回单-1.png", { type: "image/png" }),
      new File(["receipt-2"], "回单-2.png", { type: "image/png" }),
    ];

    await createContractAuxiliaryPackage("contract-1", {
      contract: contracts,
      invoice: invoices,
      receipt: receipts,
    } as never);

    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(formData.getAll("contract")).toEqual(contracts);
    expect(formData.getAll("invoice")).toEqual(invoices);
    expect(formData.getAll("receipt")).toEqual(receipts);
  });

  it("已有档案包可通过独立接口只追加发票和回单", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          packageId: "package-1",
          version: 2,
          appendedFileCount: 2,
        },
      },
    });
    const invoice = new File(["invoice"], "发票.pdf", {
      type: "application/pdf",
    });
    const receipt = new File(["receipt"], "回单.png", {
      type: "image/png",
    });

    await appendContractAuxiliaryFiles("contract-1", "package-1", 1, {
      invoice: [invoice],
      receipt: [receipt],
    });

    const [requestUrl, requestBody, requestConfig] = (api.post as jest.Mock)
      .mock.calls.at(-1) as [string, FormData, { timeout: number }];
    expect(requestUrl).toBe(
      "/api/contracts/contract-1/auxiliary-packages/package-1/files",
    );
    expect(requestConfig).toEqual({ timeout: 120_000 });
    const formData = requestBody;
    expect(formData.getAll("contract")).toEqual([]);
    expect(formData.getAll("invoice")).toEqual([invoice]);
    expect(formData.getAll("receipt")).toEqual([receipt]);
    expect(formData.get("expectedVersion")).toBe("1");
  });

  it("辅助材料安全校验后直接归档且不调度内容识别", () => {
    const createRoute = routeSource.slice(
      routeSource.indexOf('"/:id/auxiliary-packages",\n  requireFinance'),
      routeSource.indexOf('"/:id/auxiliary-packages/:packageId/note"'),
    );
    expect(createRoute).toContain("createContractAuxiliaryPackage");
    expect(createRoute).toContain("res.status(201)");
    expect(createRoute).not.toContain("scheduleRecognition");
    expect(componentSource).toContain("上传并归档");
    expect(componentSource).not.toContain("重新识别");
    expect(componentSource).not.toContain("识别金额");
    expect(componentSource).toContain("不识别甲乙方、金额或其他内容");
    expect(routeSource).toContain('"/:id/auxiliary-packages/:packageId/files"');
    expect(routeSource).toContain("appendContractAuxiliaryFiles");
    expect(serviceSource).toContain("CONTRACT_AUXILIARY_APPEND_FILE_REQUIRED");
    expect(serviceSource).toContain("auxiliary_package_files_appended");
  });

  it("同类多附件按类型、创建时间和文件编号稳定返回", () => {
    const currentFileQueries = serviceSource.match(
      /ORDER BY[\s\S]{0,220}?created_at ASC,[\s\S]{0,80}?id ASC/gu,
    );
    expect(currentFileQueries?.length || 0).toBeGreaterThanOrEqual(2);
    expect(componentSource).toContain('v-for="file in item.files"');
    expect(componentSource).toContain(
      'v-for="selected in selectedFiles(option.kind)"',
    );
  });

  it("服务端按真实文件头、完整结构、扩展名、摘要和受控路径复验", () => {
    expect(routeSource).toContain("const kind = actualKind(file)");
    expect(routeSource).toContain('tail.includes(Buffer.from("%%EOF"))');
    expect(routeSource).toContain("PDF 文件不完整或缺少结束标记");
    expect(routeSource).toContain(
      "await assertContractFileStructure(buffer, kind)",
    );
    expect(routeSource).toContain(
      "expectedExtensions[kind].includes(extension)",
    );
    expect(routeSource).toContain("validateFilePath(storedPath)");
    expect(routeSource).toContain('crypto.createHash("sha256")');
    expect(routeSource).toContain("normalizeUploadFileName(file.originalname)");
    expect(routeSource).toMatch(
      /if \(!error\) return next\(\);\s*cleanupFiles\(uploadedFiles\(req\)\)/,
    );
    expect(routeSource).toContain("requireFinance");
  });

  it("公开接口使用最小 DTO，不泄露服务器路径、摘要、全文和内部坐标", () => {
    const publicMapper = routeSource.slice(
      routeSource.indexOf("function publicAuxiliaryPackageView"),
      routeSource.indexOf(
        'router.get("/:id/auxiliary-packages", requireFinance',
      ),
    );
    expect(publicMapper).toContain("accountingIncluded: false as const");
    expect(publicMapper).toContain("partyA: null");
    expect(publicMapper).toContain("partyB: null");
    expect(publicMapper).toContain("recognizedAmount: null");
    expect(publicMapper).toContain("ocrFields: []");
    expect(publicMapper).toContain("warnings: []");
    expect(publicMapper).toContain("errorMessage: null");
    expect(publicMapper).toContain("modelVersion: null");
    expect(publicMapper).toContain("parserVersion: null");
    expect(publicMapper).toContain("retryCount: 0");
    expect(publicMapper).not.toContain("filePath:");
    expect(publicMapper).not.toContain("fileHash:");
    expect(publicMapper).not.toContain("rawText:");
    expect(publicMapper).not.toContain("ocrLines:");
    expect(publicMapper).not.toContain("createdBy:");
    expect(publicMapper).not.toContain("updatedBy:");
    expect(routeSource).toContain("packages.map(publicAuxiliaryPackageView)");
    expect(routeSource).toContain(
      "data: publicAuxiliaryPackageView(packageView)",
    );
    expect(routeSource).not.toContain("data: created");
    expect(routeSource).toMatch(
      /data:\s*\{\s*packageId: created\.packageId,\s*status: created\.status,\s*version: created\.version,\s*\}/,
    );
  });

  it("受控预览必须同时命中父合同、档案包和文件编号并复验物理路径", () => {
    const previewRoute = routeSource.slice(
      routeSource.indexOf('"/:id/auxiliary-packages/:packageId/files/:fileId"'),
      routeSource.indexOf("export default router"),
    );
    expect(previewRoute).toContain("requireAuxiliaryRead");
    expect(previewRoute).toContain("getContractAuxiliaryPackage(");
    expect(previewRoute).toMatch(
      /packageView\.files\.find\(\s*\(item\) => item\.id === req\.params\.fileId,?\s*\)/,
    );
    expect(previewRoute).toContain("validateFilePath(file.filePath)");
    expect(previewRoute).toContain("fs.existsSync(absolutePath)");
    expect(previewRoute).toContain("res.sendFile(absolutePath)");
    expect(previewRoute).toContain('req.query.download === "1"');
    expect(previewRoute).toContain('forceDownload ? "attachment" : "inline"');
    expect(componentSource).toContain("previewArchivedFile(item, file)");
    expect(componentSource).toContain("在线预览");
    expect(componentSource).toMatch(
      /getContractAuxiliaryFileUrl\(\s*contractId,\s*item\.id,\s*file\.id,\s*true,?\s*\)/,
    );
    expect(componentSource).toContain("downloadSelectedFile(selected.file)");
    expect(componentSource).toContain("<ContractReadOnlyPreview");
  });

  it("总经理与管理员可读取预览，只有管理员组可以创建和修改", () => {
    expect(routeSource).toMatch(
      /router\.get\(\s*"\/:id\/auxiliary-packages",\s*requireAuxiliaryRead/,
    );
    expect(routeSource).toMatch(
      /"\/:id\/auxiliary-packages\/:packageId",\s*requireAuxiliaryRead/,
    );
    expect(routeSource).toMatch(
      /"\/:id\/auxiliary-packages\/:packageId\/files\/:fileId",\s*requireAuxiliaryRead/,
    );
    expect(routeSource).toMatch(
      /router\.post\(\s*"\/:id\/auxiliary-packages",\s*requireFinance/,
    );
    expect(routeSource).toMatch(
      /"\/:id\/auxiliary-packages\/:packageId\/note",\s*requireFinance/,
    );
    expect(routeSource).toContain('"general_manager"');
    expect(componentSource).toContain("nativePreviewRoles");
    expect(componentSource).toContain(
      'window.open(url, "_blank", "noopener,noreferrer")',
    );
    expect(componentSource).toContain('v-if="canManage"');
    expect(routeSource).toMatch(
      /router\.delete\([\s\S]*?"\/:id\/auxiliary-packages\/:packageId"[\s\S]*?requireFinance/,
    );
    expect(serviceSource).toContain("requires_auxiliary_materials");
    expect(serviceSource).toContain("CONTRACT_AUXILIARY_NOT_REQUIRED");
    expect(serviceSource).toContain("CONTRACT_AUXILIARY_STATUS_FORBIDDEN");
    expect(formalContractRouteSource).toContain(
      '"/:id/auxiliary-material-setting",\n  requireFinance',
    );
    expect(formalContractRouteSource).toContain(
      "requires_auxiliary_materials = $2",
    );
    expect(formalContractRouteSource).toContain(
      "auxiliary_material_requirement_updated",
    );
    expect(formalContractRouteSource).toContain(
      "CONTRACT_AUXILIARY_SETTING_HAS_CONTENT",
    );
    expect(formalContractRouteSource).toContain(
      "请先删除全部辅助材料后再关闭辅助材料开关",
    );
    expect(componentSource).toContain('emit("contentState"');
    expect(detailSource).toContain(
      '@content-state="auxiliaryHasContent = $event"',
    );
    expect(detailSource).toContain("请先删除全部辅助材料后再关闭");
  });

  it("辅助档案组件不在创建页和台账弹窗挂载，只在详情独立页签展示", () => {
    expect(componentSource).toContain("辅助材料特殊情况备注");
    expect(componentSource).toContain('v-model="noteDialogVisible"');
    expect(componentSource).toContain('maxlength="1000"');
    expect(componentSource).toContain("updateContractAuxiliaryNote(");
    expect(createSource).not.toContain("<ContractAuxiliaryPackageManager");
    expect(createSource).not.toContain(
      "import ContractAuxiliaryPackageManager from",
    );
    expect(detailSource).toContain("<ContractAuxiliaryPackageManager");
    expect(detailSource).toContain('name="auxiliary"');
    expect(listSource).not.toContain("<ContractAuxiliaryPackageManager");
    expect(listSource).toContain('query: { tab: "auxiliary" }');
    expect(listSource).toContain("添加辅助材料");
    expect(listSource).toContain("row.requiresAuxiliaryMaterials");
    expect(componentSource).toContain("添加辅助材料");
    expect(componentSource).toContain('label: "发票"');
    expect(componentSource).toContain('label: "银行回单"');
    expect(componentSource).not.toContain("（如有）");
  });

  it("辅助资料文件名使用正常文档流并适配窄屏，不与下一项重叠", () => {
    expect(componentSource).toContain(
      "grid-template-columns: minmax(0, 1fr) auto",
    );
    expect(componentSource).toContain("grid-column: 1 / -1");
    const chosenFileStyles = componentSource.slice(
      componentSource.indexOf(".chosen-file {"),
      componentSource.indexOf(
        ".note-trigger {",
        componentSource.indexOf(".chosen-file {"),
      ),
    );
    expect(chosenFileStyles).not.toContain("position: absolute");
  });

  it("启动时把历史待识别档案直接转为归档且不恢复识别队列", () => {
    expect(routeSource).not.toContain("pendingRecognitionTasks");
    expect(routeSource).not.toContain("scheduleRecognition");
    expect(routeSource).not.toContain("pg_try_advisory_lock");
    expect(routeSource).toContain(
      "resumePendingContractAuxiliaryRecognitionJobs",
    );
    expect(routeSource).toContain("WHERE status = 'processing'");
    expect(routeSource).toContain("SET status = 'succeeded'");
    expect(indexSource).toContain(
      "await resumePendingContractAuxiliaryRecognitionJobs()",
    );
    expect(indexSource.indexOf("contractAuxiliaryPackagesRoutes")).toBeLessThan(
      indexSource.indexOf("contractsRoutes)"),
    );
  });
});
