jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import { api } from "@/utils/api";
import {
  getContract,
  getContractInvoiceApplicationMaterialUrl,
  uploadContractFile,
} from "@/utils/contractApi";

const envelope = (data: unknown) => ({
  data: { success: true, data },
});

describe("合同详情开票申请材料适配", () => {
  beforeEach(() => jest.clearAllMocks());

  it("规范化申请原件和盖章件且不混入普通合同附件", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        contract: {
          id: "contract-1",
          relation_type: "main",
          status: "effective",
        },
        files: [
          {
            id: "contract-file-1",
            file_name: "主合同.pdf",
            file_type: "sealed_contract",
          },
        ],
        invoice_application_material_groups: [
          {
            application_id: "application-1",
            application_no: "KP-202609-0001",
            status: "completed",
            amount: "80000.00",
            applicant_name: "申请人甲",
            submitted_at: "2026-09-15T08:00:00.000Z",
            created_at: "2026-09-15T07:00:00.000Z",
            files: [
              {
                id: "application_material:material-1",
                file_id: "material-1",
                source_type: "application_material",
                material_kind: "system_generated_triplicate",
                file_name: "系统生成三联单.pdf",
                file_size: 1024,
                mime_type: "application/pdf",
                requires_seal: true,
                is_system_generated_triplicate: true,
                created_at: "2026-09-15T07:10:00.000Z",
              },
              {
                id: "contract_file:sealed-material-1",
                file_id: "sealed-material-1",
                source_type: "contract_file",
                material_kind: "sealed_triplicate",
                file_name: "盖章后三联单.pdf",
                file_size: 2048,
                mime_type: "application/pdf",
                requires_seal: true,
                is_system_generated_triplicate: false,
                created_at: "2026-09-15T09:00:00.000Z",
              },
            ],
          },
        ],
        approvals: [],
        invoices: [],
        receipts: [],
        payments: [],
        externalPayments: [],
        relations: [],
      }),
    );

    const detail = await getContract("contract-1");

    expect(detail.files).toEqual([
      expect.objectContaining({
        id: "contract-file-1",
        fileName: "主合同.pdf",
        fileType: "sealed_contract",
      }),
    ]);
    expect(detail.invoiceApplicationMaterialGroups).toEqual([
      expect.objectContaining({
        applicationId: "application-1",
        applicationNo: "KP-202609-0001",
        status: "completed",
        amount: "80000.00",
        applicantName: "申请人甲",
        files: [
          expect.objectContaining({
            fileId: "material-1",
            sourceType: "application_material",
            materialKind: "system_generated_triplicate",
            isSystemGeneratedTriplicate: true,
          }),
          expect.objectContaining({
            fileId: "sealed-material-1",
            sourceType: "contract_file",
            materialKind: "sealed_triplicate",
          }),
        ],
      }),
    ]);
  });

  it("缺少材料分组时稳定归一化为空数组", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(
      envelope({
        contract: {
          id: "contract-1",
          relation_type: "main",
          status: "effective",
        },
        files: [],
        approvals: [],
        invoices: [],
        receipts: [],
        payments: [],
        externalPayments: [],
        relations: [],
      }),
    );

    const detail = await getContract("contract-1");

    expect(detail.invoiceApplicationMaterialGroups).toEqual([]);
  });

  it("生成受控材料地址并在盖章件上传时传递申请编号", async () => {
    expect(getContractInvoiceApplicationMaterialUrl("合同/1", "材料 1")).toBe(
      "/api/contracts/%E5%90%88%E5%90%8C%2F1/invoice-application-materials/%E6%9D%90%E6%96%99%201",
    );
    expect(
      getContractInvoiceApplicationMaterialUrl("合同/1", "材料 1", true),
    ).toBe(
      "/api/contracts/%E5%90%88%E5%90%8C%2F1/invoice-application-materials/%E6%9D%90%E6%96%99%201?download=1",
    );

    (api.post as jest.Mock).mockResolvedValueOnce(
      envelope({ fileId: "sealed-material-1" }),
    );
    const file = new File(["sealed"], "盖章后三联单.pdf", {
      type: "application/pdf",
    });

    await expect(
      uploadContractFile("contract-1", file, "triplicate", "application-1"),
    ).resolves.toEqual({ fileId: "sealed-material-1" });

    const [url, body, options] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/contracts/contract-1/files");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBe(file);
    expect((body as FormData).get("fileType")).toBe("triplicate");
    expect((body as FormData).get("invoiceApplicationId")).toBe(
      "application-1",
    );
    expect(options).toEqual({ timeout: 120_000 });
  });
});
