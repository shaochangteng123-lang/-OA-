import fs from "fs";
import path from "path";

describe("合同新增向导业务保护", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
    "utf8",
  );
  const backendSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );

  it("每步前保存草稿并对关闭浏览器进行离开保护", () => {
    expect(source).toContain("const saved = await saveDraft(false)");
    expect(source).toContain("uploadPendingSupportingFiles");
    expect(source).toContain("hasPendingSupportingUploads");
    expect(source).toContain("hasUnsavedChanges.value");
    expect(source).toContain("saveCurrentProgress(false)");
    expect(source).toContain('window.addEventListener("beforeunload"');
    expect(source).toContain("保存后离开");
    expect(source).toContain("直接离开");
    expect(source).toContain("const createdDraftInCurrentSession = ref(false)");
    expect(source).toContain("createdDraftInCurrentSession.value = true");
    expect(source).toContain("async function discardCurrentNewDraft()");
    expect(source).toContain("直接离开将永久删除本次草稿、识别结果和附件");
    expect(source).toContain(
      "await deleteContractDraft(contractId.value, version)",
    );
    expect(source).toContain("本次新增合同草稿已永久删除");
    expect(source).toContain("直接离开仅放弃本次修改并保留原草稿");
  });

  it("可选资料不会误改合同版本或使已签名用印申请失效", () => {
    const selectStart = source.indexOf("function selectSupportingFile");
    const selectEnd = source.indexOf(
      "function findSupportingFile",
      selectStart,
    );
    const removeStart = source.indexOf("async function removeSupportingFile");
    const removeEnd = source.indexOf("async function nextStep", removeStart);
    const uploadStart = source.indexOf(
      "async function uploadPendingSupportingFiles",
    );
    const uploadEnd = source.indexOf(
      "async function submitForApproval",
      uploadStart,
    );
    const saveStart = source.indexOf("async function saveDraft");
    const saveEnd = source.indexOf(
      "async function saveCurrentProgress",
      saveStart,
    );

    expect(source).toContain('@click="saveCurrentProgress(true)"');
    expect(source.slice(selectStart, selectEnd)).not.toContain(
      "dirty.value = true",
    );
    expect(source.slice(removeStart, removeEnd)).not.toContain(
      "dirty.value = true",
    );
    expect(source.slice(uploadStart, uploadEnd)).not.toContain(
      "dirty.value = false",
    );
    expect(source.slice(saveStart, saveEnd)).toContain("if (!dirty.value)");
  });

  it("只允许必需字段自动通过后继续，草拟日期可留空", () => {
    expect(source).toContain('ocrJob.value?.status === "succeeded"');
    expect(source).toContain("四个识别必需字段均通过自动安全门禁且无候选冲突");
    expect(source).toContain("合同类型采用上传前选择值");
    expect(source).not.toContain("诊断分不是正确率");
    expect(source).not.toContain("value >= 95");
    expect(source).not.toContain("isAutomaticallyAcceptedConfidence");
    expect(source).toMatch(
      /const requiredFieldsComplete = computed\(\(\) =>\s*ocrFields\.value\.every\([\s\S]*?!field\.required \|\|\s*Boolean\(String\(field\.value \?\? ""\)\.trim\(\)\)/,
    );
    expect(source).toContain("field.manuallyConfirmed");
    expect(source).toContain('valueOf("contract_date")');
    expect(source).toContain("form.contractDate");
    expect(source).toContain("继续查询识别进度");
    expect(source).not.toContain("转为人工录入");
    expect(source).not.toContain("确认并采用识别结果");
    expect(source).not.toContain("confirmContractOcrFields");
    expect(source).not.toContain("manualFieldValues");
    expect(source).toContain("automaticRecognitionBlocked");
    expect(source).toContain("合同字段不允许手动填写或人工采用");
  });

  it("恢复旧解析版本的部分结果、残缺项目或漏页任务时自动复跑", () => {
    expect(source).toContain("detail.ocrJob?.requiresRefresh");
    expect(source).toContain(
      "检测到旧版识别结果，系统将按最新规则自动重新识别",
    );
    expect(source).toMatch(
      /if \(refreshOutdatedRecognition\) \{\s*await retryRecognition\(\);\s*\}/,
    );
    expect(backendSource).toContain("staleSucceededProjectNeedsRefresh");
    expect(backendSource).toContain("staleSucceededPageFailureNeedsRefresh");
    expect(backendSource).toContain(
      "/第\\s*\\d+\\s*页(?:扫描|高清|超清)识别失败/u",
    );
    expect(backendSource).toContain("latestProjectValue");
    expect(backendSource).toContain('latestJob.status === "partial"');
  });

  it("租赁续签创建独立新主合同并调用专用上下文和识别接口", () => {
    const apiSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractApi.ts"),
      "utf8",
    );
    expect(source).toContain("const rentalRenewalMode = computed");
    expect(source).toContain('"新增续签合同"');
    expect(source).toContain("getContractRentalRenewalUploadContext");
    expect(source).toContain('form.relationType = "main"');
    expect(source).toContain('form.parentContractId = ""');
    expect(source).toContain("续签合同是新的独立一级合同");
    expect(source).toContain("金额、附件和审批均独立的新主合同");
    expect(source).not.toContain("rentalRenewalEligible");
    expect(source).not.toContain("rentalRenewalBlockingReason");
    expect(source).toContain("recognizeRentalRenewalContract");
    expect(apiSource).toContain("getContractRentalRenewalUploadContext");
    expect(apiSource).toContain(
      "`/api/contracts/${sourceContractId}/renewal-upload-context`",
    );
    expect(apiSource).toContain("recognizeRentalRenewalContract");
    expect(apiSource).toContain(
      "`/api/contracts/${sourceContractId}/renewals/recognize`",
    );
    expect(backendSource).toContain('"/:id/renewal-upload-context"');
    expect(backendSource).toContain('"/:id/renewals/recognize"');
  });

  it("上传前资产合同显式选择二级分类，收入合同仍由系统内部赋值", () => {
    expect(source).toContain('v-model="form.area"');
    expect(backendSource).toContain('"全部"');
    expect(source).toContain('v-model="form.declaredCategory"');
    expect(source).toContain('v-model="form.declaredSubtype"');
    expect(source).toContain('label="合同二级分类"');
    expect(source).toContain("请选择资产合同二级分类");
    expect(source).toContain('value: "house_rental"');
    expect(source).toContain('value: "vehicle_rental"');
    expect(source).toContain('value: "parking_space"');
    expect(source).toContain('label: "车位合同"');
    expect(source).toContain("handleAssetSubtypeChange");
    expect(source).toContain('v-model="form.relationType"');
    expect(source).toContain('relationType: "",');
    expect(source).toContain('declaredSubtype: "",');
    expect(source).toContain("if (!form.relationType) return false");
    expect(source).toContain("uploadSetupComplete");
    expect(source).toContain(':disabled="!uploadSetupComplete || uploading"');
    expect(source).toContain(
      "Boolean(contractId) || uploading || recognizing || !metaReady",
    );
    expect(source).toContain("DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY");
    expect(source).not.toContain("预选分类仅用于自动核验");
    expect(source).not.toContain("预选值不会自动替代识别字段");
    expect(source).toContain("declaredCategory: form.declaredCategory");
    expect(source).toContain("declaredSubtype: form.declaredSubtype");
    expect(source).toContain("FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS");
    expect(source).toContain("assetCategory:");
  });

  it("旧版 DOC 与 PDF、DOCX 使用同一上传入口和服务端格式白名单", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toContain('accept=".pdf,.doc,.docx"');
    expect(source).toContain("/\\.(pdf|doc|docx)$/i");
    expect(source).toContain("仅支持 PDF、DOC、DOCX 合同文件");
    expect(routeSource).toMatch(
      /validateUploadedFile\(req\.file, \[\s*"pdf",\s*"doc",\s*"docx",?\s*\]\)/,
    );
  });

  it("项目与上级合同只允许同区、同类型关联并继承系统二级分类", () => {
    expect(source).toContain("const sameAreaProjects = computed");
    expect(source).toContain(
      'form.area === "全部" || project.area === form.area',
    );
    expect(source).toContain("item.area === form.area");
    expect(source).toContain("item.category === form.declaredCategory");
    expect(source).toContain(
      "parent.declaredSubtype ||\n    DEFAULT_DECLARED_SUBTYPE_BY_CATEGORY",
    );
    expect(source).toContain("projectId: form.projectId || undefined");
    expect(source).toMatch(
      /projectAssociationAllowed\.value\s*\? parent\.projectId \|\| ""\s*: ""/,
    );
    expect(source).toContain("行政区已在上传前锁定");
    expect(source).not.toContain("syncAreaFromProject");
    expect(source).not.toContain("form.area = parent.area");
    expect(source).not.toContain("form.category = parent.category");
  });

  it("关联项目可留空进入下一步，已选择项目仍执行同区校验", () => {
    expect(source).toContain("归属项目（可选，用于经营统计）");
    expect(source).toContain('placeholder="可暂不选择归属项目"');
    expect(source).toContain(
      "关联项目为可选项；未选择时可继续完善合同，选择后用于项目金额累计和经营统计。",
    );
    expect(source).not.toContain(
      ":required=\"form.category === 'main_business'\"",
    );
    expect(source).not.toContain(
      'if (form.category === "main_business" && !form.projectId) return false;',
    );
    expect(source).toContain(
      "!sameAreaProjects.value.some((project) => project.id === form.projectId)",
    );
    expect(source).toContain(
      "projectId: projectAssociationAllowed.value ? form.projectId || null : null",
    );
    expect(source).not.toContain("提交审批前仍需关联项目");
    expect(source).toContain(
      'const approvalTargetLabel = computed(() => "总经理")',
    );
    expect(source).toContain("合同统一提交唯一活动总经理审批");
    expect(source).toContain(
      'const approvalSubmitLabel = computed(() => "提交总经理审批")',
    );
    expect(source).toContain(
      "资产类合同不关联项目，仅需核对合同层级与资产分类。",
    );
    expect(source).toContain('v-if="projectAssociationAllowed"');
    expect(source).toContain('ElMessage.error("资产类合同不能关联项目")');
    expect(source).toContain(
      "projectId: projectAssociationAllowed.value ? form.projectId || null : null",
    );
  });

  it("一级合同不查询上级合同且草稿更新不回传已锁定上级合同", () => {
    expect(source).toContain("一级合同，无需关联上级合同");
    expect(source).not.toContain('value="independent"');
    expect(source).not.toContain("独立合同选项");
    expect(source).toContain("关联项目为可选项；未选择时可继续完善合同");
    expect(source).toContain("const requiresParentContract = computed");
    expect(source).toContain('v-if="requiresParentContract"');
    expect(source).toMatch(
      /if \(requiresParentContract\.value && !contractId\.value\)\s+void loadRelatedContracts\(\);/,
    );
    const payloadStart = source.indexOf("function buildPayload");
    const payloadEnd = source.indexOf("\nwatch(", payloadStart);
    const payloadSource = source.slice(payloadStart, payloadEnd);
    expect(payloadSource).not.toContain("parentContractId");
    expect(source).toMatch(
      /if \(requiresParentContract\.value\) \{\s*await loadRelatedContracts\(true\);\s*\} else \{\s*form\.parentContractId = "";/,
    );
  });

  it("上传创建草稿时同步保存上传前锁定的合同层级与上级合同", () => {
    const apiSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/utils/contractApi.ts"),
      "utf8",
    );
    expect(source).toContain("relationType: selectedRelationType");
    expect(apiSource).toContain(
      'formData.append("relationType", metadata.relationType)',
    );
    expect(source).toContain("合同层级决定金额识别口径，上传后锁定");
    expect(source).toContain("parentContractId: requiresParentContract.value");
    expect(apiSource).toContain(
      'formData.append("parentContractId", metadata.parentContractId)',
    );
    const payloadSource = source.slice(source.indexOf("function buildPayload"));
    expect(payloadSource).not.toContain("relationType: form.relationType");
  });

  it("主合同快速入口只展示继承摘要并调用补充协议专用识别接口", () => {
    expect(source).toContain("quickSupplementParentId");
    expect(source).toContain("quickSupplementMode");
    expect(source).toContain("getContractSupplementUploadContext");
    expect(source).toContain("recognizeSupplementContract");
    expect(source).toContain('v-if="quickAgreementMode"');
    expect(source).toContain("supplement-inherited-panel");
    expect(source).toContain("已继承主合同信息，只需选择补充协议文件");
    expect(source).toContain("applyQuickSupplementContext");
    expect(source).toContain('form.relationType = "supplement"');
    expect(source).toContain(
      "form.parentContractId = context.parentContractId",
    );
    expect(source).toContain("form.projectId =");
    expect(source).toContain("form.partyA = context.partyA");
    expect(source).toContain("form.partyB = context.partyB");
    expect(source).toContain(
      "form.projectName = context.generatedContractName",
    );
    expect(source).toContain("supplementUploadContext.value?.canUpload");
  });

  it("快速补充协议沿用后端生成的补充协议序号名称且不开放项目改写", () => {
    expect(source).toContain(
      "supplementUploadContext.value?.generatedContractName",
    );
    expect(source).toContain(
      "supplementUploadContext.value?.parentContractName",
    );
    expect(source).toContain(
      'v-if="projectAssociationAllowed && !quickAgreementMode"',
    );
    expect(source).toContain(
      "行政区、分类、项目、甲乙方、上级合同及协议名称均已从主合同继承",
    );
  });

  it("补充协议草稿恢复和部分识别都保留服务端生成的带序号名称", () => {
    expect(source).toContain("function isPersistedSupplementName");
    expect(source).toContain(
      "contractId.value && isPersistedSupplementName(form.projectName)",
    );
    expect(source).toContain(
      'ocrFields.value.find(\n    (field) => field.key === "project_name",',
    );
    expect(source).toContain(
      "isPersistedSupplementName(systemInheritedProjectName)",
    );
    expect(source).toContain("String(systemInheritedProjectName).trim()");
  });

  it("仅付款方式补充协议隐藏伪金额并以零增减通过金额规则", () => {
    expect(source).toContain("paymentTermsOnlySupplement");
    expect(source).toContain("仅变更付款方式");
    expect(source).toContain("displayedOcrFields");
    expect(source).toContain(
      'ocrFields.value.filter((field) => field.key !== "amount")',
    );
    expect(source).toContain(
      'v-if="!paymentTermsOnlySupplement && !quickTerminationMode"',
    );
    expect(source).toContain("paymentTermsOnlySupplement.value ? 0");
    expect(source).toContain(
      'supplementChangeType.value === "payment_terms_only"\n      ? ""',
    );
    expect(source).toContain("supplementRecognitionStateReady.value");
  });

  it("识别后只读展示锁定上级合同且候选加载失败不清空", () => {
    const typeSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/types/contract.ts"),
      "utf8",
    );
    const updatePayloadStart = typeSource.indexOf(
      "export interface ContractUpdatePayload",
    );
    const updatePayloadEnd = typeSource.indexOf(
      "export interface ContractRecognitionUploadMetadata",
      updatePayloadStart,
    );
    expect(
      typeSource.slice(updatePayloadStart, updatePayloadEnd),
    ).not.toContain("parentContractId");
    expect(source).toContain(
      '<el-input :model-value="selectedParentContractName" readonly />',
    );
    expect(source).toContain("Boolean(contractId) ||");
    expect(source).toContain(
      "if (contractId.value) return Boolean(form.parentContractId)",
    );
    expect(source).toContain(
      "if (preserveSelection) form.parentContractId = previousParentContractId",
    );
    expect(source).toContain("已保留上传时锁定的关联关系");
    expect(source).not.toContain("上级合同候选加载失败，请重试后重新选择");
  });

  it("保存草稿不回传自动识别核心字段", () => {
    const payloadSource = source.slice(source.indexOf("function buildPayload"));
    expect(payloadSource).not.toContain("partyA: form.partyA");
    expect(payloadSource).not.toContain("partyB: form.partyB");
    expect(payloadSource).not.toContain("contractDate:");
    expect(payloadSource).not.toContain("ocrFields:");
    expect(payloadSource).not.toContain("area: form.area");
    expect(payloadSource).not.toContain("assetCategory: form.assetCategory");
  });

  it("自动识别结果页面保持只读，未通过时只能重新识别", () => {
    expect(source).toContain("未自动通过时只能重新自动识别");
    expect(source).not.toContain(':editable="manualConfirmationAvailable"');
    expect(source).toContain("合同字段不允许手动填写或人工采用");
    expect(source).not.toContain(':reviewed-fields="manualFieldReviewed"');
    expect(source).not.toContain("manualFieldReviewsComplete.value");
    expect(source).not.toContain("confirmContractOcrFields");
    expect(source).not.toContain('title="自动识别诊断"');
    expect(source).not.toContain("ocrJob.warnings.join");
    expect(source).toContain("自动识别未通过安全校验");
  });

  it("资产类合同统一展示合同名称且不展示项目归属语义", () => {
    expect(source).toContain("const subjectNameLabel = computed");
    expect(source).toContain('? "项目名称" : "合同名称"');
    expect(source).toContain(':label="subjectNameLabel"');
    expect(source).toContain("资产类合同自动识别合同名称，不关联项目");
    expect(source).toContain("isAssetContract:");
  });

  it("补充协议上级合同不一致时显示明确原因且不开放字段确认绕过", () => {
    expect(source).toContain('v-if="relationRecognitionBlocker"');
    expect(source).toContain("补充协议关联的上级合同不正确");
    expect(source).toContain("!relationRecognitionBlocker.value");
    expect(source).toContain("原合同当前已撤销或删除");
  });

  it("前端拒绝相同双方及超过两位小数的金额", () => {
    expect(source).toContain("const partiesDifferent = computed");
    expect(source).toContain("const amountPrecisionValid = computed");
    expect(source).toContain("甲方单位与乙方单位不能相同");
    expect(source).toContain("金额最多保留两位小数");
  });

  it("项目候选同时考虑规范化项目名和甲方", () => {
    expect(source).toContain("normalizeProjectMatchText");
    expect(source).toContain("textPairSimilarity");
    expect(source).toContain("项目名与甲方综合匹配");
  });

  it("已上传用印资料的移除会同步到服务端", () => {
    expect(source).toContain("deleteContractFile");
    expect(source).toContain("移除用印资料");
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(routeSource).toContain('router.delete("/:id/files/:fileId"');
    expect(routeSource).toContain("'file_removed'");
  });

  it("用印阶段必须在线电子签名且不提前收取三联单和请款资料", () => {
    expect(source).toContain("<ContractSealApplicationEditor");
    expect(source).toContain('@sign="signCurrentSealApplication"');
    expect(source).toContain("return sealApplicationSigned.value");
    expect(source).toContain("申请人已签署用印申请单");
    expect(source).toContain(':signed-file-url="sealApplicationSignedFileUrl"');
    expect(source).toContain("sealApplication.value?.signedFileId");
    expect(source).toContain("getContractFileUrl(fileId)");
    expect(source).toContain(
      "三联单、请款资料在实际付款环节按需补充，本阶段不要求上传。",
    );
    expect(source).toContain(
      "合同内容刚刚发生变化，请返回上一步重新确认并电子签名用印申请单。",
    );

    const optionsStart = source.indexOf("const supportingFileOptions");
    const optionsEnd = source.indexOf(
      "const supportingRequirementText",
      optionsStart,
    );
    const optionsSource = source.slice(optionsStart, optionsEnd);
    expect(optionsSource).toContain('value: "other"');
    expect(optionsSource).not.toContain("triplicate");
    expect(optionsSource).not.toContain("payment_request");
    expect(optionsSource).not.toContain("seal_application");

    const editorSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractSealApplicationEditor.vue",
      ),
      "utf8",
    );
    expect(editorSource).toContain("申请单为单页并预留总经理审批签字区");
    expect(editorSource).toContain("申请人已签署");
    expect(editorSource).toContain("待申请人签署");
    expect(editorSource).toContain("将在同页预留栏完成审批签字");
    expect(editorSource).toContain("申请人本人签字处");
    expect(editorSource).toContain("本人签字位置");
    expect(editorSource).toContain("<ContractSealApplicationApprovalPreview");
    expect(editorSource).toContain('v-if="signed && signedFileUrl"');
  });
});
