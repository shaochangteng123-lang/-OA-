import { PDFDocument } from "pdf-lib";
import {
  parseAssetAgreementFieldsXml,
  parseContractTemplateDateFieldsXml,
  parseContractTemplatePositionFieldXml,
  parseEmployeeNumberFieldXml,
  parseEmployeeNumberFieldsXml,
  writeAssetAgreementFieldsToPdfBytes,
  writeContractTemplateDatesToPdfBytes,
  writeContractTemplatePositionToPdfBytes,
  writeEmployeeNumberToPdfBytes,
} from "../server/services/onboardingTemplateNumber";

const buildXml = (body: string) => `
  <pdf2xml>
    <page number="1" position="absolute" top="0" left="0" height="1262" width="892">
      <fontspec id="1" size="16" family="sans" color="#000000"/>
      ${body}
    </page>
  </pdf2xml>
`;

describe("入职模板员工编号写入", () => {
  it("识别空白的员工编号位置", () => {
    const anchor = parseEmployeeNumberFieldXml(
      buildXml(
        '<text top="127" left="716" width="79" height="18" font="1">员工编号：</text>',
      ),
    );

    expect(anchor).not.toBeNull();
    expect(anchor?.hasSeparator).toBe(true);
    expect(anchor?.label.left).toBe(716);
    expect(anchor?.value).toBeNull();
  });

  it("识别并覆盖与标签分开的已有编号", () => {
    const anchor = parseEmployeeNumberFieldXml(
      buildXml(`
      <text top="155" left="697" width="47" height="18" font="1">编号：</text>
      <text top="152" left="744" width="79" height="23" font="1">YULI-CS027</text>
    `),
    );

    expect(anchor?.hasSeparator).toBe(true);
    expect(anchor?.value).toMatchObject({ left: 744, width: 79 });
  });

  it("忽略正文和页面下半区的编号字样", () => {
    const anchor = parseEmployeeNumberFieldXml(
      buildXml(
        '<text top="900" left="650" width="120" height="18" font="1">编号：</text>',
      ),
    );

    expect(anchor).toBeNull();
  });

  it("识别入职邀请函每一页的编号位置", () => {
    const anchors = parseEmployeeNumberFieldsXml(
      `
      <pdf2xml>
        <page number="1" height="1262" width="892">
          <fontspec id="1" size="18" color="#000000"/>
          <text top="155" left="689" width="47" height="18" font="1">编号：</text>
        </page>
        <page number="2" height="1262" width="892">
          <fontspec id="2" size="18" color="#000000"/>
          <text top="155" left="689" width="47" height="18" font="2">编号：</text>
        </page>
      </pdf2xml>
    `,
      "invitation",
    );

    expect(anchors).toHaveLength(2);
    expect(anchors.map((anchor) => anchor.pageIndex)).toEqual([0, 1]);
  });

  it("识别劳动合同首页黑色编号和后续页蓝色合同编号", () => {
    const anchors = parseEmployeeNumberFieldsXml(
      `
      <pdf2xml>
        <page number="1" height="1262" width="892">
          <fontspec id="1" size="24" color="#000000"/>
          <text top="215" left="574" width="48" height="27" font="1">编号：</text>
        </page>
        <page number="2" height="1262" width="892">
          <fontspec id="2" size="14" color="#3178b4"/>
          <text top="68" left="115" width="139" height="20" font="2">合同编号：YULI-CS026</text>
        </page>
      </pdf2xml>
    `,
      "contract",
    );

    expect(anchors).toHaveLength(2);
    expect(anchors[0].textColor).toEqual({ red: 0, green: 0, blue: 0 });
    expect(anchors[1].textColor).toEqual({
      red: 0x31 / 255,
      green: 0x78 / 255,
      blue: 0xb4 / 255,
    });
    expect(anchors[1].value?.left).toBeGreaterThan(anchors[1].label.left);
  });

  it("写入后仍生成可读取的单页 PDF", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const output = await writeEmployeeNumberToPdfBytes(
      sourceBytes,
      "YULI-CS123",
      {
        pageWidth: 892,
        pageHeight: 1262,
        hasSeparator: true,
        label: { top: 120, left: 690, width: 48, height: 20, fontSize: 16 },
        value: null,
      },
    );

    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(1);
    expect(output.length).toBeGreaterThan(sourceBytes.length);
  });

  it("可在多页 PDF 中分别写入员工编号", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const output = await writeEmployeeNumberToPdfBytes(
      sourceBytes,
      "YULI-CS123",
      [
        {
          pageIndex: 0,
          pageWidth: 892,
          pageHeight: 1262,
          hasSeparator: true,
          label: { top: 120, left: 690, width: 48, height: 20, fontSize: 16 },
          value: null,
        },
        {
          pageIndex: 1,
          pageWidth: 892,
          pageHeight: 1262,
          hasSeparator: true,
          label: { top: 68, left: 115, width: 66, height: 20, fontSize: 14 },
          value: { top: 65, left: 181, width: 92, height: 25, fontSize: 14 },
          textColor: { red: 0x31 / 255, green: 0x78 / 255, blue: 0xb4 / 255 },
        },
      ],
    );

    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(2);
    expect(output.length).toBeGreaterThan(sourceBytes.length);
  });
});

