import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("大额报销无最低金额门槛", () => {
  const typeConfigSource = source("src/utils/reimbursement/typeConfig.ts");
  const detailSource = source("src/views/LargeReimbursementDetail.vue");
  const invoiceTableSource = source(
    "src/components/reimbursement/InvoiceTable.vue",
  );
  const reimbursementRouteSource = source("server/routes/reimbursement.ts");

  it("前端配置、详情页和发票表格不再声明或展示金额门槛", () => {
    const largeConfigStart = typeConfigSource.indexOf("  large: {");
    const businessConfigStart = typeConfigSource.indexOf(
      "  business: {",
      largeConfigStart,
    );
    const largeConfig = typeConfigSource.slice(
      largeConfigStart,
      businessConfigStart,
    );

    expect(largeConfigStart).toBeGreaterThan(-1);
    expect(businessConfigStart).toBeGreaterThan(largeConfigStart);
    expect(largeConfig).not.toContain("minimumAmount");
    expect(largeConfig).not.toContain("1000");
    expect(largeConfig).toContain("不设最低金额门槛");
    expect(detailSource).not.toContain("typeConfig.value.minimumAmount");
    expect(detailSource).not.toContain(":amount-threshold=");
    expect(detailSource).not.toContain("请使用基础报销");
    expect(invoiceTableSource).not.toContain("showThresholdWarning");
    expect(invoiceTableSource).not.toContain("金额不足");
  });

  it("创建和重新提交大额报销时不再拒绝低于1000元的金额", () => {
    const createStart = reimbursementRouteSource.indexOf(
      "router.post('/create'",
    );
    const listStart = reimbursementRouteSource.indexOf(
      "router.get('/list'",
      createStart,
    );
    const updateStart = reimbursementRouteSource.indexOf("router.put('/:id'");
    const withdrawStart = reimbursementRouteSource.indexOf(
      "router.post('/:id/withdraw'",
      updateStart,
    );
    const createRoute = reimbursementRouteSource.slice(createStart, listStart);
    const updateRoute = reimbursementRouteSource.slice(
      updateStart,
      withdrawStart,
    );

    expect(createStart).toBeGreaterThan(-1);
    expect(listStart).toBeGreaterThan(createStart);
    expect(updateStart).toBeGreaterThan(listStart);
    expect(withdrawStart).toBeGreaterThan(updateStart);
    expect(createRoute).not.toContain("type === 'large' && totalAmount < 1000");
    expect(updateRoute).not.toContain(
      "existingReimbursement.type === 'large' && totalAmount < 1000",
    );
    expect(createRoute).not.toContain("大额报销适用于发票总金额超过 1000 元");
    expect(updateRoute).not.toContain("大额报销适用于发票总金额超过 1000 元");
  });

  it("大额报销列表不再按1000元过滤记录", () => {
    const listStart = reimbursementRouteSource.indexOf("router.get('/list'");
    const pendingListStart = reimbursementRouteSource.indexOf(
      "router.get('/pending-list'",
      listStart,
    );
    const listRoute = reimbursementRouteSource.slice(
      listStart,
      pendingListStart,
    );

    expect(listStart).toBeGreaterThan(-1);
    expect(pendingListStart).toBeGreaterThan(listStart);
    expect(listRoute).toContain("whereClause += ' AND type = ?'");
    expect(listRoute).not.toContain("total_amount >= 1000");
  });
});
