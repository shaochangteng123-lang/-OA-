import fs from "node:fs";
import path from "node:path";

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("财务审批中心待确认列表口径", () => {
  const approvalViewSource = read("src/views/ApprovalCenter.vue");
  const approvalRouteSource = read("server/routes/approval.ts");

  const pendingReceiptPaneStart = approvalViewSource.indexOf("<!-- 待确认 -->");
  const pendingReceiptPaneEnd = approvalViewSource.indexOf(
    "<!-- 全部查询 -->",
    pendingReceiptPaneStart,
  );
  const pendingReceiptPane = approvalViewSource.slice(
    pendingReceiptPaneStart,
    pendingReceiptPaneEnd,
  );

  const loadPendingReceiptStart = approvalViewSource.indexOf(
    "async function loadPaidList()",
  );
  const loadPendingReceiptEnd = approvalViewSource.indexOf(
    "// 待付款查询",
    loadPendingReceiptStart,
  );
  const loadPendingReceiptSource = approvalViewSource.slice(
    loadPendingReceiptStart,
    loadPendingReceiptEnd,
  );

  const resetPendingReceiptStart = approvalViewSource.indexOf(
    "function handleResetPaidFilter()",
  );
  const resetPendingReceiptEnd = approvalViewSource.indexOf(
    "// 加载待上传回单列表",
    resetPendingReceiptStart,
  );
  const resetPendingReceiptSource = approvalViewSource.slice(
    resetPendingReceiptStart,
    resetPendingReceiptEnd,
  );

  it("待确认页始终只请求待确认收款记录", () => {
    expect(pendingReceiptPaneStart).toBeGreaterThanOrEqual(0);
    expect(pendingReceiptPaneEnd).toBeGreaterThan(pendingReceiptPaneStart);
    expect(loadPendingReceiptStart).toBeGreaterThanOrEqual(0);
    expect(loadPendingReceiptEnd).toBeGreaterThan(loadPendingReceiptStart);
    expect(resetPendingReceiptStart).toBeGreaterThanOrEqual(0);
    expect(resetPendingReceiptEnd).toBeGreaterThan(resetPendingReceiptStart);

    expect(pendingReceiptPane).not.toContain('v-model="paidFilterForm.status"');
    expect(pendingReceiptPane).not.toContain('value="completed"');
    expect(pendingReceiptPane).toContain('empty-text="暂无待确认收款记录"');
    expect(loadPendingReceiptSource).toMatch(
      /const params: Record<string, string> = \{\s*status: 'payment_uploaded'\s*\}/,
    );
    expect(loadPendingReceiptSource).not.toContain("paidFilterForm.status");
    expect(resetPendingReceiptSource).not.toContain("paidFilterForm.status");

    const paidRouteStart = approvalRouteSource.indexOf(
      "router.get('/paid-this-month'",
    );
    const paidRouteEnd = approvalRouteSource.indexOf(
      "router.get('/completed-this-month'",
      paidRouteStart,
    );
    const paidRouteSource = approvalRouteSource.slice(
      paidRouteStart,
      paidRouteEnd,
    );

    expect(paidRouteStart).toBeGreaterThanOrEqual(0);
    expect(paidRouteEnd).toBeGreaterThan(paidRouteStart);
    expect(paidRouteSource).toContain("conditions.push('r.status = ?')");
    expect(paidRouteSource).toContain("params.push(status)");
  });

  it("已完成记录继续保留在全部查询中", () => {
    const allPaneStart = approvalViewSource.indexOf("<!-- 全部查询 -->");
    const allPaneEnd = approvalViewSource.indexOf(
      "<!-- 发票管理 -->",
      allPaneStart,
    );
    const allPaneSource = approvalViewSource.slice(allPaneStart, allPaneEnd);

    expect(allPaneStart).toBeGreaterThanOrEqual(0);
    expect(allPaneEnd).toBeGreaterThan(allPaneStart);
    expect(allPaneSource).toContain('value="completed"');

    const allRouteStart = approvalRouteSource.indexOf(
      "router.get('/all-reimbursements'",
    );
    const allRouteEnd = approvalRouteSource.indexOf(
      "router.get('/export-monthly'",
      allRouteStart,
    );
    const allRouteSource = approvalRouteSource.slice(
      allRouteStart,
      allRouteEnd,
    );

    expect(allRouteStart).toBeGreaterThanOrEqual(0);
    expect(allRouteEnd).toBeGreaterThan(allRouteStart);
    expect(allRouteSource).toContain(
      "r.status IN ('payment_uploaded', 'completed')",
    );
  });
});
