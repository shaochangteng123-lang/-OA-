jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import fs from "fs";
import path from "path";
import {
  applyTerminationAgreementAtEffective,
  buildTerminationSubjectName,
  calculateTerminationSettlementSnapshot,
  freezeTerminationSettlementSnapshotForApproval,
  requestContractTermination,
} from "../server/services/contractService";
import {
  extractContractBusinessNumber,
  extractReferencedParentContractBusinessNumber,
} from "../server/services/contractOcr";

type ContractFixture = Record<string, unknown> & { id: string };

function mainContract(
  overrides: Record<string, unknown> = {},
): ContractFixture {
  return {
    id: "root-1",
    contract_no: "HT-20260818-000001",
    business_contract_no: "SGBJHD00JJJS2310421",
    title: "焦化厂110千伏输变电工程前期手续技术咨询服务合同",
    project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务合同",
    relation_type: "main",
    status: "executing",
    root_contract_id: "root-1",
    parent_contract_id: null,
    termination_target_contract_id: null,
    category: "main_business",
    declared_category: "main_business",
    declared_subtype: "technical_consulting",
    asset_category: null,
    area: "海淀区",
    project_id: "project-1",
    party_a: "国网北京市电力公司",
    party_b: "北京羽隶工程咨询有限公司",
    financial_direction: "income",
    asset_funding_mode: null,
    amount_delta: 100,
    original_contract_amount: 100,
    current_effective_amount: 100,
    version: 1,
    ...overrides,
  };
}

function supplementContract(
  overrides: Record<string, unknown> = {},
): ContractFixture {
  return {
    ...mainContract(),
    id: "supplement-1",
    title: "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）",
    project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）",
    relation_type: "supplement",
    root_contract_id: "root-1",
    parent_contract_id: "root-1",
    amount_before_change: 100,
    amount_delta: 50,
    amount_after_change: 150,
    current_effective_amount: null,
    ...overrides,
  };
}

function terminationAgreement(
  targetContractId: string,
  before: number,
  after: number,
  delta: number,
): ContractFixture {
  return {
    ...mainContract(),
    id: "termination-1",
    title: "焦化厂110千伏输变电工程前期手续技术咨询服务解除协议书",
    project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务解除协议书",
    relation_type: "termination",
    status: "pending_seal",
    root_contract_id: "root-1",
    parent_contract_id: "root-1",
    termination_target_contract_id: targetContractId,
    amount_before_change: before,
    amount_after_change: after,
    amount_delta: delta,
    contract_date: "2026-08-18",
  };
}

function settlementClient(input: {
  root: ContractFixture;
  target?: ContractFixture;
  settledAmount: number;
}) {
  const target = input.target || input.root;
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT * FROM contracts")) {
        const id = String(params[0] || "");
        if (id === target.id) return { rows: [target] };
        if (id === input.root.id) return { rows: [input.root] };
      }
      if (sql.includes("AS settled_amount")) {
        return { rows: [{ settled_amount: input.settledAmount }] };
      }
      if (sql.includes("relation_type IN ('supplement', 'termination')")) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe("解除协议名称和二维码编号", () => {
  it("主合同名称去掉文种后缀并追加解除协议书", () => {
    expect(
      buildTerminationSubjectName({
        project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务合同",
        title: null,
      }),
    ).toBe("焦化厂110千伏输变电工程前期手续技术咨询服务解除协议书");
  });

  it("解除补充协议时保留补充协议序号", () => {
    expect(
      buildTerminationSubjectName({
        project_name:
          "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）",
        title: null,
      }),
    ).toBe(
      "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）解除协议书",
    );
  });

  it("二维码完整保留解除协议自身的C后缀并反推原合同编号", () => {
    const lines = [
      {
        page: 1,
        text: "二维码合同编号：SGBJHD00JJJS2310421(C)",
        bbox: [],
        confidence: 0.99,
        modelVersion: "v6_medium" as const,
      },
      {
        page: 2,
        text: "二维码合同编号：SGBJHD00JJJS2310421(C)",
        bbox: [],
        confidence: 0.99,
        modelVersion: "v6_medium" as const,
      },
    ];
    const ownNumber = extractContractBusinessNumber(lines);

    expect(ownNumber?.value).toBe("SGBJHD00JJJS2310421(C)");
    expect(
      extractReferencedParentContractBusinessNumber(lines, ownNumber),
    ).toBe("SGBJHD00JJJS2310421");
  });
});

