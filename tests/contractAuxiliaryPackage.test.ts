jest.mock("nanoid", () => ({
  nanoid: jest.fn(),
}));
jest.mock("../server/db/index", () => ({
  db: {
    transaction: jest.fn(),
    get: jest.fn(),
    all: jest.fn(),
  },
}));
jest.mock("../server/services/contractOcr", () => ({
  recognizeContractFile: jest.fn(),
}));

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "../server/db/index";
import type { ContractRecognitionResult } from "../server/services/contractOcr";
import {
  appendContractAuxiliaryFiles,
  createContractAuxiliaryPackage,
  deleteContractAuxiliaryPackage,
  getContractAuxiliaryPackage,
  retryContractAuxiliaryPackageRecognition,
  runContractAuxiliaryPackageRecognition,
  updateContractAuxiliaryPackageNote,
  type ContractAuxiliaryStoredFile,
} from "../server/services/contractAuxiliaryPackage";

const actor = { id: "finance-1", role: "admin" };

function storedFile(
  name: string,
  hashCharacter: string,
  mimeType = "application/pdf",
): ContractAuxiliaryStoredFile {
  return {
    fileName: name,
    filePath: `uploads/contracts/${name}`,
    fileSize: 1024,
    mimeType,
    fileHash: hashCharacter.padStart(64, "0").slice(-64),
  };
}

function successfulRecognition(): ContractRecognitionResult {
  return {
    status: "succeeded",
    fields: [
      {
        field: "party_a",
        originalValue: "甲方：国网北京市电力公司",
        normalizedValue: "国网北京市电力公司",
        confidence: 91,
        ocrConfidence: 0.99,
        fieldScore: 91,
        source: "ocr_300",
        pageNumber: 1,
        evidence: [
          {
            text: "甲方：国网北京市电力公司",
            source: "ocr_300",
            pageNumber: 1,
            confidence: 91,
            ocrConfidence: 0.99,
            fieldScore: 91,
          },
        ],
      },
      {
        field: "party_b",
        originalValue: "乙方：北京羽隶工程咨询有限公司",
        normalizedValue: "北京羽隶工程咨询有限公司",
        confidence: 93,
        ocrConfidence: 0.98,
        fieldScore: 93,
        source: "ocr_300",
        pageNumber: 1,
      },
      {
        field: "amount",
        originalValue: "合同金额：￥50,000.00元",
        normalizedValue: "50000.00",
        confidence: 96,
        ocrConfidence: 0.995,
        fieldScore: 96,
        source: "ocr_300",
        pageNumber: 2,
      },
      {
        field: "project_name",
        originalValue: "不应写入辅助包顶层的项目名称",
        normalizedValue: "不应写入辅助包顶层的项目名称",
        confidence: 90,
        ocrConfidence: 0.99,
        fieldScore: 90,
        source: "ocr_300",
      },
    ],
    rawText: "辅助合同原文",
    method: "pdf_ocr",
    warnings: [],
    ocrLines: [
      {
        page: 1,
        text: "甲方：国网北京市电力公司",
        bbox: [
          [10, 20],
          [300, 20],
          [300, 50],
          [10, 50],
        ],
        confidence: 0.99,
        modelVersion: "v6_medium",
      },
    ],
    modelVersion: "v6_medium",
  };
}

function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "package-1",
    parent_contract_id: "contract-1",
    party_a: "国网北京市电力公司",
    party_b: "北京羽隶工程咨询有限公司",
    recognized_amount: 50000,
    note: "特殊情况",
    status: "succeeded",
    raw_text: "辅助合同原文",
    ocr_fields_json: [],
    ocr_lines_json: [],
    warnings_json: [],
    error_message: null,
    model_version: "v6_medium",
    parser_version: "contract-auxiliary-package-v1",
    retry_count: 0,
    version: 2,
    accounting_included: false,
    created_by: "finance-1",
    updated_by: "finance-1",
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:01:00.000Z",
    ...overrides,
  };
}

