import fs from "fs";
import path from "path";

const databaseSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/db/index.ts"),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/routes/contracts.ts"),
  "utf8",
);
const serviceSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/services/contractService.ts"),
  "utf8",
);
const sealSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/services/contractSealWorkflow.ts"),
  "utf8",
);

describe("租赁续签独立主合同后端闭环", () => {
  it("数据库使用单向前序谱系并保证同一原合同只有一个有效续签去向", () => {
    expect(databaseSource).toContain(
      "renewed_from_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT",
    );
    expect(databaseSource).toContain("renewed_from_lease_end_date TEXT");
    expect(databaseSource).toContain(
      "renewed_from_contract_id IS NULL AND\n          renewed_from_lease_end_date IS NULL",
    );
    expect(databaseSource).toContain("root_contract_id IS NOT NULL");
    expect(databaseSource).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_one_renewal_successor",
    );
    expect(databaseSource).toContain("status <> 'rejected'");
  });

  it("续签接口创建独立主合同并返回独立上下文", () => {
    expect(routeSource).toContain('"/:id/renewal-upload-context"');
    expect(routeSource).toContain('"/:id/renewals/recognize"');
    expect(routeSource).toContain("sourceContractId: source.id");
    expect(routeSource).toContain("currentLeaseEndDate: source.lease_end_date");
    expect(routeSource).toContain(
      "renewed_from_contract_id, renewed_from_lease_end_date",
    );
    expect(routeSource).toContain("$1,$2,NULL,$3,$4,NULL,$5,'main','draft',$6");
    expect(routeSource).toContain("NULL,NULL,$1,$7,$8,NULL,NULL,NULL,NULL");
    expect(routeSource).not.toContain("rentalRenewalEligible");
    expect(routeSource).not.toContain("rentalRenewalBlockingReason");
  });

  it("新合同金额按主合同总额落库且不进入补充协议金额链", () => {
    expect(routeSource).toContain(
      "renewalMain: Boolean(job.renewed_from_contract_id)",
    );
    expect(routeSource).toContain("independentRenewalBlocker");
    expect(routeSource).toContain("续签新合同金额与新租期租金计算结果不一致");
    expect(serviceSource).toContain("CONTRACT_RENEWAL_MAIN_REQUIRED");
    expect(serviceSource).toContain("CONTRACT_RENEWAL_SOURCE_STALE");
  });

  it("盖章归档核验续签租期但不改写原合同金额和到期日", () => {
    expect(sealSource).toContain(
      "contract.renewed_from_contract_id ? { renewalMain: true } : {}",
    );
    expect(sealSource).toContain("independentRenewalSource");
    expect(sealSource).toContain("CONTRACT_RENEWAL_SEALED_PERIOD_MISMATCH");
    expect(sealSource).toContain("rental_renewal_successor_effective");
    expect(sealSource).toContain("sourceLifecyclePreserved: true");
  });

  it("安全迁移保留原编号文件审批并恢复原合同金额和到期日", () => {
    expect(databaseSource).toContain("contract_safe_legacy_renewals");
    expect(databaseSource).toContain(
      "parent.current_effective_amount = child.amount_after_change",
    );
    expect(databaseSource).toContain(
      "child.amount_after_change =\n        child.amount_before_change + child.amount_delta",
    );
    expect(databaseSource).toContain("record.contract_id = child.id");
    expect(databaseSource).toContain("record.status = 'draft'");
    expect(databaseSource).toContain("legacy_rental_renewal_source_restored");
    expect(databaseSource).toContain("legacy_rental_renewal_migrated");
    expect(databaseSource).toContain(
      "SET relation_type = 'main', parent_contract_id = NULL",
    );
    expect(databaseSource).not.toContain(
      "UPDATE contract_files SET contract_id",
    );
    expect(databaseSource).not.toContain(
      "UPDATE contract_approval_records SET contract_id",
    );
    expect(databaseSource).not.toContain("UPDATE contract_audit_logs");
    expect(databaseSource).toContain(
      "legacy_rental_renewal_source_evidence_added",
    );
    expect(databaseSource).toContain(
      "legacy_rental_renewal_contract_evidence_added",
    );
    expect(databaseSource).toContain("referencedAuditId");
    expect(databaseSource).toContain("ON CONFLICT (id) DO NOTHING");
  });

  it("列表详情返回双向展示字段且新合同生效后原合同停止到期提醒", () => {
    expect(routeSource).toContain(
      "previousLeaseContractId: row.renewed_from_contract_id || null",
    );
    expect(routeSource).toContain(
      "renewalContractId: row.renewal_contract_id || null",
    );
    expect(routeSource).toContain(
      "renewalContractStatus: row.renewal_contract_status || null",
    );
    expect(routeSource).toContain(
      "renewalContractName: row.renewal_contract_name || null",
    );
    expect(routeSource).toContain("renewal.renewed_from_contract_id = c.id");
    expect(routeSource).toContain(
      "renewal.status IN (\n                  'effective', 'executing', 'completed', 'terminated'",
    );
  });
});
