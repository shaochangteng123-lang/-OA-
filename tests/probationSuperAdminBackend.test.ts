/** @jest-environment node */

const mockPrepare = jest.fn();
const mockTransaction = jest.fn();

jest.mock("../server/db/index", () => ({
  db: { prepare: mockPrepare, transaction: mockTransaction },
}));
jest.mock("nanoid", () => ({ nanoid: () => "签署记录编号" }));
jest.mock("../server/utils/electronic-signature", () => ({
  normalizeSignaturePng: jest.fn(async (buffer: Buffer) => buffer),
}));
jest.mock("../server/utils/upload-date", () => ({
  ensureDatedUploadDirectory: () => "/tmp/probation-permission-test",
  toStoredUploadPath: (value: string) => value,
}));
jest.mock("../server/services/probationApplicationPdf", () => ({
  generateProbationApplicationPdf: jest.fn(),
}));

import fs from "fs";
import type { Request, Response } from "express";
import router from "../server/routes/probation";

const MemoryDatabase = require("better-sqlite3");

async function invokeRoute(
  routePath: string,
  userId: string,
  query: Record<string, string> = {},
  body: Record<string, unknown> = {},
) {
  const handler = router.stack
    .find((item) => item.route?.path === routePath)
    ?.route.stack.at(-1)?.handle;
  if (!handler) throw new Error("转正接口不存在");
  const req = {
    session: { userId },
    query,
    body,
    params: { id: "申请编号" },
  } as unknown as Request;
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res as unknown as Response, jest.fn());
  return res;
}

