/** @jest-environment node */

import fs from "node:fs";
import path from "node:path";

describe("合同可变目标金额", () => {
  const schemaSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );
  const serviceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const createSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
    "utf8",
  );
  const detailSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
    "utf8",
  );

  it("目标金额、数量和确认金额具有结构化字段与不可变历史", () => {
    for (const field of [
      "pricing_mode",
      "target_amount",
      "target_quantity",
      "unit_price",
      "confirmed_quantity",
      "confirmed_contract_amount",
      "quantity_unit",
    ]) {
      expect(schemaSource).toContain(field);
    }
    expect(schemaSource).toContain("contract_target_amount_changes");
    expect(schemaSource).toContain(
      "trg_contract_target_amount_history_immutable",
    );
  });

  it("首次设置记为0，后续变更从1开始并强制填写原因", () => {
    expect(serviceSource).toMatch(/const changeNo = initial\s*\? 0\s*:/u);
    expect(serviceSource).toContain(
      "变更目标金额、数量或单价时必须填写变更原因",
    );
    expect(serviceSource).toContain('initial ? "initial" : "update"');
  });

  it("目标金额不能低于票款或当前确认金额", () => {
    expect(serviceSource).toContain("const financialFloor = Math.max");
    expect(serviceSource).toContain(
      "目标金额不能低于已开票、已回付款或当前确认金额",
    );
  });

  it("提供管理员接口并采用合同版本门禁", () => {
    expect(routeSource).toContain('router.patch("/:id/target-amount"');
    expect(routeSource).toContain("expectedVersion: parseExpectedVersion");
    expect(serviceSource).toContain("CONTRACT_VERSION_CONFLICT");
  });

  it("正常新增遇到合法空金额时进入目标金额配置，不开放OCR字段手改", () => {
    expect(createSource).toContain("该合同按目标金额管理");
    expect(createSource).toContain(
      'form.pricingMode = recognizedAmount ? "fixed" : "target"',
    );
    expect(createSource).toContain("updateContractTargetAmount");
    expect(createSource).toContain('placeholder="由合同自动识别"');
    expect(createSource).toContain("readonly");
  });

  it("详情展示目标、当前确认值和完整变更历史", () => {
    expect(detailSource).toContain("当前目标金额");
    expect(detailSource).toContain("当前确认金额");
    expect(detailSource).toContain("目标金额变更记录");
    expect(detailSource).toContain("首次设置不计入变更次数，历史不可修改");
  });
});
