/** @jest-environment node */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import { degrees, PDFDocument } from "pdf-lib";
import {
  cleanupApprovedContractSealApplicationArtifact,
  cleanupContractSealApplicationArtifact,
  ContractSealApplicationError,
  generateApprovedContractSealApplication,
  generateSignedContractSealApplication,
  extractContractSealCopyCount,
  normalizeContractSealApplicationFields,
  type ContractSealApplicationApprovalArtifact,
  type ContractSealApplicationApprovalInput,
  type ContractSealApplicationArtifact,
  type ContractSealApplicationInput,
} from "../server/services/contractSealApplication";

function signaturePng(): Buffer {
  const canvas = createCanvas(320, 120);
  const context = canvas.getContext("2d");
  context.strokeStyle = "#111";
  context.lineWidth = 5;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(20, 75);
  context.bezierCurveTo(80, 15, 150, 110, 220, 40);
  context.bezierCurveTo(250, 20, 275, 85, 305, 45);
  context.stroke();
  return canvas.toBuffer("image/png");
}

function applicationInput(contractId: string): ContractSealApplicationInput {
  return {
    contractId,
    contractVersion: 7,
    formVersion: 2,
    actorId: "admin-1",
    signedAt: new Date("2026-08-11T02:30:00.000Z"),
    contract: {
      contractNo: "HT-20260811-000001",
      contractTitle: "柳芳110千伏输变电工程前期手续技术咨询服务合同",
      partyA: "国网北京市电力公司",
      partyB: "北京羽隶工程咨询有限公司",
      projectName: "柳芳110千伏输变电工程前期手续技术咨询服务",
      amount: "¥152,000.00",
      categoryLabel: "主营项目合同",
      relationLabel: "主合同",
      area: "朝阳区",
    },
    fields: {
      sealPurpose: "办理合同正式签署及归档",
      sealType: "contract",
      copyCount: 4,
      crossPageSeal: true,
      note: "甲乙双方各留存两份。",
    },
  };
}

function signerClient(
  signaturePath: string,
  actor: {
    id: string;
    name: string;
    role: string;
    department: string;
    position: string;
  },
) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("FROM users u")) {
        return { rows: [actor] };
      }
      if (sql.includes("FROM user_signatures")) {
        return { rows: [{ signature_path: signaturePath }] };
      }
      return { rows: [] };
    }),
  };
}

function approvalInput(
  signedArtifact: ContractSealApplicationArtifact,
): ContractSealApplicationApprovalInput {
  return {
    contractId: signedArtifact.contractId,
    applicationId: "seal-application-1",
    formVersion: signedArtifact.formVersion,
    approvalRoundId: "approval-round-1",
    actorId: "general-manager-1",
    contractNo: signedArtifact.contract.contractNo,
    originalFile: {
      filePath: signedArtifact.file.filePath,
      fileHash: signedArtifact.file.fileHash,
      fileName: signedArtifact.file.fileName,
    },
    applicant: {
      name: signedArtifact.signer.name,
      role: signedArtifact.signer.role,
      signaturePath: signedArtifact.signer.signaturePath,
      signedAt: signedArtifact.signer.signedAt,
    },
    approvedAt: new Date("2026-08-11T04:45:00.000Z"),
  };
}

