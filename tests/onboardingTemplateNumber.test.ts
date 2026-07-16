import { PDFDocument } from "pdf-lib";
import {
  parseEmployeeNumberFieldXml,
  parseEmployeeNumberFieldsXml,
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
