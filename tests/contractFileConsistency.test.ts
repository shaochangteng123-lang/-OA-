import fs from "fs";
import path from "path";

describe("合同草稿文件一致性", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );

  it("主合同详情仅在子协议上传盖章版后聚合其附件", () => {
    expect(routeSource).toContain("const filesPromise =");
    expect(routeSource).toContain('contract.relation_type === "main"');
    expect(routeSource).toContain(
      "COALESCE(source.root_contract_id, source.id) = ?",
    );
    expect(routeSource).toContain(
      "JOIN contracts source ON source.id = file.contract_id",
    );
    expect(routeSource).toContain("source.relation_type = 'main'");
    expect(routeSource).toContain('currentSealedContractFileExists("source")');
    expect(routeSource).toContain("sealed_file.file_type = 'sealed_contract'");
    expect(routeSource).toContain("sealed_file.is_current = TRUE");
    expect(routeSource).toContain("Promise.resolve<Record<string, any>[]>([])");
    const aggregateQuery = routeSource.slice(
      routeSource.indexOf("const filesPromise ="),
      routeSource.indexOf(
        "const [",
        routeSource.indexOf("const filesPromise ="),
      ),
    );
    expect(aggregateQuery).not.toContain("contract_invoices");
    expect(aggregateQuery).not.toContain("contract_receipts");
    expect(aggregateQuery).not.toContain("contract_auxiliary");
  });

  it("附件接口返回来源合同字段并按主合同、补充序号、解除协议稳定排序", () => {
    for (const alias of [
      "source_contract_id",
      "source_contract_name",
      "source_relation_type",
      "source_supplement_sequence",
    ]) {
      expect(routeSource).toContain(alias);
    }
    expect(routeSource).toContain("sourceContractId: file.source_contract_id");
    expect(routeSource).toContain(
      "sourceRelationType: file.source_relation_type",
    );
    expect(routeSource).toContain(
      "sourceSupplementSequence: file.source_supplement_sequence",
    );
    expect(routeSource).toContain(
      "sourceContractName: file.source_contract_name",
    );
    expect(routeSource).toMatch(
      /ORDER BY CASE source\.relation_type[\s\S]*?WHEN 'main' THEN 0[\s\S]*?WHEN 'supplement' THEN 1[\s\S]*?WHEN 'termination' THEN 2[\s\S]*?source\.supplement_sequence ASC NULLS LAST/u,
    );
  });

  it("聚合附件仍按文件真实归属合同执行预览和直接下载权限", () => {
    const fileReadRoute = routeSource.slice(
      routeSource.indexOf('router.get("/files/:fileId"'),
      routeSource.indexOf(
        '"/:id/supplement-upload-context"',
        routeSource.indexOf('router.get("/files/:fileId"'),
      ),
    );
    expect(fileReadRoute).toContain(
      "canDirectDownloadContractFile(currentActor.role)",
    );
    expect(fileReadRoute).toContain(
      "await assertContractReadScope(req, file.contract_id)",
    );
    expect(fileReadRoute).toContain("CONTRACT_DIRECT_DOWNLOAD_FORBIDDEN");
    expect(fileReadRoute).toContain("validateFilePath(file.file_path)");
  });

  it("文件哈希只在同一合同内去重", () => {
    expect(routeSource).toContain("WHERE contract_id = $1 AND file_hash = $2");
    expect(databaseSource).toContain(
      "ON contract_files(contract_id, file_hash)",
    );
    expect(databaseSource).not.toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_files_hash_unique ON contract_files(file_hash)",
    );
  });

  it("审批材料只有一个当前版本且提交后禁止改写", () => {
    expect(databaseSource).toContain(
      "idx_contract_files_one_current_approval_material",
    );
    expect(routeSource).toContain("APPROVAL_MATERIALS_FROZEN");
    expect(routeSource).toContain(
      "合同已提交审批，送审文件已冻结，不能替换或补充审批材料",
    );
  });

  it("草拟合同替换会创建新识别任务并阻止旧任务回写", () => {
    expect(routeSource).toContain("草拟合同已替换，识别任务已失效");
    expect(routeSource).toContain('lockedJob.file_type !== "draft_contract"');
    expect(routeSource).toContain("!lockedJob.is_current");
    expect(serviceSource).toContain("OCR_FILE_VERSION_MISMATCH");
    expect(serviceSource).toContain("...submissionSnapshot");
    expect(serviceSource).toContain("...approvalTargetSnapshot(round)");
  });

  it("识别队列限制并发并使用可续租的多实例认领", () => {
    expect(routeSource).toContain("CONTRACT_OCR_CONCURRENCY");
    expect(routeSource).toContain(
      "activeRecognitionJobs < recognitionConcurrency",
    );
    expect(routeSource).toContain("worker_token = ?");
    expect(routeSource).toContain("lease_expires_at = ?");
    expect(routeSource).toContain(
      "lease_expires_at IS NULL OR lease_expires_at <= ?",
    );
    expect(databaseSource).toContain("idx_contract_ocr_jobs_claim");
  });

  it("OCR 不会覆盖系统生成的内部合同编号", () => {
    expect(routeSource).toContain("generateContractNumber");
    expect(routeSource).not.toContain(
      "contract_no = COALESCE(NULLIF($9, ''), contract_no)",
    );
  });
});