describe("主合同解除结算", () => {
  it("未保存收支方向时按合同分类确定收入方向", async () => {
    const root = mainContract({ financial_direction: null });
    const client = settlementClient({ root, settledAmount: 0 });

    await expect(
      calculateTerminationSettlementSnapshot(
        client as never,
        root.id,
        "2026-08-18",
      ),
    ).resolves.toMatchObject({
      settledAmount: 0,
      unperformedAmount: 100,
      amountDelta: -100,
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM contract_receipts record"),
      ),
    ).toBe(true);
  });

  it("已确认结算超过当前有效金额时阻断解除", async () => {
    const root = mainContract();
    const client = settlementClient({ root, settledAmount: 100.01 });

    await expect(
      calculateTerminationSettlementSnapshot(
        client as never,
        root.id,
        "2026-08-18",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_TERMINATION_SETTLEMENT_EXCEEDS_AMOUNT",
    });
  });

  it("内部划拨资产合同按科技最终对外付款确定已履行金额", async () => {
    const root = mainContract({
      category: "asset",
      declared_category: "asset",
      declared_subtype: "office_asset",
      asset_category: "office_asset",
      financial_direction: "cost",
      asset_funding_mode: "engineering_to_technology",
    });
    const client = settlementClient({ root, settledAmount: 40 });

    await expect(
      calculateTerminationSettlementSnapshot(
        client as never,
        root.id,
        "2026-08-18",
      ),
    ).resolves.toMatchObject({
      settledAmount: 40,
      unperformedAmount: 60,
      amountDelta: -60,
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM contract_external_payments record"),
      ),
    ).toBe(true);
  });

  it.each([
    ["尚未付款", 0, 0, 100, -100],
    ["已付部分", 40, 40, 60, -60],
    ["已付全部", 100, 100, 0, 0],
  ] as const)(
    "%s时只保留已确认结算金额",
    async (_label, actualSettlement, settled, unperformed, delta) => {
      const root = mainContract();
      const client = settlementClient({
        root,
        settledAmount: actualSettlement,
      });

      await expect(
        calculateTerminationSettlementSnapshot(
          client as never,
          root.id,
          "2026-08-18",
        ),
      ).resolves.toMatchObject({
        rootContractId: root.id,
        targetContractId: root.id,
        targetRelationType: "main",
        currentEffectiveAmount: 100,
        settledAmount: settled,
        unperformedAmount: unperformed,
        amountDelta: delta,
      });
    },
  );

  it.each([
    ["尚未付款", 0, 0, 100, -100],
    ["已付部分", 40, 40, 60, -60],
    ["已付全部", 100, 100, 0, 0],
  ] as const)(
    "%s的解除协议只有盖章归档时才终止目标合同",
    async (_label, actualSettlement, settled, unperformed, delta) => {
      const root = mainContract();
      const agreement = terminationAgreement(root.id, 100, settled, delta);
      const client = settlementClient({
        root,
        settledAmount: actualSettlement,
      });

      await expect(
        applyTerminationAgreementAtEffective(
          client as never,
          agreement as never,
          "2026-08-18",
          "2026-08-18T10:00:00.000Z",
          "finance-1",
          "admin",
        ),
      ).resolves.toMatchObject({
        settledAmount: settled,
        unperformedAmount: unperformed,
        amountDelta: delta,
      });

      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE contracts SET status = 'terminated'"),
        [root.id, "2026-08-18T10:00:00.000Z", settled, "finance-1"],
      );
    },
  );

  it("提交审批只冻结结算快照，不提前终止目标合同", async () => {
    const root = mainContract();
    const agreement = terminationAgreement(root.id, 100, 40, -60);
    const client = settlementClient({ root, settledAmount: 40 });

    await expect(
      freezeTerminationSettlementSnapshotForApproval(
        client as never,
        agreement as never,
      ),
    ).resolves.toBe(agreement);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("SET status = 'terminated'"),
      ),
    ).toBe(false);
  });
});

