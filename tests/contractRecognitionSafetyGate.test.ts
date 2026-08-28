const mockDbGet = jest.fn();
const mockDbRun = jest.fn();
const mockDbTransaction = jest.fn();

jest.mock("nanoid", () => ({ nanoid: () => "safety-gate-id" }));
jest.mock("../server/db/index", () => ({
  db: {
    get: mockDbGet,
    run: mockDbRun,
    transaction: mockDbTransaction,
  },
}));

import {
  contractOcrFinalValueForResponse,
  runRecognitionJob,
} from "../server/routes/contracts";
import {
  CONTRACT_OCR_PARSER_VERSION,
  parseContractText,
} from "../server/services/contractOcr";

describe("合同识别候选安全门禁落库闭环", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("后页唯一高分项目被阻断后只保存诊断值并清空草稿自动值", async () => {
    const text = [
      "技术服务合同",
      "甲方：北京甲方建设有限公司",
      "乙方：北京乙方咨询有限公司",
      "项目名称：年度技术服务项目",
      "合同金额：133000元",
      "签订日期：2026年8月10日",
    ].join("\n");
    const recognition = parseContractText(text, {
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 8,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
        },
      ],
      relationType: "main",
      expectedCategory: "main_business",
    });
    const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queryCalls.push({ sql, params });
        if (sql.includes("FROM contracts") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                id: "contract-1",
                relation_type: "main",
                parent_contract_id: null,
                declared_category: "main_business",
                declared_subtype: "engineering_consulting",
                asset_category: null,
                area: "国网海淀",
                project_id: "project-1",
                status: "draft",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM contract_ocr_jobs j")) {
          return {
            rows: [
              {
                status: "processing",
                worker_token: "safety-gate-id",
                file_type: "draft_contract",
                is_current: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    mockDbGet.mockResolvedValue({
      id: "job-1",
      contract_id: "contract-1",
      file_id: "file-1",
      file_path: "uploads/contracts/safety-gate.pdf",
      mime_type: "application/pdf",
      declared_category: "main_business",
      relation_type: "main",
    });
    mockDbRun.mockResolvedValue({ changes: 1 });
    mockDbTransaction.mockImplementation(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );

    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
    try {
      await runRecognitionJob("job-1", async () => recognition);
    } finally {
      setIntervalSpy.mockRestore();
    }

    const jobUpdate = queryCalls.find((call) =>
      call.sql.includes("UPDATE contract_ocr_jobs SET status = $2"),
    );
    const fieldInserts = queryCalls.filter((call) =>
      call.sql.includes("INSERT INTO contract_ocr_fields"),
    );
    expect(jobUpdate?.params[1]).toBe("partial");
    expect(jobUpdate?.params[9]).toBe(CONTRACT_OCR_PARSER_VERSION);
    expect(jobUpdate?.params[8]).toContain(
      "项目名称候选来源不满足自动采用条件",
    );
    expect(JSON.parse(String(jobUpdate?.params[4]))).not.toContain(
      "自动采用结果：highest-qualified-candidate-v3：通过",
    );
    expect(fieldInserts).toHaveLength(6);
    expect(
      fieldInserts.find((call) => call.params[3] === "project_name")?.params[5],
    ).toBe("年度技术服务项目");
    expect(
      queryCalls.some((call) =>
        call.sql.includes(
          "UPDATE contract_ocr_fields SET\n               final_value",
        ),
      ),
    ).toBe(false);
    expect(
      queryCalls.some((call) => call.sql.includes("party_a = NULLIF")),
    ).toBe(false);
    expect(
      queryCalls.some(
        (call) =>
          call.sql.includes("UPDATE contracts SET") &&
          call.sql.includes("party_a = CASE") &&
          call.sql.includes(
            "WHEN relation_type IN ('supplement', 'termination') THEN party_a",
          ) &&
          call.sql.includes("ELSE NULL") &&
          call.sql.includes(
            "amount_delta = CASE WHEN relation_type = 'termination'",
          ),
      ),
    ).toBe(true);
  });

  it("补充协议识别未整体通过时仍保存并返回主合同派生的项目名称", async () => {
    const rootName = "焦化厂110千伏输变电工程前期手续技术咨询服务";
    const inheritedName = `${rootName}补充协议（3）`;
    const text = [
      "补充协议书",
      "项目名称：其他设备采购项目",
      "甲方：国网北京市电力公司",
      "乙方：北京羽隶工程咨询有限公司",
      "本补充协议仅变更付款方式。",
      "付款金额：人民币3000元。",
    ].join("\n");
    const recognition = parseContractText("", {
      relationType: "supplement",
      expectedCategory: "main_business",
      sources: [
        {
          text,
          source: "ocr_300",
          pageNumber: 1,
          confidence: 0.98,
          recognitionEngine: "paddleocr",
        },
        {
          text,
          source: "ocr_480",
          pageNumber: 1,
          confidence: 0.97,
          recognitionEngine: "paddleocr",
        },
      ],
    });
    const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queryCalls.push({ sql, params });
        if (
          sql.includes("SELECT contract.id, contract.relation_type") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "supplement-contract-3",
                relation_type: "supplement",
                parent_contract_id: "root-contract",
                declared_category: "main_business",
                declared_subtype: "engineering_consulting",
                asset_category: null,
                area: "海淀区",
                project_id: null,
                supplement_sequence: 3,
                status: "draft",
                contract_no: "HT-SUPPLEMENT-3",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM contract_ocr_jobs j")) {
          return {
            rows: [
              {
                status: "processing",
                worker_token: "safety-gate-id",
                file_type: "draft_contract",
                is_current: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (
          sql.includes("SELECT * FROM contracts") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "root-contract",
                status: "effective",
                relation_type: "main",
                root_contract_id: "root-contract",
                parent_contract_id: null,
                area: "海淀区",
                declared_category: "main_business",
                declared_subtype: "engineering_consulting",
                category: "main_business",
                asset_category: null,
                project_id: null,
                project_name: rootName,
                title: rootName,
                party_a: "国网北京市电力公司",
                party_b: "北京羽隶工程咨询有限公司",
                business_contract_no: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    mockDbGet.mockResolvedValue({
      id: "job-partial-supplement",
      contract_id: "supplement-contract-3",
      file_id: "file-supplement-3",
      file_path: "uploads/contracts/supplement-3.pdf",
      mime_type: "application/pdf",
      declared_category: "main_business",
      relation_type: "supplement",
    });
    mockDbRun.mockResolvedValue({ changes: 1 });
    mockDbTransaction.mockImplementation(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );

    const setIntervalSpy = jest
      .spyOn(global, "setInterval")
      .mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
    try {
      await runRecognitionJob(
        "job-partial-supplement",
        async () => recognition,
      );
    } finally {
      setIntervalSpy.mockRestore();
    }

    const jobUpdate = queryCalls.find((call) =>
      call.sql.includes("UPDATE contract_ocr_jobs SET status = $2"),
    );
    const inheritedFieldUpdate = queryCalls.find(
      (call) =>
        call.sql.includes("UPDATE contract_ocr_fields SET") &&
        call.sql.includes("'system_inherited'"),
    );
    const candidateInsert = queryCalls.find(
      (call) =>
        call.sql.includes("INSERT INTO contract_ocr_fields") &&
        call.params[3] === "project_name",
    );

    expect(jobUpdate?.params[1]).toBe("partial");
    expect(jobUpdate?.params[8]).toContain(
      "补充协议正文项目名称与所选主合同不一致",
    );
    expect(candidateInsert?.params[5]).toBe("其他设备采购项目");
    expect(inheritedFieldUpdate?.params[1]).toBe(inheritedName);
    expect(inheritedFieldUpdate?.sql).toContain("source = 'system_inherited'");
    expect(inheritedFieldUpdate?.sql).toContain("confidence = 100");
    expect(
      contractOcrFinalValueForResponse(
        "project_name",
        null,
        "supplement",
        inheritedName,
      ),
    ).toBe(inheritedName);
    expect(
      contractOcrFinalValueForResponse(
        "project_name",
        "旧识别候选",
        "supplement",
        inheritedName,
      ),
    ).toBe(inheritedName);
    expect(
      contractOcrFinalValueForResponse(
        "project_name",
        "主合同识别值",
        "main",
        inheritedName,
      ),
    ).toBe("主合同识别值");
  });

  it.each(["首次识别", "重新识别"])(
    "%s自动落库后补充协议标题和项目名称保持完整全角序号",
    async (recognitionRound) => {
      const rootName =
        "新材料110千伏输变电工程工程规划许可证、施工许可证技术服务";
      const inheritedName = `${rootName}补充协议（2）`;
      const text = [
        "补充协议书",
        `项目名称：${rootName}`,
        "甲方：国网北京市电力公司",
        "乙方：北京羽隶工程咨询有限公司",
        "本补充协议仅变更付款方式。",
        "付款金额：人民币3000元。",
        "本补充协议一式肆份，甲乙双方各执贰份。",
      ].join("\n");
      const recognition = parseContractText("", {
        relationType: "supplement",
        expectedCategory: "main_business",
        sources: [
          {
            text,
            source: "ocr_300",
            pageNumber: 1,
            confidence: 0.98,
            recognitionEngine: "paddleocr",
          },
          {
            text,
            source: "ocr_480",
            pageNumber: 1,
            confidence: 0.97,
            recognitionEngine: "paddleocr",
          },
        ],
      });
      recognition.rawText = text;
      const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
      const client = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          queryCalls.push({ sql, params });
          if (
            sql.includes("SELECT contract.id, contract.relation_type") &&
            sql.includes("FOR UPDATE")
          ) {
            return {
              rows: [
                {
                  id: "supplement-contract-2",
                  relation_type: "supplement",
                  parent_contract_id: "root-contract",
                  declared_category: "main_business",
                  declared_subtype: "engineering_consulting",
                  asset_category: null,
                  area: "海淀区",
                  project_id: null,
                  supplement_sequence: 2,
                  status: "draft",
                  contract_no: "HT-SUPPLEMENT-2",
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes("FROM contract_ocr_jobs j")) {
            return {
              rows: [
                {
                  status: "processing",
                  worker_token: "safety-gate-id",
                  file_type: "draft_contract",
                  is_current: true,
                },
              ],
              rowCount: 1,
            };
          }
          if (
            sql.includes("SELECT * FROM contracts") &&
            sql.includes("FOR UPDATE")
          ) {
            return {
              rows: [
                {
                  id: "root-contract",
                  status: "effective",
                  relation_type: "main",
                  root_contract_id: "root-contract",
                  parent_contract_id: null,
                  area: "海淀区",
                  declared_category: "main_business",
                  declared_subtype: "engineering_consulting",
                  category: "main_business",
                  asset_category: null,
                  project_id: null,
                  project_name: rootName,
                  title: rootName,
                  party_a: "国网北京市电力公司",
                  party_b: "北京羽隶工程咨询有限公司",
                  business_contract_no: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes("AS current_amount")) {
            return { rows: [{ current_amount: 230000 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
      };
      const jobId =
        recognitionRound === "首次识别" ? "job-initial" : "job-retry";
      mockDbGet.mockResolvedValue({
        id: jobId,
        contract_id: "supplement-contract-2",
        file_id: "file-supplement-2",
        file_path: "uploads/contracts/supplement-2.pdf",
        mime_type: "application/pdf",
        declared_category: "main_business",
        relation_type: "supplement",
      });
      mockDbRun.mockResolvedValue({ changes: 1 });
      mockDbTransaction.mockImplementation(
        async (callback: (value: typeof client) => Promise<unknown>) =>
          callback(client),
      );

      const setIntervalSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
      try {
        await runRecognitionJob(jobId, async () => recognition);
      } finally {
        setIntervalSpy.mockRestore();
      }

      const jobUpdate = queryCalls.find((call) =>
        call.sql.includes("UPDATE contract_ocr_jobs SET status = $2"),
      );
      const projectFieldUpdate = queryCalls.find(
        (call) =>
          call.sql.includes("UPDATE contract_ocr_fields SET") &&
          call.params[1] === "project_name",
      );
      const contractUpdate = queryCalls.find(
        (call) =>
          call.sql.includes("UPDATE contracts SET") &&
          call.sql.includes("title = CASE"),
      );

      expect(jobUpdate?.params[8]).toBeNull();
      expect(jobUpdate?.params[1]).toBe("succeeded");
      expect(projectFieldUpdate?.params[2]).toBe(inheritedName);
      expect(contractUpdate?.params[3]).toBe(inheritedName);
      expect(contractUpdate?.params[16]).toBe(inheritedName);
      expect(contractUpdate?.params[3]).not.toContain("(2)");
    },
  );
});
