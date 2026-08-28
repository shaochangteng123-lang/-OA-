import fs from "node:fs";
import path from "node:path";

describe("押金结算银行回单自动识别", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );
  const ocrSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractFinancialOcr.ts"),
    "utf8",
  );
  const contractServiceSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/services/contractService.ts"),
    "utf8",
  );

  it("识别接口返回确认所需的安全快照和版本", () => {
    const start = routeSource.indexOf(
      '"/:id/deposit/return-receipts/recognize"',
    );
    const end = routeSource.indexOf(
      '"/:id/deposit/return-receipts/:jobId"',
      start,
    );
    const source = routeSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(source).toContain("requireFinance");
    expect(source).toContain("uploadSingle");
    expect(source).toContain("recognizeAndStoreFinancialFile");
    expect(source).toContain("receiptKind");
    expect(source).toContain("targetId: recognitionContext.targetId");
    expect(source).toContain("canConfirm: result.canCreateDraft");
    expect(source).toContain("fields: result.snapshot.fields");
    expect(source).toContain("blockingReasons: result.blockingReasons");
    expect(source).toContain("engineVersion: result.engineVersion");
    expect(source).toContain("parserVersion: result.parserVersion");
    expect(source).toContain("fileUrl:");
    expect(source).toContain(
      "CONTRACT_DEPOSIT_RETURN_OCR_COMMIT_OUTCOME_UNCERTAIN",
    );
    expect(source).toContain("!stored && !commitOutcomeUncertain");
  });

  it("退款与退工程同时校验模型、方向、主体、账号、金额和日期", () => {
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DIRECTION_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PARTY_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYER_ACCOUNT_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_PAYEE_ACCOUNT_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_AMOUNT_EXCEEDS_REMAINING",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_RECEIPT_DATE_BEFORE_SOURCE",
    );
    expect(routeSource).toContain('expectedDirection: "receipt"');
    expect(routeSource).toContain('expectedDirection: "payment"');
    expect(routeSource).toContain(
      "payerName: depositReturnContext.expectedPayer",
    );
    expect(routeSource).toContain(
      "payeeName: depositReturnContext.expectedPayee",
    );
    expect(routeSource).toContain(
      "expectedPayer: resolveContractCompanySubject(contract).name",
    );
    expect(routeSource).toContain("job.engine_version !==");
    expect(routeSource).toContain("contractFinancialOcrEngineVersion(");
    expect(routeSource).toContain("job.parser_version !==");
    expect(routeSource).toContain("contractFinancialOcrParserVersion(");
  });

  it("银行回单路径固定使用第六版中型模型且不调用第二识别引擎", () => {
    const start = ocrSource.indexOf(
      "async function recognizePreparedBankReceiptDocument",
    );
    const end = ocrSource.indexOf(
      "export async function recognizeContractFinancialDocument",
      start,
    );
    const bankSource = ocrSource.slice(start, end);

    expect(bankSource).toContain(
      'callPaddleOcrDetailed(ocrFilePath, "v6_medium")',
    );
    expect(bankSource).not.toContain("callTesseractOcrDetailed(");
  });

  it("专用任务与普通财务恢复、重试和登记消费隔离", () => {
    expect(databaseSource).toContain(
      "business_purpose IS NULL OR business_purpose IN",
    );
    expect(databaseSource).toContain(
      "idx_contract_financial_ocr_business_purpose",
    );
    expect(
      routeSource.match(/business_purpose IS NULL/gu)?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(contractServiceSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_OCR_SPECIAL_ROUTE_REQUIRED",
    );
    expect(routeSource).toContain('"/:id/deposit/return-receipts/:jobId"');
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_OCR_ALREADY_CONSUMED",
    );
  });

  it("已入账财务原件重复用于押金回单时返回带真实方向的冲突提示", () => {
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_RETURN_FILE_ALREADY_POSTED",
    );
    expect(routeSource).toContain("FROM contract_invoices invoice");
    expect(routeSource).toContain("FROM contract_receipts receipt");
    expect(routeSource).toContain("FROM contract_payments payment");
    expect(routeSource).toContain("FROM contract_external_payments payment");
    expect(routeSource).toContain('receipt: "回款回单"');
    expect(routeSource).toContain('payment: "付款回单"');
    expect(routeSource).toContain('external_payment: "对外付款回单"');
    expect(routeSource).toContain(
      "该文件已作为本合同${recordLabel}入账，不能重复用于${purposeLabel}",
    );
    expect(routeSource).toContain(
      "${depositReturnContext.expectedPayer}→${depositReturnContext.expectedPayee}",
    );
    expect(routeSource).toContain("FINANCIAL_FILE_HASH_DUPLICATE");
    expect(routeSource).toContain(
      "该财务凭证原件已在其他合同或记录中上传，禁止重复使用",
    );
  });

  it("历史退款必须与识别金额日期完全一致且直付退款不产生二次退工程", () => {
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_AMOUNT_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_DATE_MISMATCH",
    );
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_MISMATCH",
    );
    expect(routeSource).toContain(
      'type === "refund" && deposit.external_payment_record_id',
    );
  });
});
