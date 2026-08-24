import fs from "fs";
import path from "path";

const root = process.cwd();
const persistenceReplaySource = fs.readFileSync(
  path.join(root, "server/scripts/replay-contract-ocr-auto-write.ts"),
  "utf8",
);
const httpReplaySource = fs.readFileSync(
  path.join(root, "server/scripts/replay-contract-ocr-http-e2e.ts"),
  "utf8",
);

describe("合同识别隔离回放安全门禁", () => {
  it("金额比较先区分空值与零值", () => {
    for (const source of [persistenceReplaySource, httpReplaySource]) {
      expect(source).toContain(
        "if (left === null || right === null) return left === right",
      );
    }
  });

  it("冻结回放锁定真值、配置、策略和模型版本", () => {
    expect(persistenceReplaySource).toContain(
      'const EXPECTED_GROUND_TRUTH_VERSION = "contract-ocr-v6-regression-50-v2"',
    );
    expect(persistenceReplaySource).toContain(
      "record.auditConfigurationHash !== EXPECTED_AUDIT_CONFIGURATION_HASH",
    );
    expect(persistenceReplaySource).toContain(
      "record.result.automaticAdoption?.policyVersion !==",
    );
    expect(persistenceReplaySource).toContain(
      'record.result.modelVersion !== "v6_medium"',
    );
  });

  it("实时模式不宣称未执行的并发认领验证", () => {
    expect(persistenceReplaySource).toContain(
      'options.mode === "cached" ? false : null',
    );
    expect(persistenceReplaySource).not.toContain(
      "concurrencyClaimedOnce = true",
    );
  });

  it("直接任务重建探针不冒充 HTTP（超文本传输协议）重试接口", () => {
    expect(persistenceReplaySource).toContain("directJobRecreationProbePassed");
    expect(persistenceReplaySource).not.toContain("retryProbePassed");
  });

  it("报告明确冻结回放和实时回放的证据边界", () => {
    expect(persistenceReplaySource).toContain('"冻结识别结果数据库持久化回放"');
    expect(persistenceReplaySource).toContain(
      '"原文件实时识别数据库持久化回放（绕过上传接口）"',
    );
    expect(persistenceReplaySource).toContain("httpUploadRouteExecuted: false");
    expect(persistenceReplaySource).toContain(
      'syntheticOcrLines: options.mode === "cached"',
    );
    expect(persistenceReplaySource).toContain(
      'provesFieldAccuracy: options.mode === "live"',
    );
  });

  it("回放结束只清理本次隔离上传文件", () => {
    expect(persistenceReplaySource).toContain("replayUploadDirectory(options)");
    expect(persistenceReplaySource).toContain("recursive: true");
    expect(httpReplaySource).toContain("WHERE contract.created_by = ?");
    expect(httpReplaySource).toContain(
      '"HTTP（超文本传输协议）回放上传文件路径越界，拒绝清理"',
    );
  });

  it("HTTP（超文本传输协议）回放严格校验逐行坐标与模型版本", () => {
    expect(httpReplaySource).toContain("function isValidOcrBbox");
    expect(httpReplaySource).toContain("value.length === 4");
    expect(httpReplaySource).not.toContain("line.text.trim().length === 0");
    expect(httpReplaySource).toContain('line.modelVersion !== "v6_medium"');
    expect(httpReplaySource).toContain('jobBody.engineVersion !== "v6_medium"');
    expect(httpReplaySource).toContain("crypto.randomBytes(24)");
  });

  it("第十阶段先重验冻结基线，再输出可汇总的真实端到端证据", () => {
    expect(httpReplaySource).toContain("verifyContractOcrStage10Freeze");
    expect(httpReplaySource).toContain("schemaVersion: 2");
    expect(httpReplaySource).toContain(
      'amountStatusEvidence: "independent_live_replay"',
    );
    expect(httpReplaySource).toContain(
      'memoryMeasurement: "docker_cgroup_total"',
    );
    expect(httpReplaySource).toContain("debug/contract-ocr-stage10-private");
    expect(httpReplaySource).toContain("合同域六张表均为空的全新隔离数据库");
  });

  it("主链路性能在独立金额状态复跑前截止，异常路径幂等停止内存采样", () => {
    expect(httpReplaySource.indexOf("const httpFlowDurationMs")).toBeLessThan(
      httpReplaySource.indexOf("const independentResult"),
    );
    expect(
      httpReplaySource.indexOf("const httpFlowPeakMemoryBytes"),
    ).toBeLessThan(httpReplaySource.indexOf("const independentResult"));
    expect(httpReplaySource).toContain("let stopped = false");
    expect(httpReplaySource).toContain("memoryMonitor?.stop()");
  });

  it("第十阶段对六张合同域表执行结构与批末图谱污染校验", () => {
    expect(httpReplaySource).toContain("contractGraphFingerprint");
    expect(httpReplaySource).toContain("stage10ContractGraphFingerprints");
    expect(httpReplaySource).toContain("contractGraphStructurallyValid");
    expect(httpReplaySource).toContain("contract_child_graph_pollution");
    for (const table of [
      "contracts",
      "contract_files",
      "contract_ocr_jobs",
      "contract_ocr_fields",
      "contract_ocr_lines",
      "contract_audit_logs",
    ]) {
      expect(httpReplaySource).toContain(`FROM ${table}`);
    }
  });
});