describe("合同用印申请单", () => {
  const testRoot = path.resolve(
    process.cwd(),
    "uploads",
    `contract-seal-application-test-${process.pid}`,
  );
  const signaturePath = path.join(testRoot, "personal-signature.png");
  const storedSignaturePath = path
    .relative(process.cwd(), signaturePath)
    .replace(/\\/g, "/");
  let artifact: ContractSealApplicationArtifact | null = null;
  let approvalArtifact: ContractSealApplicationApprovalArtifact | null = null;

  beforeAll(() => {
    fs.mkdirSync(testRoot, { recursive: true });
    fs.writeFileSync(signaturePath, signaturePng());
  });

  afterEach(() => {
    cleanupApprovedContractSealApplicationArtifact(approvalArtifact);
    approvalArtifact = null;
    cleanupContractSealApplicationArtifact(artifact);
    artifact = null;
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("校验用印事由、印章类型和份数", () => {
    expect(() =>
      normalizeContractSealApplicationFields({
        sealPurpose: " ",
        sealType: "company",
        copyCount: 1,
        crossPageSeal: false,
        note: "",
      }),
    ).toThrow("用印事由不能为空");
    expect(() =>
      normalizeContractSealApplicationFields({
        sealPurpose: "合同签署",
        sealType: "company",
        copyCount: 0,
        crossPageSeal: false,
        note: "",
      }),
    ).toThrow("用印份数必须是 1 至 20 的整数");
  });

  it("从合同正文的一式几份表述自动识别用印份数", () => {
    expect(
      extractContractSealCopyCount("本协议一式两份，甲乙双方各执一份"),
    ).toBe(2);
    expect(extractContractSealCopyCount("本合同一式肆份，双方各执贰份")).toBe(
      4,
    );
    expect(extractContractSealCopyCount("本合约一式10份")).toBe(10);
    expect(
      extractContractSealCopyCount(
        "14.2 本合同一式捌份，甲方执肆份，乙方执肆份，具有同等法律效力。",
      ),
    ).toBe(8);
    expect(extractContractSealCopyCount("本合同一式_捌_份")).toBe(8);
    expect(
      extractContractSealCopyCount("本协议一式两份，另文写一式三份"),
    ).toBeNull();
    expect(
      extractContractSealCopyCount("本合同一式捌份，附件另写一式叁拾份"),
    ).toBeNull();
    expect(
      extractContractSealCopyCount("本合同一式贰份，甲方执肆份，乙方执肆份"),
    ).toBeNull();
    expect(extractContractSealCopyCount("甲方执肆份，乙方执肆份")).toBeNull();
    expect(extractContractSealCopyCount("正文未约定份数")).toBeNull();
  });

  it("路由只允许当前账号通过在线签名生成用印申请单", () => {
    const applicationRoute = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contractSealApplications.ts"),
      "utf8",
    );
    const contractRoute = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(applicationRoute).toContain("actorId: currentActor.id");
    expect(applicationRoute).toContain(
      "contract.created_by !== currentActor.id",
    );
    expect(applicationRoute).toContain(
      '"SEAL_APPLICATION_CREATOR_SIGNATURE_REQUIRED"',
    );
    expect(applicationRoute).toContain("generateSignedContractSealApplication");
    expect(applicationRoute).toContain("extractContractSealCopyCount");
    expect(applicationRoute).toContain("SELECT job.raw_text");
    expect(applicationRoute).toContain("file.file_type = 'draft_contract'");
    expect(applicationRoute).toContain("file.is_current = TRUE");
    expect(applicationRoute).toContain(
      "CONTRACT_SEAL_COPY_COUNT_NOT_RECOGNIZED",
    );
    expect(applicationRoute).toContain("copyCountRecognition");
    expect(applicationRoute).toContain('status: "unrecognized"');
    expect(applicationRoute).not.toContain("copyCount: 2");
    expect(applicationRoute).not.toContain(
      "recognizedCopyCount || storedFields.copyCount",
    );
    expect(applicationRoute).toContain("lockedRecognizedCopyCount");
    expect(applicationRoute).toMatch(
      /normalizeContractSealApplicationFields\(\{[\s\S]*?copyCount,[\s\S]*?\}\)/,
    );
    expect(applicationRoute).toContain("signature_snapshot_path");
    expect(applicationRoute).not.toContain("signatureDataUrl");
    expect(contractRoute).toContain(
      "用印申请单必须在线填写并使用本人电子签名生成",
    );
    expect(contractRoute).toContain(
      '"SEAL_APPLICATION_ONLINE_SIGNATURE_REQUIRED"',
    );
    expect(contractRoute).toContain("pageCompletenessBlocker");
    expect(contractRoute).toContain("sealCopyCountBlocker");
  });

  it("总经理审批双签元数据受数据库约束且公开接口不泄露签名路径", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const approvalSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    const applicationRoute = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contractSealApplications.ts"),
      "utf8",
    );

    expect(databaseSource).toContain("approval_round_id TEXT");
    expect(databaseSource).toContain("approved_file_id TEXT");
    expect(databaseSource).toContain(
      "contract_seal_applications_approval_signature_check",
    );
    expect(databaseSource).toContain(
      "idx_contract_seal_applications_approval_round",
    );
    expect(approvalSource).toContain(
      'round.target_source === "general_manager"',
    );
    expect(approvalSource).toContain("generateApprovedContractSealApplication");
    expect(applicationRoute).toContain("fullySigned");
    const publicMapper = applicationRoute.slice(
      applicationRoute.indexOf("function toApplicationApi"),
      applicationRoute.indexOf("async function lockContract"),
    );
    expect(publicMapper).not.toContain("signature_snapshot_path");
    expect(publicMapper).not.toContain("approver_signature_snapshot_hash");
  });

  it("没有当前账号的个人签名时拒绝生成", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM users u")) {
          return {
            rows: [
              {
                id: "admin-1",
                name: "测试管理员",
                role: "admin",
                department: "财务部",
                position: "财务主管",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await expect(
      generateSignedContractSealApplication(
        client,
        applicationInput("missing-signature"),
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 409,
      code: "PERSONAL_SIGNATURE_REQUIRED",
    });
  });

  it("只读取服务端签名档案并生成不可变签名快照和 PDF 文件元数据", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM users u")) {
          return {
            rows: [
              {
                id: "admin-1",
                name: "测试管理员",
                role: "admin",
                department: "财务部",
                position: "财务主管",
              },
            ],
          };
        }
        if (sql.includes("FROM user_signatures")) {
          return { rows: [{ signature_path: storedSignaturePath }] };
        }
        return { rows: [] };
      }),
    };
    const input = {
      ...applicationInput("signed-contract"),
      // 模拟恶意客户端夹带签名图片；服务入参和输出均不读取该字段。
      signatureDataUrl: "data:image/png;base64,ZmFrZQ==",
    } as ContractSealApplicationInput & { signatureDataUrl: string };

    artifact = await generateSignedContractSealApplication(client, input);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM user_signatures"),
      ["admin-1"],
    );
    expect(artifact.signer).toMatchObject({
      id: "admin-1",
      name: "测试管理员",
      role: "admin",
      department: "财务部",
      signatureType: "personal",
      signedAt: "2026-08-11T02:30:00.000Z",
    });
    expect(artifact.signer.signaturePath).not.toBe(storedSignaturePath);
    expect(fs.existsSync(artifact.signer.signatureAbsolutePath)).toBe(true);
    expect(fs.existsSync(artifact.file.absolutePath)).toBe(true);
    expect(artifact.file).toMatchObject({
      fileName: "HT-20260811-000001-用印申请单.pdf",
      mimeType: "application/pdf",
    });
    expect(artifact.file.fileHash).toBe(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(artifact.file.absolutePath))
        .digest("hex"),
    );
    expect(artifact).not.toHaveProperty("signatureDataUrl");
    expect(artifact.fields.sealPurpose).toBe("办理合同正式签署及归档");

    const document = await PDFDocument.load(
      fs.readFileSync(artifact.file.absolutePath),
    );
    expect(document.getPageCount()).toBe(1);
    expect(document.getSubject()).toBe(
      "yulilog-contract-seal-application-single-page-v1",
    );

    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractSealApplication.ts"),
      "utf8",
    );
    const signerDisplaySource = serviceSource.slice(
      serviceSource.indexOf("function signerDisplayName"),
      serviceSource.indexOf("async function renderApplicationPdf"),
    );
    expect(signerDisplaySource).toContain("actor.name");
    expect(signerDisplaySource).toContain("actor.position");
    expect(signerDisplaySource).not.toContain("actor.department");
    expect(serviceSource).toContain("signerDisplayName(actor)");
    expect(serviceSource).toContain("signerDisplayName(input.approver)");
  });

  it("核验预留区后在同一页写入总经理签名且不覆盖原文件", async () => {
    const applicantClient = signerClient(storedSignaturePath, {
      id: "admin-1",
      name: "测试管理员",
      role: "admin",
      department: "财务部",
      position: "财务主管",
    });
    artifact = await generateSignedContractSealApplication(
      applicantClient,
      applicationInput("approved-contract"),
    );
    const originalBuffer = fs.readFileSync(artifact.file.absolutePath);
    const managerClient = signerClient(storedSignaturePath, {
      id: "general-manager-1",
      name: "测试总经理",
      role: "general_manager",
      department: "管理层",
      position: "总经理",
    });

    approvalArtifact = await generateApprovedContractSealApplication(
      managerClient,
      approvalInput(artifact),
    );

    expect(managerClient.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM user_signatures"),
      ["general-manager-1"],
    );
    expect(approvalArtifact).toMatchObject({
      contractId: "approved-contract",
      applicationId: "seal-application-1",
      formVersion: 2,
      approvalRoundId: "approval-round-1",
      originalFileHash: artifact.file.fileHash,
      approver: {
        id: "general-manager-1",
        name: "测试总经理",
        role: "general_manager",
        signedAt: "2026-08-11T04:45:00.000Z",
      },
      file: {
        fileName: "HT-20260811-000001-用印申请单-审批签署.pdf",
        mimeType: "application/pdf",
      },
    });
    expect(approvalArtifact.file.absolutePath).not.toBe(
      artifact.file.absolutePath,
    );
    expect(
      fs.readFileSync(artifact.file.absolutePath).equals(originalBuffer),
    ).toBe(true);
    expect(fs.existsSync(approvalArtifact.approver.signatureAbsolutePath)).toBe(
      true,
    );
    expect(approvalArtifact.approver.signaturePath).not.toBe(
      artifact.signer.signaturePath,
    );
    expect(approvalArtifact.approver.signatureHash).toBe(
      crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(approvalArtifact.approver.signatureAbsolutePath),
        )
        .digest("hex"),
    );
    expect(approvalArtifact.file.fileHash).toBe(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(approvalArtifact.file.absolutePath))
        .digest("hex"),
    );

    const originalDocument = await PDFDocument.load(originalBuffer);
    const approvedDocument = await PDFDocument.load(
      fs.readFileSync(approvalArtifact.file.absolutePath),
    );
    expect(originalDocument.getPageCount()).toBe(1);
    expect(approvedDocument.getPageCount()).toBe(1);
    expect(
      fs
        .readFileSync(approvalArtifact.file.absolutePath)
        .equals(originalBuffer),
    ).toBe(false);

    const approvedFilePath = approvalArtifact.file.absolutePath;
    const managerSnapshotPath = approvalArtifact.approver.signatureAbsolutePath;
    cleanupApprovedContractSealApplicationArtifact(approvalArtifact);
    approvalArtifact = null;
    expect(fs.existsSync(approvedFilePath)).toBe(false);
    expect(fs.existsSync(managerSnapshotPath)).toBe(false);
    expect(fs.existsSync(artifact.file.absolutePath)).toBe(true);
  });

  it("旧版单页申请单没有总经理预留区标记时安全拒绝补签", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("legacy-template-contract"),
    );
    const legacyDocument = await PDFDocument.load(
      fs.readFileSync(artifact.file.absolutePath),
    );
    legacyDocument.setSubject("旧版用印申请单");
    legacyDocument.setKeywords([]);
    const legacyPath = path.join(testRoot, "legacy-single-page.pdf");
    const legacyBuffer = Buffer.from(await legacyDocument.save());
    fs.writeFileSync(legacyPath, legacyBuffer);

    const input = approvalInput(artifact);
    input.originalFile = {
      filePath: path.relative(process.cwd(), legacyPath).replace(/\\/g, "/"),
      fileHash: crypto.createHash("sha256").update(legacyBuffer).digest("hex"),
      fileName: "legacy-single-page.pdf",
    };

    await expect(
      generateApprovedContractSealApplication(
        signerClient(storedSignaturePath, {
          id: "general-manager-1",
          name: "测试总经理",
          role: "general_manager",
          department: "管理层",
          position: "总经理",
        }),
        input,
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 409,
      code: "CONTRACT_SEAL_APPROVER_SLOT_MISSING",
    });
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it("单页模板尺寸异常或发生旋转时安全拒绝补签", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("invalid-page-layout-contract"),
    );
    const managerClient = signerClient(storedSignaturePath, {
      id: "general-manager-1",
      name: "测试总经理",
      role: "general_manager",
      department: "管理层",
      position: "总经理",
    });

    const invalidLayouts = [
      {
        fileName: "invalid-size.pdf",
        mutate: (document: PDFDocument) =>
          document.getPage(0).setSize(610, 841.9),
      },
      {
        fileName: "invalid-rotation.pdf",
        mutate: (document: PDFDocument) =>
          document.getPage(0).setRotation(degrees(90)),
      },
    ];

    for (const layout of invalidLayouts) {
      const document = await PDFDocument.load(
        fs.readFileSync(artifact.file.absolutePath),
      );
      layout.mutate(document);
      const layoutPath = path.join(testRoot, layout.fileName);
      const layoutBuffer = Buffer.from(await document.save());
      fs.writeFileSync(layoutPath, layoutBuffer);
      const input = approvalInput(artifact);
      input.originalFile = {
        filePath: path.relative(process.cwd(), layoutPath).replace(/\\/g, "/"),
        fileHash: crypto
          .createHash("sha256")
          .update(layoutBuffer)
          .digest("hex"),
        fileName: layout.fileName,
      };

      await expect(
        generateApprovedContractSealApplication(managerClient, input),
      ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
        statusCode: 409,
        code: "CONTRACT_SEAL_ORIGINAL_PAGE_LAYOUT_INVALID",
      });
      expect(fs.existsSync(layoutPath)).toBe(true);
    }
  });

  it("原申请单摘要不匹配时拒绝审批签署", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("hash-mismatch-contract"),
    );
    const input = approvalInput(artifact);
    input.originalFile.fileHash = "0".repeat(64);

    await expect(
      generateApprovedContractSealApplication(
        signerClient(storedSignaturePath, {
          id: "general-manager-1",
          name: "测试总经理",
          role: "general_manager",
          department: "管理层",
          position: "总经理",
        }),
        input,
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 409,
      code: "CONTRACT_SEAL_ORIGINAL_HASH_MISMATCH",
    });
    expect(fs.existsSync(artifact.file.absolutePath)).toBe(true);
  });

  it("原申请单和申请人签名必须来自受控且存在的上传路径", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("controlled-path-contract"),
    );
    const managerClient = signerClient(storedSignaturePath, {
      id: "general-manager-1",
      name: "测试总经理",
      role: "general_manager",
      department: "管理层",
      position: "总经理",
    });
    const invalidOriginal = approvalInput(artifact);
    invalidOriginal.originalFile.filePath =
      "uploads/../private/application.pdf";
    await expect(
      generateApprovedContractSealApplication(managerClient, invalidOriginal),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      code: "CONTRACT_SEAL_ORIGINAL_FILE_INVALID",
    });

    const missingApplicantSignature = approvalInput(artifact);
    missingApplicantSignature.applicant.signaturePath =
      "uploads/missing/applicant-signature.png";
    await expect(
      generateApprovedContractSealApplication(
        managerClient,
        missingApplicantSignature,
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      code: "CONTRACT_SEAL_APPLICANT_SIGNATURE_MISSING",
    });
  });

  it("审批人不是总经理或未锁定个人签名时拒绝审批签署", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("manager-required-contract"),
    );
    const input = approvalInput(artifact);

    await expect(
      generateApprovedContractSealApplication(
        signerClient(storedSignaturePath, {
          id: "general-manager-1",
          name: "非总经理审批人",
          role: "finance",
          department: "财务部",
          position: "财务主管",
        }),
        input,
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 403,
      code: "CONTRACT_SEAL_GENERAL_MANAGER_SIGNATURE_REQUIRED",
    });

    const noSignatureClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM users u")) {
          return {
            rows: [
              {
                id: "general-manager-1",
                name: "测试总经理",
                role: "general_manager",
                department: "管理层",
                position: "总经理",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    await expect(
      generateApprovedContractSealApplication(noSignatureClient, input),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 409,
      code: "PERSONAL_SIGNATURE_REQUIRED",
    });
  });

  it("审批签署失败时清理本次总经理签名快照并保留原文件", async () => {
    artifact = await generateSignedContractSealApplication(
      signerClient(storedSignaturePath, {
        id: "admin-1",
        name: "测试管理员",
        role: "admin",
        department: "财务部",
        position: "财务主管",
      }),
      applicationInput("invalid-pdf-contract"),
    );
    const invalidPdfPath = path.join(testRoot, "invalid-original.pdf");
    const invalidPdfBuffer = Buffer.from("这不是 PDF 文件", "utf8");
    fs.writeFileSync(invalidPdfPath, invalidPdfBuffer);
    const input = approvalInput(artifact);
    input.originalFile = {
      filePath: path
        .relative(process.cwd(), invalidPdfPath)
        .replace(/\\/g, "/"),
      fileHash: crypto
        .createHash("sha256")
        .update(invalidPdfBuffer)
        .digest("hex"),
      fileName: "invalid-original.pdf",
    };

    await expect(
      generateApprovedContractSealApplication(
        signerClient(storedSignaturePath, {
          id: "general-manager-1",
          name: "测试总经理",
          role: "general_manager",
          department: "管理层",
          position: "总经理",
        }),
        input,
      ),
    ).rejects.toMatchObject<Partial<ContractSealApplicationError>>({
      statusCode: 409,
      code: "CONTRACT_SEAL_ORIGINAL_PDF_INVALID",
    });

    const approvalDirectory = path.resolve(
      process.cwd(),
      "uploads",
      "contract-seal-applications",
      "2026",
      "08",
      "11",
      "invalid-pdf-contract",
      "v2",
      "approval",
    );
    expect(fs.existsSync(invalidPdfPath)).toBe(true);
    expect(
      fs.existsSync(approvalDirectory) ? fs.readdirSync(approvalDirectory) : [],
    ).toEqual([]);
  });
});
