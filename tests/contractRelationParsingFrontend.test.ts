jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import { getContract } from "@/utils/contractApi";

function mockContractDetail(
  contract: Record<string, unknown>,
  relations: Array<Record<string, unknown>> = [],
) {
  (api.get as jest.Mock).mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        contract: { id: "contract-1", status: "draft", ...contract },
        relations,
      },
    },
  });
}

describe("合同详情关系字段安全解析", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("主合同关系缺失时拒绝加载，不再静默补默认关系", async () => {
    mockContractDetail({});

    await expect(getContract("contract-1")).rejects.toThrow(
      "合同主数据缺少合同关系，已阻止页面继续使用",
    );
  });

  it("主合同关系非法时拒绝加载", async () => {
    mockContractDetail({ relation_type: "legacy" });

    await expect(getContract("contract-1")).rejects.toThrow(
      "合同主数据包含非法合同关系，已阻止页面继续使用",
    );
  });

  it("新旧字段关系不一致时拒绝加载", async () => {
    mockContractDetail({ relationType: "main", relation_type: "supplement" });

    await expect(getContract("contract-1")).rejects.toThrow(
      "合同主数据的合同关系字段互相冲突，已阻止页面继续使用",
    );
  });

  it("合法蛇形字段被解析为受约束的合同关系类型", async () => {
    mockContractDetail({ relation_type: "main" });

    const detail = await getContract("contract-1");

    expect(detail.contract.relationType).toBe("main");
  });

  it("详情与关联合同完整映射补充协议金额链和生效排序字段", async () => {
    mockContractDetail(
      {
        relation_type: "supplement",
        supplement_sequence: 2,
        supplement_change_type: "amount_and_payment",
        original_contract_amount: "100000.00",
        recognized_original_amount: "100000.00",
        recognized_final_amount: "125000.00",
        amount_before_change: "110000.00",
        amount_after_change: "125000.00",
        current_effective_amount: "125000.00",
        effective_at: "2026-08-16T10:00:00.000Z",
      },
      [
        {
          id: "contract-2",
          relation_type: "supplement",
          supplement_sequence: 1,
          supplement_change_type: "payment_terms_only",
          original_contract_amount: "100000.00",
          amount_before_change: "110000.00",
          amount_after_change: "110000.00",
          current_effective_amount: "110000.00",
          effective_at: "2026-08-15T10:00:00.000Z",
        },
      ],
    );

    const detail = await getContract("contract-1");

    expect(detail.contract).toMatchObject({
      supplementSequence: 2,
      supplementChangeType: "amount_and_payment",
      originalContractAmount: "100000.00",
      recognizedOriginalAmount: "100000.00",
      recognizedFinalAmount: "125000.00",
      amountBeforeChange: "110000.00",
      amountAfterChange: "125000.00",
      currentEffectiveAmount: "125000.00",
      effectiveAt: "2026-08-16T10:00:00.000Z",
    });
    expect(detail.relations[0]).toMatchObject({
      supplementSequence: 1,
      supplementChangeType: "payment_terms_only",
      amountBeforeChange: "110000.00",
      amountAfterChange: "110000.00",
      currentEffectiveAmount: "110000.00",
      effectiveAt: "2026-08-15T10:00:00.000Z",
    });
  });

  it("关联合同关系缺失时拒绝整份详情，避免界面误导", async () => {
    mockContractDetail({ relation_type: "main" }, [
      { id: "contract-2", contract_name: "补充协议" },
    ]);

    await expect(getContract("contract-1")).rejects.toThrow(
      "第 1 条关联合同缺少合同关系，已阻止页面继续使用",
    );
  });

  it("关联合同非法关系不会进入界面类型", async () => {
    mockContractDetail({ relation_type: "main" }, [
      {
        id: "contract-2",
        contract_name: "补充协议",
        relation_type: "unknown",
      },
    ]);

    await expect(getContract("contract-1")).rejects.toThrow(
      "第 1 条关联合同包含非法合同关系，已阻止页面继续使用",
    );
  });

  it("详情重新加载失败后隐藏旧详情和全部业务动作", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(source).toMatch(
      /v-if="detail && !errorMessage[^"]*"\s*class="detail-actions"/,
    );
    expect(source).toContain('<template v-else-if="detail && !errorMessage">');
  });
});
