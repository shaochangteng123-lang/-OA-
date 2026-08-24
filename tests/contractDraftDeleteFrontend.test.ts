jest.mock("@/utils/api", () => ({
  api: {
    delete: jest.fn(),
    get: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import {
  deleteContractDraft,
  getContractSupplementUploadContext,
} from "@/utils/contractApi";

const envelope = (data: unknown) => ({
  data: { success: true, data },
});

describe("合同草稿物理删除前端交互", () => {
  beforeEach(() => jest.clearAllMocks());

  it("明确提示草稿数据永久删除且无法恢复", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(source).toContain(
      "删除后合同草稿、相关识别结果和附件将永久删除且无法恢复。是否确认删除？",
    );
    expect(source).not.toContain("删除后合同草稿将从台账隐藏");
    expect(source).not.toContain("原文件与最小审计记录仍会保留");
  });

  it("删除草稿后重新向服务端读取补充协议序号，不复用旧上下文", async () => {
    (api.delete as jest.Mock).mockResolvedValueOnce(
      envelope({
        id: "supplement-draft-4",
        deleted: true,
        permanent: true,
        deletedFileCount: 2,
        failedFileCount: 0,
      }),
    );
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        parent_contract_id: "jiaohuachang-main",
        root_contract_id: "jiaohuachang-main",
        area: "朝阳区",
        declared_category: "main_business",
        declared_subtype: "technical_consulting",
        project_name: "焦化厂110千伏输变电工程前期手续技术咨询服务",
        party_a: "甲方公司",
        party_b: "乙方公司",
        parent_contract_name: "焦化厂110千伏输变电工程前期手续技术咨询服务",
        supplement_sequence: 1,
        generated_contract_name:
          "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）",
        original_contract_amount: "627000.00",
        current_effective_amount: "627000.00",
        can_upload: true,
        blocking_reason: null,
      }),
    );

    const deleted = await deleteContractDraft("supplement-draft-4", 3);
    const context =
      await getContractSupplementUploadContext("jiaohuachang-main");

    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/supplement-draft-4",
      { data: { confirmed: true, expectedVersion: 3 } },
    );
    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/jiaohuachang-main/supplement-upload-context",
    );
    expect(deleted).toEqual({
      id: "supplement-draft-4",
      deleted: true,
      permanent: true,
      deletedFileCount: 2,
      failedFileCount: 0,
    });
    expect(context).toMatchObject({
      supplementSequence: 1,
      generatedContractName:
        "焦化厂110千伏输变电工程前期手续技术咨询服务补充协议（1）",
    });
  });

  it("页面会提示物理附件清理异常但仍明确数据库草稿已永久删除", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(source).toContain("result.failedFileCount > 0");
    expect(source).toContain("合同草稿已永久删除");
    expect(source).toContain("附件文件清理异常，系统已记录告警");
    expect(source).toContain("合同草稿及相关数据已永久删除");
  });
});
