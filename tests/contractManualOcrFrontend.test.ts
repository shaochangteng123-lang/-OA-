import fs from "fs";
import path from "path";
import ContractOcrFieldEditor from "@/components/contracts/ContractOcrFieldEditor.vue";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("合同识别结果仅允许系统自动采用", () => {
  const createSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractCreate.vue"),
    "utf8",
  );
  const editorSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/contracts/ContractOcrFieldEditor.vue",
    ),
    "utf8",
  );
  const apiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/utils/contractApi.ts"),
    "utf8",
  );
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );

  it("部分结果只展示诊断和重新识别，不开放人工输入或采用", () => {
    expect(createSource).toContain("automaticRecognitionBlocked");
    expect(createSource).toContain("合同字段不允许手动填写或人工采用");
    expect(createSource).toContain("重新自动识别");
    expect(createSource).not.toContain("manualConfirmationAvailable");
    expect(createSource).not.toContain("确认并采用识别结果");
    expect(editorSource).not.toContain("field-editor");
    expect(editorSource).not.toContain("update-field");
    expect(editorSource).not.toContain("人工确认值");
    expect(apiSource).not.toContain("confirmContractOcrFields");
  });

  it("服务端稳定拒绝旧客户端人工确认请求", () => {
    expect(routeSource).toContain('"/:id/ocr-jobs/:jobId/confirm"');
    expect(routeSource).toContain("OCR_MANUAL_CONFIRMATION_DISABLED");
    expect(routeSource).toContain("合同字段只允许系统自动识别");
    expect(routeSource).not.toContain(
      "reviewedFields: req.body?.reviewedFields",
    );
  });

  it("识别结果继续展示原始转写和诊断语义", () => {
    expect(editorSource).toContain(
      'accepted ? "精准识别依据" : "未采用识别转写"',
    );
    expect(editorSource).toContain("解析候选：{{ field.rawText }}");
    expect(editorSource).toContain("诊断分 ${confidence}（不是正确率）");
    expect(editorSource).not.toContain("Math.round(confidence)");
  });

  it("金额字段在任意识别状态下都不展开整段原文，但保留页码和必要告警", () => {
    expect(createSource).toContain(':relation-type="form.relationType"');
    expect(editorSource).toContain("shouldShowEvidence(field)");
    expect(editorSource).toContain("shouldShowRawText(field)");
    expect(editorSource).toContain("shouldHideVerboseRecognitionText(field)");
    expect(editorSource).toContain('field.key === "amount"');

    const verboseEvidence = "补充协议书".repeat(80);
    const verboseRawText = "合同全文转写".repeat(80);
    const wrapper = mount(ContractOcrFieldEditor, {
      props: {
        accepted: false,
        relationType: "main",
        fields: [
          {
            key: "amount",
            label: "合同金额",
            value: "114000.00",
            rawText: verboseRawText,
            evidenceText: verboseEvidence,
            confidence: 99,
            pageNumber: 6,
            required: true,
            warning: "金额需按变更口径核验",
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("¥ 114000.00");
    expect(wrapper.text()).toContain("来源：第 6 页");
    expect(wrapper.text()).toContain("金额需按变更口径核验");
    expect(wrapper.text()).not.toContain(verboseEvidence);
    expect(wrapper.text()).not.toContain(verboseRawText);
    expect(wrapper.text()).not.toContain("精准识别依据");
    expect(wrapper.text()).not.toContain("未采用识别转写");
    expect(wrapper.text()).not.toContain("解析候选");
    wrapper.unmount();
  });

  it("非金额字段仍展示识别证据供安全核验", () => {
    const wrapper = mount(ContractOcrFieldEditor, {
      props: {
        accepted: true,
        relationType: "supplement",
        fields: [
          {
            key: "party_a",
            label: "甲方单位",
            value: "国网北京市电力公司",
            rawText: "甲方：国网北京市电力公司",
            evidenceText: "甲方：国网北京市电力公司",
            confidence: 100,
            pageNumber: 1,
            required: true,
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("精准识别依据：甲方：国网北京市电力公司");
    wrapper.unmount();
  });

  it("资产类识别字段将底层项目字段展示为合同名称", () => {
    expect(editorSource).toContain('field.key === "project_name"');
    expect(editorSource).toContain('props.declaredCategory === "asset"');
    expect(editorSource).toContain('return "合同名称"');
    expect(editorSource).toContain("displayLabel(field)");
  });
});