describe("劳动合同模板日期写入", () => {
  const contractDateXml = `
    <pdf2xml>
      <page number="1" height="1262" width="892">
        <fontspec id="1" size="21" color="#000000"/>
        <text top="861" left="158" width="21" height="24" font="1">自</text>
        <text top="861" left="231" width="21" height="24" font="1">年</text>
        <text top="861" left="294" width="21" height="24" font="1">月</text>
        <text top="861" left="357" width="63" height="24" font="1">日起至</text>
        <text top="861" left="473" width="21" height="24" font="1">年</text>
        <text top="861" left="536" width="21" height="24" font="1">月</text>
        <text top="861" left="599" width="42" height="24" font="1">日。</text>
        <text top="898" left="158" width="147" height="24" font="1">其中，试用期自</text>
        <text top="898" left="357" width="21" height="24" font="1">年</text>
        <text top="898" left="420" width="21" height="24" font="1">月</text>
        <text top="898" left="483" width="63" height="24" font="1">日起至</text>
        <text top="898" left="599" width="21" height="24" font="1">年</text>
        <text top="898" left="662" width="21" height="24" font="1">月</text>
        <text top="898" left="725" width="42" height="24" font="1">日。</text>
      </page>
    </pdf2xml>
  `;

  it("识别合同期限和试用期的八个日期空位", () => {
    const fields = parseContractTemplateDateFieldsXml(contractDateXml);

    expect(fields).not.toBeNull();
    expect(fields?.contract.start.year).toMatchObject({ left: 179, width: 52 });
    expect(fields?.contract.end.day).toMatchObject({ left: 557, width: 42 });
    expect(fields?.probation.start.year).toMatchObject({ left: 305, width: 52 });
    expect(fields?.probation.end.day).toMatchObject({ left: 683, width: 42 });
  });

  it("写入日期后仍生成可读取的 PDF", async () => {
    const fields = parseContractTemplateDateFieldsXml(contractDateXml);
    expect(fields).not.toBeNull();

    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const output = await writeContractTemplateDatesToPdfBytes(
      sourceBytes,
      {
        contractStartDate: "2026-08-01",
        contractEndDate: "2027-07-31",
        probationStartDate: "2026-08-01",
        probationEndDate: "2026-10-31",
      },
      fields!,
    );

    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(1);
    expect(output.length).toBeGreaterThan(sourceBytes.length);
  });
});

