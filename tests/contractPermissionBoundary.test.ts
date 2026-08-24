jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import fs from "fs";
import path from "path";
import {
  canDirectDownloadContractFile,
  canViewContractArea,
  isContractBusinessApproverRole,
  requiresRestrictedContractArea,
} from "../server/services/contractService";

describe("合同权限服务端边界", () => {
  it.each(["admin", "super_admin", "chairman", "general_manager"])(
    "%s可以查看全部区域并直接下载",
    (role) => {
      expect(canViewContractArea(role, "全部")).toBe(true);
      expect(canViewContractArea(role, "朝阳区")).toBe(true);
      expect(canDirectDownloadContractFile(role)).toBe(true);
      expect(requiresRestrictedContractArea(role)).toBe(false);
    },
  );

  it.each(["user", "boss"])("%s只能查看具体行政区且不能直接下载", (role) => {
    expect(canViewContractArea(role, "朝阳区")).toBe(true);
    expect(canViewContractArea(role, "全部")).toBe(false);
    expect(canDirectDownloadContractFile(role)).toBe(false);
    expect(requiresRestrictedContractArea(role)).toBe(true);
  });

  it("合同业务审批角色只有总经理", () => {
    expect(isContractBusinessApproverRole("general_manager")).toBe(true);
    expect(isContractBusinessApproverRole("user")).toBe(false);
    expect(isContractBusinessApproverRole("admin")).toBe(false);
    expect(isContractBusinessApproverRole("super_admin")).toBe(false);
  });

  it("合同路由对台账、详情、关系、预览、下载和审批分别实施二次校验", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(source).toContain(
      'const CONTRACT_APPROVER_ROLES = ["general_manager"] as const',
    );
    expect(source).toContain(
      'const CONTRACT_LEDGER_READ_ROLES = [...READ_ROLES, "user"] as const',
    );
    expect(source).toContain(
      'router.get("/", requireContractLedgerRead, async (req, res)',
    );
    expect(source).toContain("c.area <> '全部'");
    expect(source).toContain("visibility_root.area <> '全部'");
    expect(source).toContain("CONTRACT_ALL_AREA_READ_FORBIDDEN");
    expect(source).toContain("relationAreaVisibility");
    expect(source).toContain("CONTRACT_DIRECT_DOWNLOAD_FORBIDDEN");
    expect(source).toContain(
      'router.post("/:id/approve", requireContractApprover',
    );
    expect(source).toContain('router.post("/:id/withdraw", requireFinance');
    expect(source).toContain(
      'router.get("/ocr-jobs/:jobId", requireContractRead',
    );
    expect(source).toContain('router.get("/dashboard", requireContractRead');
    expect(source).toContain("const dashboardAreaVisibility");
    expect(
      source.match(/\$\{dashboardAreaVisibility\}/g)?.length,
    ).toBeGreaterThan(15);
    expect(source).toContain('router.get("/rates", requireContractRead');
    expect(source).toContain('row.approval_target_role === "general_manager"');
  });
});