describe("补充协议解除结算", () => {
  it("补充协议缺少生效前金额快照时禁止推测已履行金额", async () => {
    const root = mainContract({ current_effective_amount: 150 });
    const target = supplementContract({
      amount_before_change: null,
      amount_after_change: null,
    });
    const client = settlementClient({ root, target, settledAmount: 125 });

    await expect(
      calculateTerminationSettlementSnapshot(
        client as never,
        target.id,
        "2026-08-18",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_TERMINATION_SUPPLEMENT_AMOUNT_UNSUPPORTED",
    });
  });

  it.each([
    ["尚未履行补充金额", 100, 0, 50, -50],
    ["已履行部分补充金额", 125, 25, 25, -25],
    ["已履行全部补充金额", 150, 50, 0, 0],
  ] as const)(
    "%s时按根合同金额链顺序确定已履行金额",
    async (_label, rootSettlement, settled, unperformed, delta) => {
      const root = mainContract({ current_effective_amount: 150 });
      const target = supplementContract();
      const client = settlementClient({
        root,
        target,
        settledAmount: rootSettlement,
      });

      await expect(
        calculateTerminationSettlementSnapshot(
          client as never,
          target.id,
          "2026-08-18",
        ),
      ).resolves.toMatchObject({
        rootContractId: root.id,
        targetContractId: target.id,
        targetRelationType: "supplement",
        currentEffectiveAmount: 50,
        settledAmount: settled,
        unperformedAmount: unperformed,
        amountDelta: delta,
      });
    },
  );

  it("归档解除补充协议时只终止目标补充协议并同步剩余根合同金额", async () => {
    const root = mainContract({ current_effective_amount: 150 });
    const target = supplementContract();
    const agreement = terminationAgreement(target.id, 50, 25, -25);
    const client = settlementClient({ root, target, settledAmount: 125 });

    await expect(
      applyTerminationAgreementAtEffective(
        client as never,
        agreement as never,
        "2026-08-18",
        "2026-08-18T10:00:00.000Z",
        "finance-1",
        "admin",
      ),
    ).resolves.toMatchObject({
      targetRelationType: "supplement",
      settledAmount: 25,
      unperformedAmount: 25,
      amountDelta: -25,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET status = 'terminated'"),
      [target.id, "2026-08-18T10:00:00.000Z", 25, "finance-1"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("current_effective_amount = COALESCE("),
      [root.id, -25, "finance-1", "2026-08-18T10:00:00.000Z"],
    );
  });
});

describe("解除协议接口与页面入口", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const detailSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
    "utf8",
  );
  const createSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );
  const sealApplicationRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contractSealApplications.ts"),
    "utf8",
  );

  it("旧接口固定拒绝只填写原因就直接终止", async () => {
    await expect(
      requestContractTermination("root-1", "finance-1", "admin", "原因式终止"),
    ).rejects.toMatchObject({
      statusCode: 410,
      code: "CONTRACT_TERMINATION_FILE_REQUIRED",
    });
    expect(routeSource).toContain('router.post("/:id/termination-request"');
    expect(detailSource).not.toContain("handleTerminationRequest");
    expect(detailSource).not.toContain(">申请终止</el-button");
  });

  it("提供解除协议专用上下文和识别接口", () => {
    expect(routeSource).toContain('"/:id/termination-upload-context"');
    expect(routeSource).toContain('"/:id/terminations/recognize"');
    expect(routeSource).toContain("targetContractId");
    expect(routeSource).toContain("parentContractId: root.id");
    expect(routeSource).toContain(
      "CONTRACT_TERMINATION_TARGET_UPLOAD_REQUIRED",
    );
    expect(routeSource).toContain(
      "amount_before_change = COALESCE($26::numeric, $23::numeric)",
    );
    expect(routeSource).toContain(
      "amount_after_change = COALESCE($27::numeric, $24::numeric)",
    );
  });

  it("解除协议单独保存被解除的主合同或补充协议", () => {
    expect(databaseSource).toContain(
      "termination_target_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT",
    );
    expect(databaseSource).toContain("idx_contracts_active_termination_target");
  });

  it("详情通过当前合同编号进入解除协议快速上传", () => {
    expect(detailSource).toContain("上传解除协议书");
    expect(detailSource).toContain('quickTermination: "1"');
    expect(detailSource).toContain(
      "targetContractId: detail.value.contract.id",
    );
  });

  it("创建页分开展示已履行和解除后不再履行金额", () => {
    expect(createSource).toContain("已履行金额");
    expect(createSource).toContain("解除后不再履行金额");
    expect(createSource).toContain("解除后最终合同金额");
  });

  it("解除协议自身金额固定为零且恢复草稿后仍保持解除模式", () => {
    expect(serviceSource).toContain('values.amount = "0.00"');
    expect(serviceSource).toContain(
      'contract.relation_type === "termination" &&\n              field.field_code === "amount"\n            ? "0.00"',
    );
    expect(serviceSource).toContain("toCents(recognizedAmount) !== 0");
    expect(createSource).toContain("restoredTerminationTargetId");
    expect(createSource).toContain('form.relationType === "termination"');
    expect(createSource.match(/formatContractMoney\(0\)/g)?.length).toBe(2);
    expect(sealApplicationRouteSource).toContain(
      'contract.relation_type === "termination"',
    );
    expect(sealApplicationRouteSource).toContain('? "0.00"');
  });

  it("解除协议进入审批或盖章流程后冻结新增财务记录", () => {
    expect(routeSource).toContain("FINANCIAL_RECORD_TERMINATION_PENDING");
    expect(routeSource).toContain(
      "解除协议已进入审批或盖章流程，期间不能新增财务记录",
    );
  });
});