function fileRow(
  id: string,
  fileKind: "contract" | "invoice" | "receipt",
  fileName: string,
  createdAt = "2026-08-11T00:00:00.000Z",
) {
  return {
    id,
    package_id: "package-1",
    file_kind: fileKind,
    file_name: fileName,
    file_path: `uploads/contracts/${fileName}`,
    file_size: 1024,
    mime_type: fileName.endsWith(".png") ? "image/png" : "application/pdf",
    file_hash: id.padEnd(64, "a").slice(0, 64),
    version: 1,
    is_current: true,
    uploaded_by: "finance-1",
    created_at: createdAt,
  };
}

function installTransaction(client: { query: jest.Mock }) {
  (db.transaction as jest.Mock).mockImplementation(
    async (callback: (transactionClient: typeof client) => unknown) =>
      callback(client),
  );
}

describe("辅助合同档案包领域服务", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let id = 0;
    (nanoid as jest.Mock).mockImplementation(() => `generated-${++id}`);
  });

  it("必须关联现有主合同并把多份合同、发票和回单保存为隔离资料", async () => {
    const packageInsert: { sql?: string; params?: unknown[] } = {};
    const fileInserts: unknown[][] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("requires_auxiliary_materials FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-1",
                status: "effective",
                requires_auxiliary_materials: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO contract_auxiliary_packages")) {
          packageInsert.sql = sql;
          packageInsert.params = params;
        }
        if (sql.includes("INSERT INTO contract_auxiliary_files")) {
          fileInserts.push(params);
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);

    const created = await createContractAuxiliaryPackage({
      parentContractId: "contract-1",
      files: {
        contract: [
          storedFile("辅助合同-1.pdf", "a"),
          storedFile("辅助合同-2.pdf", "b"),
        ],
        invoice: [storedFile("发票-1.pdf", "c"), storedFile("发票-2.pdf", "d")],
        receipt: [
          storedFile("回单-1.png", "e", "image/png"),
          storedFile("回单-2.png", "f", "image/png"),
        ],
      } as never,
      note: "  本合同仅用于特殊事项说明  ",
      actor,
    });

    expect(created).toMatchObject({
      parentContractId: "contract-1",
      status: "succeeded",
      version: 1,
      accountingIncluded: false,
    });
    expect(created.files.map((file) => file.fileKind)).toEqual([
      "contract",
      "contract",
      "invoice",
      "invoice",
      "receipt",
      "receipt",
    ]);
    expect(packageInsert.sql).toContain("accounting_included");
    expect(packageInsert.sql).toMatch(/,FALSE,/);
    expect(packageInsert.params).toEqual(
      expect.arrayContaining(["contract-1", "本合同仅用于特殊事项说明"]),
    );
    expect(fileInserts).toHaveLength(6);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["auxiliary_package_created"]),
    );
  });

  it("已有辅助合同档案后允许只追加发票和回单", async () => {
    const fileInserts: unknown[][] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("requires_auxiliary_materials FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-1",
                status: "effective",
                requires_auxiliary_materials: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("SELECT version, status, note")) {
          return {
            rows: [{ version: 1, status: "succeeded", note: null }],
            rowCount: 1,
          };
        }
        if (sql.includes("SELECT file_hash, file_kind")) {
          return {
            rows: [
              {
                file_hash: "a".padStart(64, "0"),
                file_kind: "contract",
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO contract_auxiliary_files")) {
          fileInserts.push(params);
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);

    const appended = await appendContractAuxiliaryFiles({
      parentContractId: "contract-1",
      packageId: "package-1",
      expectedVersion: 1,
      files: {
        invoice: [storedFile("发票.pdf", "b")],
        receipt: [storedFile("回单.png", "c", "image/png")],
      },
      actor,
    });

    expect(appended).toMatchObject({
      packageId: "package-1",
      version: 2,
      accountingIncluded: false,
    });
    expect(appended.files.map((file) => file.fileKind)).toEqual([
      "invoice",
      "receipt",
    ]);
    expect(fileInserts).toHaveLength(2);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["auxiliary_package_files_appended"]),
    );
  });

  it("每个档案包最多保存二十份文件且第二十一份在事务前被拒绝", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("requires_auxiliary_materials FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-1",
                status: "effective",
                requires_auxiliary_materials: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);

    const eighteenAttachments = Array.from({ length: 18 }, (_, index) =>
      storedFile(`发票-${index + 1}.pdf`, (index + 1).toString(16)),
    );
    const accepted = await createContractAuxiliaryPackage({
      parentContractId: "contract-1",
      files: {
        contract: [
          storedFile("辅助合同-1.pdf", "ff"),
          storedFile("辅助合同-2.pdf", "ee"),
        ],
        invoice: eighteenAttachments,
      } as never,
      actor,
    });
    expect(accepted.files).toHaveLength(20);

    jest.clearAllMocks();
    await expect(
      createContractAuxiliaryPackage({
        parentContractId: "contract-1",
        files: {
          contract: [
            storedFile("辅助合同-1.pdf", "ff"),
            storedFile("辅助合同-2.pdf", "ee"),
          ],
          invoice: [...eighteenAttachments, storedFile("发票-19.pdf", "0")],
        } as never,
        actor,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_AUXILIARY_FILE_COUNT_EXCEEDED",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("同一档案包跨发票和回单出现重复摘要时整体拒绝", async () => {
    await expect(
      createContractAuxiliaryPackage({
        parentContractId: "contract-1",
        files: {
          contract: storedFile("辅助合同.pdf", "a"),
          invoice: [storedFile("发票.pdf", "b")],
          receipt: [storedFile("回单.png", "b", "image/png")],
        },
        actor,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_AUXILIARY_DUPLICATE_FILE",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("至少一份辅助合同必传，发票和回单保持可选", async () => {
    await expect(
      createContractAuxiliaryPackage({
        parentContractId: "contract-1",
        files: {} as never,
        actor,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_AUXILIARY_CONTRACT_FILE_REQUIRED",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("合同未开启辅助材料时拒绝新增档案", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("requires_auxiliary_materials FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-closed",
                status: "effective",
                requires_auxiliary_materials: false,
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    installTransaction(client);

    await expect(
      createContractAuxiliaryPackage({
        parentContractId: "contract-closed",
        files: { contract: storedFile("辅助合同.pdf", "a") },
        actor,
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_AUXILIARY_NOT_REQUIRED" });
  });

  it("客户端不能把辅助资料升级为核算数据", async () => {
    await expect(
      createContractAuxiliaryPackage({
        parentContractId: "contract-1",
        files: { contract: storedFile("辅助合同.pdf", "a") },
        actor,
        accountingIncluded: true,
      } as never),
    ).rejects.toMatchObject({
      code: "CONTRACT_AUXILIARY_ACCOUNTING_SCOPE_IMMUTABLE",
    });

    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/services/contractAuxiliaryPackage.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("INSERT INTO contract_invoices");
    expect(source).not.toContain("INSERT INTO contract_receipts");
    expect(source).not.toContain("INSERT INTO contract_payments");
  });

  it("只从合同正文归档甲方、乙方和金额，并保留模型、原文、字段证据与坐标", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "package-1",
      parent_contract_id: "contract-1",
      status: "processing",
      version: 1,
      file_path: "uploads/contracts/辅助合同.pdf",
      mime_type: "application/pdf",
    });
    let recognitionUpdate: unknown[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("UPDATE contract_auxiliary_packages SET")) {
          recognitionUpdate = params;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);
    const runner = jest.fn(async () => successfulRecognition());

    const result = await runContractAuxiliaryPackageRecognition(
      { parentContractId: "contract-1", packageId: "package-1", actor },
      runner,
    );

    expect(runner).toHaveBeenCalledWith(
      "uploads/contracts/辅助合同.pdf",
      "application/pdf",
    );
    expect(result).toEqual({
      packageId: "package-1",
      status: "succeeded",
      partyA: "国网北京市电力公司",
      partyB: "北京羽隶工程咨询有限公司",
      recognizedAmount: 50000,
      modelVersion: "v6_medium",
      version: 2,
      accountingIncluded: false,
    });
    expect(recognitionUpdate).toEqual(
      expect.arrayContaining([
        "国网北京市电力公司",
        "北京羽隶工程咨询有限公司",
        50000,
        "辅助合同原文",
        "v6_medium",
        "contract-auxiliary-package-v1",
      ]),
    );
    const serializedFields = JSON.parse(String(recognitionUpdate[8]));
    expect(
      serializedFields.map((field: { field: string }) => field.field),
    ).toEqual(["party_a", "party_b", "amount"]);
    expect(serializedFields[0]).toMatchObject({
      ocrConfidence: 0.99,
      fieldScore: 91,
      pageNumber: 1,
    });
    const serializedLines = JSON.parse(String(recognitionUpdate[9]));
    expect(serializedLines[0]).toMatchObject({
      page: 1,
      confidence: 0.99,
      modelVersion: "v6_medium",
    });
  });

  it("识别基础设施异常时冻结三个业务字段并保存失败状态", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "package-1",
      parent_contract_id: "contract-1",
      status: "processing",
      version: 1,
      file_path: "uploads/contracts/辅助合同.pdf",
      mime_type: "application/pdf",
    });
    let recognitionUpdate: unknown[] = [];
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("UPDATE contract_auxiliary_packages SET")) {
          recognitionUpdate = params;
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);

    const result = await runContractAuxiliaryPackageRecognition(
      { parentContractId: "contract-1", packageId: "package-1", actor },
      jest.fn(async () => {
        throw new Error("OCR 服务断开");
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      partyA: null,
      partyB: null,
      recognizedAmount: null,
    });
    expect(recognitionUpdate.slice(3, 7)).toEqual([null, null, null, "failed"]);
    expect(recognitionUpdate).toEqual(
      expect.arrayContaining(["辅助合同识别基础设施暂时不可用"]),
    );
  });

  it("读取时再次校验数据库固定的不计核算标记", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce(
      packageRow({ accounting_included: true }),
    );
    (db.all as jest.Mock).mockResolvedValueOnce([]);

    await expect(
      getContractAuxiliaryPackage("contract-1", "package-1"),
    ).rejects.toMatchObject({
      code: "CONTRACT_AUXILIARY_ACCOUNTING_SCOPE_CORRUPTED",
    });
  });

  it("正常读取返回备注、识别结果和三类归档文件，但不暴露可变核算开关", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce(
      packageRow({
        ocr_fields_json: [
          {
            field: "party_a",
            normalizedValue: "国网北京市电力公司",
            ocrConfidence: 0.99,
            fieldScore: 91,
          },
        ],
        ocr_lines_json: [
          {
            page: 1,
            text: "甲方：国网北京市电力公司",
            bbox: [],
            confidence: 0.99,
            modelVersion: "v6_medium",
          },
        ],
      }),
    );
    (db.all as jest.Mock).mockResolvedValueOnce([
      {
        id: "file-1",
        package_id: "package-1",
        file_kind: "contract",
        file_name: "辅助合同.pdf",
        file_path: "uploads/contracts/辅助合同.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        file_hash: "a".repeat(64),
        version: 1,
        is_current: true,
        uploaded_by: "finance-1",
        created_at: "2026-08-11T00:00:00.000Z",
      },
    ]);

    const result = await getContractAuxiliaryPackage("contract-1", "package-1");

    expect(result).toMatchObject({
      id: "package-1",
      parentContractId: "contract-1",
      note: "特殊情况",
      recognizedAmount: 50000,
      modelVersion: "v6_medium",
      accountingIncluded: false,
    });
    expect(result.ocrFields[0]).toMatchObject({
      field: "party_a",
      fieldScore: 91,
    });
    expect(result.files[0]).toMatchObject({
      fileKind: "contract",
      fileName: "辅助合同.pdf",
    });
    expect(Object.keys(result)).not.toContain("accounting_included");
  });

  it("读取同一档案包时稳定返回全部合同和同类附件", async () => {
    (db.get as jest.Mock).mockResolvedValueOnce(packageRow());
    (db.all as jest.Mock).mockResolvedValueOnce([
      fileRow("file-contract-1", "contract", "辅助合同-1.pdf"),
      fileRow("file-contract-2", "contract", "辅助合同-2.pdf"),
      fileRow("file-invoice-1", "invoice", "发票-1.pdf"),
      fileRow("file-invoice-2", "invoice", "发票-2.pdf"),
      fileRow("file-receipt-1", "receipt", "回单-1.png"),
      fileRow("file-receipt-2", "receipt", "回单-2.png"),
    ]);

    const result = await getContractAuxiliaryPackage("contract-1", "package-1");

    expect(result.files.map((file) => [file.fileKind, file.fileName])).toEqual([
      ["contract", "辅助合同-1.pdf"],
      ["contract", "辅助合同-2.pdf"],
      ["invoice", "发票-1.pdf"],
      ["invoice", "发票-2.pdf"],
      ["receipt", "回单-1.png"],
      ["receipt", "回单-2.png"],
    ]);
    const fileQuery = String((db.all as jest.Mock).mock.calls[0]?.[0]);
    expect(fileQuery).toMatch(
      /ORDER BY CASE file_kind[\s\S]*?created_at ASC,\s*id ASC/u,
    );
  });

  it("备注更新使用版本门禁，识别处理中禁止改写", async () => {
    const processingClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT status, note")) {
          return { rows: [{ status: "processing", note: null }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(processingClient);
    await expect(
      updateContractAuxiliaryPackageNote({
        parentContractId: "contract-1",
        packageId: "package-1",
        note: "识别期间修改",
        expectedVersion: 1,
        actor,
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_AUXILIARY_PROCESSING" });

    const updateClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT status, note")) {
          return {
            rows: [{ status: "succeeded", note: "旧备注" }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(updateClient);
    const updated = await updateContractAuxiliaryPackageNote({
      parentContractId: "contract-1",
      packageId: "package-1",
      note: "  新备注  ",
      expectedVersion: 2,
      actor,
    });
    expect(updated).toEqual({
      packageId: "package-1",
      note: "新备注",
      version: 3,
    });
  });

  it("删除先保留审计和文件路径，再由数据库级联移除隔离记录", async () => {
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("SELECT version")) {
          return { rows: [{ version: 2 }], rowCount: 1 };
        }
        if (sql.includes("SELECT file_path")) {
          return {
            rows: [
              { file_path: "uploads/contracts/辅助合同.pdf" },
              { file_path: "uploads/contracts/发票-1.pdf" },
              { file_path: "uploads/contracts/发票-2.pdf" },
              { file_path: "uploads/contracts/回单-1.png" },
              { file_path: "uploads/contracts/回单-2.png" },
            ],
            rowCount: 5,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    installTransaction(client);

    const result = await deleteContractAuxiliaryPackage({
      parentContractId: "contract-1",
      packageId: "package-1",
      expectedVersion: 2,
      actor,
    });

    expect(result).toEqual({
      packageId: "package-1",
      deleted: true,
      storedFilePaths: [
        "uploads/contracts/辅助合同.pdf",
        "uploads/contracts/发票-1.pdf",
        "uploads/contracts/发票-2.pdf",
        "uploads/contracts/回单-1.png",
        "uploads/contracts/回单-2.png",
      ],
    });
    expect(
      calls.findIndex((sql) => sql.includes("INSERT INTO contract_audit_logs")),
    ).toBeLessThan(
      calls.findIndex((sql) =>
        sql.includes("DELETE FROM contract_auxiliary_packages"),
      ),
    );
  });

  it("重新识别先清空旧结果、增加重试与版本，再写入新证据", async () => {
    const clients = [
      {
        query: jest.fn(async (sql: string) => {
          if (sql.includes("SELECT status")) {
            return { rows: [{ status: "partial" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        }),
      },
      {
        query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      },
    ];
    (db.transaction as jest.Mock)
      .mockImplementationOnce(
        async (callback: (transactionClient: (typeof clients)[0]) => unknown) =>
          callback(clients[0]),
      )
      .mockImplementationOnce(
        async (callback: (transactionClient: (typeof clients)[1]) => unknown) =>
          callback(clients[1]),
      );
    (db.get as jest.Mock).mockResolvedValueOnce({
      id: "package-1",
      parent_contract_id: "contract-1",
      status: "processing",
      version: 4,
      file_path: "uploads/contracts/辅助合同.pdf",
      mime_type: "application/pdf",
    });

    const result = await retryContractAuxiliaryPackageRecognition(
      {
        parentContractId: "contract-1",
        packageId: "package-1",
        expectedVersion: 3,
        actor,
      },
      jest.fn(async () => successfulRecognition()),
    );

    expect(result).toMatchObject({ status: "succeeded", version: 5 });
    const retryUpdate = clients[0].query.mock.calls.find(([sql]) =>
      String(sql).includes("retry_count = retry_count + 1"),
    );
    expect(retryUpdate).toBeDefined();
    expect(String(retryUpdate?.[0])).toContain("ocr_fields_json = '[]'::jsonb");
  });
});