describe("超级管理员转正主管权限", () => {
  let database: InstanceType<typeof MemoryDatabase>;

  beforeEach(() => {
    jest.clearAllMocks();
    database = new MemoryDatabase(":memory:");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, status TEXT, name TEXT);
      CREATE TABLE employee_profiles (
        id TEXT PRIMARY KEY, user_id TEXT, name TEXT, department TEXT,
        position TEXT, mobile TEXT, hire_date TEXT
      );
      CREATE TABLE probation_confirmations (
        id TEXT PRIMARY KEY, employee_id TEXT, status TEXT, review_stage TEXT,
        supervisor_id TEXT, hr_approver_id TEXT, chairman_id TEXT,
        applicant_name_snapshot TEXT, department_snapshot TEXT, position_snapshot TEXT,
        created_at TEXT, submit_time TEXT, form_version INTEGER,
        hire_date TEXT, probation_end_date TEXT
      );
      CREATE TABLE probation_signature_records (
        id TEXT, confirmation_id TEXT, signer_id TEXT, stage TEXT,
        signed_at TEXT, form_version INTEGER
      );
      INSERT INTO users VALUES
        ('超级管理员', 'super_admin', 'active', '真实管理员'),
        ('总经理', 'general_manager', 'active', '实际总经理'),
        ('普通管理员', 'admin', 'active', '人事管理员'),
        ('董事长', 'chairman', 'active', '实际董事长'),
        ('普通员工', 'user', 'active', '普通员工'),
        ('停用总经理', 'general_manager', 'inactive', '停用总经理');
      INSERT INTO employee_profiles VALUES
        ('员工档案', '普通员工', '普通员工', '项目部', '职员', NULL, '2026-01-01');
    `);
    mockPrepare.mockImplementation((sql: string) => ({
      get: (...params: unknown[]) => {
        if (/FROM (employee_documents|approval_records)/.test(sql))
          return undefined;
        return database.prepare(sql).get(...params);
      },
      all: (...params: unknown[]) => {
        if (sql.includes("FROM probation_history")) return [];
        return database.prepare(sql).all(...params);
      },
    }));
  });

  afterEach(() => {
    database.close();
    jest.restoreAllMocks();
  });

  function addApplication(
    id: string,
    stage = "supervisor",
    supervisorId = "总经理",
    employeeId = "员工档案",
  ) {
    database
      .prepare(
        `
      INSERT INTO probation_confirmations
        (id, employee_id, status, review_stage, supervisor_id, hr_approver_id,
         chairman_id, form_version, submit_time, created_at)
      VALUES (?, ?, 'submitted', ?, ?, '普通管理员', '董事长', 1, '2026-09-01', '2026-09-01')
    `,
      )
      .run(id, employeeId, stage, supervisorId);
  }

  it("待签纳入活动总经理主管任务，仍隔离人事、董事长、自审及失效主管", async () => {
    addApplication("主管待签");
    addApplication("人事待签", "hr");
    addApplication("董事长待签", "general_manager");
    addApplication("失效主管", "supervisor", "停用总经理");
    addApplication("非总经理主管", "supervisor", "普通管理员");
    addApplication("已完成");
    database
      .prepare(
        "UPDATE probation_confirmations SET status = 'approved' WHERE id = ?",
      )
      .run("已完成");
    database
      .prepare(
        "INSERT INTO employee_profiles (id, user_id, name) VALUES (?, ?, ?)",
      )
      .run("本人档案", "总经理", "总经理");
    addApplication("本人申请", "supervisor", "总经理", "本人档案");

    const admin = await invokeRoute("/signature-tasks", "超级管理员");
    expect(admin.status).not.toHaveBeenCalled();
    expect(
      admin.json.mock.calls[0][0].data.map((row: { id: string }) => row.id),
    ).toEqual(["主管待签", "本人申请"]);

    const manager = await invokeRoute("/signature-tasks", "总经理");
    expect(
      manager.json.mock.calls[0][0].data.map((row: { id: string }) => row.id),
    ).toEqual(["主管待签"]);
    const hr = await invokeRoute("/signature-tasks", "普通管理员");
    expect(
      hr.json.mock.calls[0][0].data.map((row: { id: string }) => row.id),
    ).toEqual(["人事待签", "非总经理主管"]);
    const chairman = await invokeRoute("/signature-tasks", "董事长");
    expect(
      chairman.json.mock.calls[0][0].data.map((row: { id: string }) => row.id),
    ).toEqual(["董事长待签"]);
    const employee = await invokeRoute("/signature-tasks", "普通员工");
    expect(employee.json.mock.calls[0][0].data).toEqual([]);

    database
      .prepare("UPDATE employee_profiles SET user_id = ? WHERE id = ?")
      .run("超级管理员", "本人档案");
    const selfExcluded = await invokeRoute("/signature-tasks", "超级管理员");
    expect(
      selfExcluded.json.mock.calls[0][0].data.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual(["主管待签"]);
  });

  it("本月本人已审合并主管和人事签署，同一申请去重且不混入他人或终审记录", async () => {
    for (const id of [
      "主管记录",
      "人事记录",
      "他人记录",
      "终审记录",
      "过期记录",
    ])
      addApplication(id);
    const now = new Date();
    const signedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-05`;
    const insert = database.prepare(
      "INSERT INTO probation_signature_records VALUES (?, ?, ?, ?, ?, 1)",
    );
    for (const [id, applicant, signer, stage, date] of [
      ["1", "主管记录", "超级管理员", "supervisor", signedAt],
      ["2", "主管记录", "超级管理员", "hr", signedAt],
      ["3", "人事记录", "超级管理员", "hr", signedAt],
      ["4", "他人记录", "总经理", "supervisor", signedAt],
      ["5", "终审记录", "超级管理员", "general_manager", signedAt],
      ["6", "过期记录", "超级管理员", "supervisor", "2020-01-05"],
    ])
      insert.run(id, applicant, signer, stage, date);

    const res = await invokeRoute("/list", "超级管理员", {
      reviewedByMeThisMonth: "1",
    });
    expect(res.status).not.toHaveBeenCalled();
    const result = res.json.mock.calls[0][0].data;
    expect(result.total).toBe(2);
    expect(result.list.map((row: { id: string }) => row.id).sort()).toEqual(
      ["主管记录", "人事记录"].sort(),
    );
  });

  function mockSigning(
    options: {
      role?: string;
      stage?: string;
      employeeUserId?: string;
      supervisorRole?: string;
      supervisorStatus?: string;
      signatureMissing?: boolean;
      hrApproverId?: string | null;
      formVersion?: number;
    } = {},
  ) {
    const role = options.role || "super_admin";
    const signerId = role === "general_manager" ? "总经理" : "超级管理员";
    const confirmation = {
      id: "申请编号",
      employee_user_id: options.employeeUserId || "普通员工",
      status: "submitted",
      review_stage: options.stage || "supervisor",
      supervisor_id: "总经理",
      supervisor_role: options.supervisorRole || "general_manager",
      supervisor_status: options.supervisorStatus || "active",
      hr_approver_id:
        options.hrApproverId === undefined
          ? "普通管理员"
          : options.hrApproverId,
      chairman_id: "董事长",
      form_version: options.formVersion ?? 1,
    };
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes("SELECT u.id"))
        return { rows: [{ id: signerId, name: "真实签署人", role }] };
      if (sql.includes("FROM probation_confirmations pc"))
        return { rows: [confirmation] };
      if (sql.includes("FROM user_signatures"))
        return {
          rows: options.signatureMissing
            ? []
            : [{ signature_path: "uploads/本人签名.png" }],
        };
      if (sql.includes("FROM approval_instances"))
        return { rows: [{ id: "审批实例" }] };
      if (sql.includes("SET review_stage = 'hr'"))
        confirmation.review_stage = "hr";
      return { rows: [] };
    });
    mockTransaction.mockImplementation(
      async (callback: (client: unknown) => unknown) => callback({ query }),
    );
    mockPrepare.mockReturnValue({ get: jest.fn(async () => confirmation) });
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("本人签名"));
    const write = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    return { query, write, signerId };
  }

  it.each(["super_admin", "general_manager"])(
    "主管通过使用 %s 的本人签名和真实身份，下一步仍是人事",
    async (role) => {
      const { query, signerId } = mockSigning({ role });
      const res = await invokeRoute(
        "/:id/sign-review",
        signerId,
        {},
        {
          decision: "approve",
          opinion: "同意转正",
          signatureType: "personal",
          expectedStage: "supervisor",
          expectedFormVersion: 1,
        },
      );
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: true,
        message: "已签署主管领导意见，等待管理员签署人事部意见",
      });
      const signatureRead = query.mock.calls.find(([sql]) =>
        sql.includes("FROM user_signatures"),
      );
      expect(signatureRead?.[1]).toEqual([signerId]);
      const signatureInsert = query.mock.calls.find(([sql]) =>
        sql.includes("INSERT INTO probation_signature_records"),
      );
      expect(signatureInsert?.[1]).toEqual(
        expect.arrayContaining([signerId, "真实签署人", role, "personal"]),
      );
      expect((signatureInsert?.[1] as unknown[])[11]).toBe("真实签署人");
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes("SET review_stage = 'hr'"),
        ),
      ).toBe(true);
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes("SET status = 'approved'"),
        ),
      ).toBe(false);
    },
  );

  it.each([
    { stage: "hr" },
    { stage: "general_manager" },
    { employeeUserId: "超级管理员" },
    { supervisorStatus: "inactive" },
    { supervisorRole: "admin" },
    { role: "admin" },
    { role: "chairman" },
    { role: "user" },
  ])("禁止越权签署或自审：%j", async (options) => {
    const { write, signerId } = mockSigning(options);
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
        expectedStage: options.stage || "supervisor",
        expectedFormVersion: 1,
      },
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(write).not.toHaveBeenCalled();
  });

  it("超级管理员缺少本人签名时必须先上传，不回退使用总经理签名", async () => {
    const { query, write, signerId } = mockSigning({ signatureMissing: true });
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
        expectedStage: "supervisor",
        expectedFormVersion: 1,
      },
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe(
      "请先在个人设置上传本人电子签名",
    );
    expect(
      query.mock.calls.filter(([sql]) => sql.includes("FROM user_signatures")),
    ).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });

  it("超级管理员驳回主管环节时保留真实签署人并退回员工", async () => {
    const { query, signerId } = mockSigning();
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "reject",
        opinion: "请补充工作总结",
        expectedStage: "supervisor",
        expectedFormVersion: 1,
      },
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
    const rejection = query.mock.calls.find(([sql]) =>
      sql.includes("SET status = 'rejected'"),
    );
    expect(rejection?.[0]).toContain("review_stage = 'employee'");
    expect(rejection?.[1]).toEqual(
      expect.arrayContaining([signerId, "请补充工作总结"]),
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes("SET review_stage = 'hr'")),
    ).toBe(false);
  });

  it("不接受使用总经理电子签名的请求", async () => {
    const { query, write, signerId } = mockSigning();
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
        signatureType: "general_manager",
      },
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { expectedStage: "supervisor" },
    { expectedFormVersion: 1 },
    { expectedStage: "supervisor", expectedFormVersion: "1" },
    { expectedStage: "employee", expectedFormVersion: 1 },
  ])("超级管理员必须提供有效的当前环节和版本：%j", async (revision) => {
    const { query, write, signerId } = mockSigning();
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
        ...revision,
      },
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toContain("刷新待签列表");
    expect(
      query.mock.calls.some(([sql]) => sql.includes("FROM user_signatures")),
    ).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(
      false,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    { stage: "hr", formVersion: 1 },
    { stage: "supervisor", formVersion: 2 },
  ])("旧环节或旧版本页面不能生成签名和记录：%j", async (options) => {
    const { query, write, signerId } = mockSigning({
      ...options,
      hrApproverId: null,
    });
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "旧页面意见",
        expectedStage: "supervisor",
        expectedFormVersion: 1,
      },
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(
      query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE OF pc, ep")),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => sql.includes("FROM user_signatures")),
    ).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO"))).toBe(
      false,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["超级管理员", null])(
    "主管签署重发不得自动转为人事签署，人事指派为%s",
    async (hrApproverId) => {
      const { query, write, signerId } = mockSigning({ hrApproverId });
      const body = {
        decision: "approve",
        opinion: "主管意见",
        expectedStage: "supervisor",
        expectedFormVersion: 1,
      };
      const first = await invokeRoute("/:id/sign-review", signerId, {}, body);
      expect(first.json.mock.calls[0][0].success).toBe(true);
      const second = await invokeRoute("/:id/sign-review", signerId, {}, body);
      expect(second.status).toHaveBeenCalledWith(409);
      expect(write).toHaveBeenCalledTimes(1);
      expect(
        query.mock.calls.filter(([sql]) =>
          sql.includes("INSERT INTO probation_signature_records"),
        ),
      ).toHaveLength(1);
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes("SET review_stage = 'general_manager'"),
        ),
      ).toBe(false);
    },
  );

  it("旧总经理页面缺少新增环节版本字段时保持兼容", async () => {
    const { signerId } = mockSigning({ role: "general_manager" });
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
      },
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it("总经理页面提供了版本信息后同样不能签署旧版本", async () => {
    const { write, signerId } = mockSigning({
      role: "general_manager",
      formVersion: 2,
    });
    const res = await invokeRoute(
      "/:id/sign-review",
      signerId,
      {},
      {
        decision: "approve",
        opinion: "同意",
        expectedStage: "supervisor",
        expectedFormVersion: 1,
      },
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(write).not.toHaveBeenCalled();
  });
});
