import { nanoid } from "nanoid";

import {
  ContractDomainError,
  listContractTargetAmountChanges,
  recalculateContractExecutionStatus,
  updateContractTargetAmount,
} from "../services/contractService.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("合同流程模拟只允许在开发环境执行");
  }
  if (/prod(?:uction)?/iu.test(process.env.DATABASE_URL || "")) {
    throw new Error("数据库连接疑似生产环境，拒绝模拟");
  }
  const { pool } = await import("../db/index.js");
  const client = await pool.connect();
  const now = new Date().toISOString();
  const suffix = nanoid(8);
  const targetId = `simulation-target-${suffix}`;
  const expenseId = `simulation-expense-${suffix}`;
  let rolledBack = false;
  try {
    await client.query("BEGIN");
    const actor = await client.query<{ id: string; role: string }>(
      `SELECT id,role FROM users WHERE name='吴静雯' AND status='active'
       AND role IN ('admin','super_admin','chairman') LIMIT 1`,
    );
    assert(actor.rows[0], "缺少吴静雯管理员账号");
    const administrator = actor.rows[0];

    await client.query(
      `INSERT INTO contracts(
         id,contract_no,title,description,requires_auxiliary_materials,
         declared_category,declared_subtype,category,asset_category,
         relation_type,status,area,project_id,parent_contract_id,
         root_contract_id,party_a,party_b,party_c,project_name,amount_delta,
         original_contract_amount,current_effective_amount,pricing_mode,
         contract_date,contract_date_source,financial_direction,
         financial_direction_source,financial_direction_version,version,
         created_by,updated_by,sealed_at,effective_at,created_at,updated_at,
         is_deleted
       ) VALUES($1,$2,$3,'目标金额全流程模拟',FALSE,'main_business',
         'engineering_consulting','main_business',NULL,'main','effective',
         '海淀区',NULL,NULL,$1,$4,$5,$6,$3,NULL,NULL,NULL,'fixed',
         '2026-09-10','manual','income','contract_category',1,1,$7,$7,
         $8,$8,$8,$8,FALSE)`,
      [
        targetId,
        `SIM-TARGET-${suffix}`,
        "三方按套结算目标金额模拟",
        "北京万方安和投资有限责任公司",
        "北京万柳置业集团有限公司",
        "北京羽隶工程咨询有限公司",
        administrator.id,
        now,
      ],
    );
    let target = await updateContractTargetAmount(
      {
        contractId: targetId,
        expectedVersion: 1,
        targetAmount: 10_000,
        targetQuantity: 10,
        unitPrice: 1_000,
        confirmedQuantity: 9,
        confirmedContractAmount: 9_000,
        quantityUnit: "套",
        actorId: administrator.id,
        actorRole: administrator.role,
      },
      client,
    );
    assert(target.pricing_mode === "target", "首次目标金额未保存");
    assert(Number(target.target_amount) === 10_000, "首次目标金额错误");

    await client.query(
      `INSERT INTO contract_invoices(
         id,contract_id,invoice_no,item_name,invoice_date,amount,status,
         created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'2026-09-10',4000,'confirmed',$5,$5,$6,$6,$6)`,
      [
        nanoid(),
        targetId,
        `SIM-INV-${suffix}`,
        target.project_name,
        administrator.id,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_receipts(
         id,contract_id,receipt_date,payment_time,amount,payer,payee,status,
         created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,'2026-09-10','2026-09-10',4000,$3,$4,'confirmed',
         $5,$5,$6,$6,$6)`,
      [
        nanoid(),
        targetId,
        "北京万方安和投资有限责任公司",
        "北京羽隶工程咨询有限公司",
        administrator.id,
        now,
      ],
    );
    target = await recalculateContractExecutionStatus(
      client,
      targetId,
      administrator.id,
      administrator.role,
    );
    assert(target.status === "executing", "部分回款后未进入执行中");
    target = await updateContractTargetAmount(
      {
        contractId: targetId,
        expectedVersion: target.version,
        targetAmount: 12_000,
        targetQuantity: 12,
        unitPrice: 1_000,
        confirmedQuantity: 9,
        confirmedContractAmount: 9_000,
        quantityUnit: "套",
        reason: "客户确认目标数量由10套调整为12套",
        actorId: administrator.id,
        actorRole: administrator.role,
      },
      client,
    );
    let floorBlocked = false;
    try {
      await updateContractTargetAmount(
        {
          contractId: targetId,
          expectedVersion: target.version,
          targetAmount: 3_000,
          targetQuantity: 3,
          unitPrice: 1_000,
          confirmedQuantity: 3,
          confirmedContractAmount: 3_000,
          quantityUnit: "套",
          reason: "模拟非法下调",
          actorId: administrator.id,
          actorRole: administrator.role,
        },
        client,
      );
    } catch (error) {
      floorBlocked =
        error instanceof ContractDomainError &&
        error.message.includes("不能低于已开票");
    }
    assert(floorBlocked, "低于已开票金额的目标未被阻断");

    await client.query(
      `INSERT INTO contract_invoices(
         id,contract_id,invoice_no,item_name,invoice_date,amount,status,
         created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'2026-09-10',8000,'confirmed',$5,$5,$6,$6,$6)`,
      [
        nanoid(),
        targetId,
        `SIM-INV-2-${suffix}`,
        target.project_name,
        administrator.id,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_receipts(
         id,contract_id,receipt_date,payment_time,amount,payer,payee,status,
         created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,'2026-09-10','2026-09-10',8000,$3,$4,'confirmed',
         $5,$5,$6,$6,$6)`,
      [
        nanoid(),
        targetId,
        "北京万方安和投资有限责任公司",
        "北京羽隶工程咨询有限公司",
        administrator.id,
        now,
      ],
    );
    target = await recalculateContractExecutionStatus(
      client,
      targetId,
      administrator.id,
      administrator.role,
    );
    assert(target.status === "completed", "达到目标金额后未自动完成");
    const history = await listContractTargetAmountChanges(targetId, client);
    assert(history.length === 2, "目标金额历史数量错误");
    assert(history[0]?.change_no === 1, "首次变更次数错误");
    assert(history[1]?.change_no === 0, "首次设置不应计入变更次数");
    await client.query("SAVEPOINT immutable_history_test");
    let immutableBlocked = false;
    try {
      await client.query(
        `UPDATE contract_target_amount_changes SET reason='被篡改'
         WHERE contract_id=$1 AND change_no=1`,
        [targetId],
      );
    } catch {
      immutableBlocked = true;
      await client.query("ROLLBACK TO SAVEPOINT immutable_history_test");
    }
    assert(immutableBlocked, "目标金额历史仍可直接修改");

    await client.query(
      `INSERT INTO contracts(
         id,contract_no,title,requires_auxiliary_materials,declared_category,
         declared_subtype,category,asset_category,relation_type,status,area,
         root_contract_id,party_a,party_b,project_name,amount_delta,
         original_contract_amount,current_effective_amount,pricing_mode,
         contract_date,contract_date_source,financial_direction,
         financial_direction_source,financial_direction_version,version,
         created_by,updated_by,sealed_at,effective_at,created_at,updated_at,
         is_deleted
       ) VALUES($1,$2,$3,FALSE,'non_main','non_main_expense','non_main',NULL,
         'main','effective','全部',$1,$4,$5,$3,10000,10000,10000,'fixed',
         '2026-09-10','manual','cost','contract_category',1,1,$6,$6,$7,$7,$7,$7,FALSE)`,
      [
        expenseId,
        `SIM-EXPENSE-${suffix}`,
        "非主营支出闭环模拟",
        "北京羽隶工程咨询有限公司",
        "模拟供应商有限公司",
        administrator.id,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_invoices(
         id,contract_id,invoice_no,item_name,invoice_date,amount,seller,buyer,
         status,created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,'2026-09-10',10000,$5,$6,'confirmed',$7,$7,$8,$8,$8)`,
      [
        nanoid(),
        expenseId,
        `SIM-COST-INV-${suffix}`,
        "非主营支出闭环模拟",
        "模拟供应商有限公司",
        "北京羽隶工程咨询有限公司",
        administrator.id,
        now,
      ],
    );
    await client.query(
      `INSERT INTO contract_payments(
         id,contract_id,payment_date,payment_time,amount,expense_category,
         payer,payee,status,created_by,confirmed_by,confirmed_at,created_at,
         updated_at
       ) VALUES($1,$2,'2026-09-10','2026-09-10',10000,'other',$3,$4,
         'confirmed',$5,$5,$6,$6,$6)`,
      [
        nanoid(),
        expenseId,
        "北京羽隶工程咨询有限公司",
        "模拟供应商有限公司",
        administrator.id,
        now,
      ],
    );
    const expense = await recalculateContractExecutionStatus(
      client,
      expenseId,
      administrator.id,
      administrator.role,
    );
    assert(expense.status === "completed", "非主营支出付款闭环未完成");
    assert(expense.financial_direction === "cost", "非主营支出方向不是支出");

    await client.query("ROLLBACK");
    rolledBack = true;
    console.log(
      JSON.stringify(
        {
          passed: true,
          rolledBack: true,
          simulations: [
            "三方按数量合同首次目标设置",
            "部分回款进入执行中",
            "目标数量变更并保留原因与次数",
            "目标金额低于票款被阻断",
            "票款达到目标自动完成",
            "目标历史数据库防篡改",
            "非主营支出进项发票与付款闭环",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (!rolledBack) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