describe("劳动合同模板职位写入", () => {
  const contractPositionXml = `
    <pdf2xml>
      <page number="2" height="1262" width="892">
        <fontspec id="1" size="21" color="#000000"/>
        <text top="1048" left="115" width="63" height="24" font="1">第四条</text>
        <text top="1086" left="158" width="505" height="24" font="1">乙方同意根据甲方工作需要，担任报批报建部专员岗位</text>
        <text top="1086" left="673" width="42" height="24" font="1">工种</text>
      </page>
    </pdf2xml>
  `;

  it("识别第四条示例职位文字区域", () => {
    const field = parseContractTemplatePositionFieldXml(contractPositionXml);

    expect(field).not.toBeNull();
    expect(field?.pageIndex).toBe(0);
    expect(field?.value.left).toBeCloseTo(473.625, 2);
    expect(field?.value.width).toBeCloseTo(147.292, 2);
  });

  it("识别拆分文字块之间的空白职位区域", () => {
    const field = parseContractTemplatePositionFieldXml(`
      <pdf2xml>
        <page number="2" height="1262" width="892">
          <fontspec id="1" size="21" color="#000000"/>
          <text top="1048" left="115" width="21" height="24" font="1">第</text>
          <text top="1048" left="136" width="42" height="24" font="1">四条</text>
          <text top="1086" left="158" width="315" height="24" font="1">乙方同意根据甲方工作需要，担任</text>
          <text top="1086" left="620" width="168" height="24" font="1">岗位(工种)工作。</text>
        </page>
      </pdf2xml>
    `);

    expect(field).not.toBeNull();
    expect(field?.pageIndex).toBe(0);
    expect(field?.value.left).toBeCloseTo(473, 2);
    expect(field?.value.width).toBeCloseTo(147, 2);
  });

  it("识别同一文字块中由连续空格保留的空白职位区域", () => {
    const field = parseContractTemplatePositionFieldXml(`
      <pdf2xml>
        <page number="2" height="1262" width="892">
          <fontspec id="1" size="21" color="#000000"/>
          <text top="1048" left="115" width="63" height="24" font="1">第四条</text>
          <text top="1086" left="158" width="630" height="24" font="1">乙方同意根据甲方工作需要，担任               岗位(工种)工作。</text>
        </page>
      </pdf2xml>
    `);

    expect(field).not.toBeNull();
    expect(field?.value.width).toBeGreaterThan(100);
  });

  it("覆盖示例职位并生成可读取的 PDF", async () => {
    const field = parseContractTemplatePositionFieldXml(contractPositionXml);
    expect(field).not.toBeNull();

    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const output = await writeContractTemplatePositionToPdfBytes(
      sourceBytes,
      "项目经理",
      field!,
    );

    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(1);
    expect(output.length).toBeGreaterThan(sourceBytes.length);
  });
});

describe("电脑管理办法协议自动填充", () => {
  const assetAgreementXml = `
    <pdf2xml>
      <page number="1" height="1262" width="892">
        <fontspec id="1" size="16" color="#000000"/>
        <text top="126" left="690" width="47" height="18" font="1">编号：</text>
        <text top="220" left="300" width="292" height="24" font="1">附件1 笔记本电脑协议书</text>
        <text top="305" left="130" width="407" height="24" font="1">甲方（单位）：北京羽隶工程咨询有限公司</text>
        <text top="345" left="130" width="260" height="24" font="1">乙方（员工）：__________</text>
        <text top="385" left="130" width="310" height="24" font="1">身份证号码：__________________</text>
      </page>
      <page number="2" height="1262" width="892">
        <fontspec id="2" size="16" color="#000000"/>
        <text top="126" left="690" width="47" height="18" font="2">编号：</text>
      </page>
    </pdf2xml>
  `;

  it("识别每页编号、甲方、乙方和身份证号码字段", () => {
    const fields = parseAssetAgreementFieldsXml(assetAgreementXml);

    expect(fields).not.toBeNull();
    expect(fields?.employeeNumbers).toHaveLength(2);
    expect(fields?.employeeNumbers.map((anchor) => anchor.pageIndex)).toEqual([0, 1]);
    expect(fields?.employeeNumbers[0].label.left).toBe(690);
    expect(fields?.partyA.cover).toBeDefined();
    expect(fields?.partyB.underline).toBe(true);
    expect(fields?.idNumber.underline).toBe(true);
  });

  it("写入协议字段后仍生成可读取的 PDF", async () => {
    const fields = parseAssetAgreementFieldsXml(assetAgreementXml);
    expect(fields).not.toBeNull();

    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const numbered = await writeEmployeeNumberToPdfBytes(
      sourceBytes,
      "YULI-CS123",
      fields!.employeeNumbers,
    );
    const output = await writeAssetAgreementFieldsToPdfBytes(
      numbered,
      {
        companyName: "北京羽隶工程咨询有限公司",
        employeeName: "张三",
        idNumber: "110101199001010000",
      },
      fields!,
    );

    const result = await PDFDocument.load(output);
    expect(result.getPageCount()).toBe(2);
    expect(output.length).toBeGreaterThan(sourceBytes.length);
  });
});
