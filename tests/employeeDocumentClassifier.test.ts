import {
  classifyEmployeeDocumentPageStartText,
  classifyEmployeeDocumentText,
  detectUnsupportedEmployeeDocumentPageStartText,
} from "../server/services/employeeDocumentClassifier";

describe("人事档案自动分类", () => {
  it.each([
    ["附件.pdf", "入职邀请函 年保障薪酬 月保障薪酬", "invitation"],
    ["附件.pdf", "新员工入职申请表 紧急联系人", "application"],
    ["附件.pdf", "劳动合同书 甲方 乙方 合同期限", "contract"],
    ["附件.pdf", "保密协议 保密义务 商业秘密", "nda"],
    ["附件.pdf", "个人声明 本人郑重声明 声明人", "declaration"],
    ["附件.pdf", "2025年度公司电脑管理办法 电脑领用", "asset_handover"],
    ["附件.pdf", "中华人民共和国居民身份证 公民身份号码", "id_card"],
    ["附件.pdf", "入职体检报告 体检结论", "health_report"],
    ["附件.pdf", "普通高等学校 毕业证书", "diploma"],
    ["附件.pdf", "中国工商银行 借记卡 卡号", "bank_card"],
  ])("按第一页标题识别 %s", (filename, text, expectedType) => {
    const result = classifyEmployeeDocumentText(filename, text);

    expect(result.status).toBe("success");
    expect(result.documentType).toBe(expectedType);
  });

  it("兼容旧文件类型名称", () => {
    expect(
      classifyEmployeeDocumentText("固定资产交接单.pdf").documentType,
    ).toBe("asset_handover");
    expect(classifyEmployeeDocumentText("邀请函.pdf").documentType).toBe(
      "invitation",
    );
  });

  it("正文标题可纠正错误文件名", () => {
    const result = classifyEmployeeDocumentText(
      "邀请函.pdf",
      "劳动合同书 甲方 乙方 合同期限",
    );

    expect(result.documentType).toBe("contract");
    expect(result.source).toBe("text");
  });

  it("无法明确判断时不自动归档", () => {
    const result = classifyEmployeeDocumentText("员工资料.pdf", "姓名 张三");

    expect(result.status).toBe("uncertain");
    expect(result.documentType).toBeNull();
  });

  it("按页面首页标题识别边界，不依赖文件内类型顺序", () => {
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "北京羽隶工程咨询有限公司\n保密协议\n甲方与乙方",
      ).documentType,
    ).toBe("nda");
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "中国工商银行\n牡丹灵通卡\n借记卡\n卡号",
      ).documentType,
    ).toBe("bank_card");
    expect(
      classifyEmployeeDocumentPageStartText(
        "员工整套档案.pdf",
        "中华人民共和国\n居民身份证\n公民身份号码",
      ).documentType,
    ).toBe("id_card");
  });

  it("材料正文提到其他文件时不误判为新边界", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      "员工离职证明（员工联）\n根据劳动合同法第三十七条解除劳动合同",
    );

    expect(result.status).toBe("uncertain");
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "员工离职证明（员工联）\n根据劳动合同法第三十七条解除劳动合同",
      ),
    ).toBe("员工离职证明");
  });

  it("通用资料标题识别为其他材料边界，但合同附件标题不单独拆分", () => {
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "社会保险个人权益记录\n姓名 张三",
      ),
    ).toBe("其他资料：社会保险个人权益记录");
    expect(
      detectUnsupportedEmployeeDocumentPageStartText(
        "附件三：个人声明\n第三十条 本合同未尽事宜",
      ),
    ).toBeNull();
  });

  it("横向学历证书标题被拆散时仍按组合特征识别", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      [
        "格，准予毕业",
        "专业",
        "证书编号：140731201606000863",
        "学生姓名",
        "业",
        "普通高等学校",
        "科学习，修完教学计划规定的全部课程，成绩合格",
        "证书",
        "中华人民共和国教育部学历证书查询网址",
      ].join("\n"),
    );

    expect(result.documentType).toBe("diploma");
  });

  it("入职申请表中的材料清单不会被当成学历证书首页", () => {
    const result = classifyEmployeeDocumentPageStartText(
      "员工整套档案.pdf",
      "新员工入职申请表\n身份证复印件\n学历证书复印件\n工资卡复印件",
    );

    expect(result.documentType).toBe("application");
  });
});
