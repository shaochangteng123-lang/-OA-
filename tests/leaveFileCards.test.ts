import LeaveFileCards from "../src/components/leave/LeaveFileCards.vue";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const LONG_FILE_NAME =
  "这是一份用于验证请假附件完整文件名展示的三甲医院诊断证明材料-2026年07月17日.pdf";

const globalStubs = {
  "el-icon": {
    template: "<span><slot /></span>",
  },
  "el-button": {
    emits: ["click"],
    template:
      '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
  "el-tooltip": {
    template: "<span><slot /></span>",
  },
};

describe("请假附件方框", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("完整展示长文件名并允许移除", async () => {
    const wrapper = mount(LeaveFileCards, {
      props: {
        items: [
          {
            key: "local-file",
            name: LONG_FILE_NAME,
            size: 2048,
            previewFile: new Blob(["test"], { type: "application/pdf" }),
            removable: true,
          },
        ],
      },
      global: { stubs: globalStubs },
    });

    expect(wrapper.get(".file-name").text()).toBe(LONG_FILE_NAME);
    expect(wrapper.get(".file-name").attributes("title")).toBe(LONG_FILE_NAME);
    expect(wrapper.get(".file-size").text()).toBe("2.0 KB");

    await wrapper
      .get(`[aria-label="移除文件：${LONG_FILE_NAME}"]`)
      .trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["local-file"]]);
  });

  it("本地文件可在提交前打开预览", async () => {
    jest.useFakeTimers();
    const createObjectURL = jest.fn(() => "blob:leave-file-preview");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const previewWindow = { opener: window } as unknown as Window;
    const openWindow = jest
      .spyOn(window, "open")
      .mockReturnValue(previewWindow);
    const file = new Blob(["test"], { type: "application/pdf" });

    const wrapper = mount(LeaveFileCards, {
      props: {
        items: [{ key: "local-file", name: LONG_FILE_NAME, previewFile: file }],
      },
      global: { stubs: globalStubs },
    });

    await wrapper.get("button").trigger("click");
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(openWindow).toHaveBeenCalledWith(
      "blob:leave-file-preview",
      "_blank",
    );
    expect(previewWindow.opener).toBeNull();

    jest.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:leave-file-preview");
  });

  it("已提交附件同时提供鉴权预览和下载入口", () => {
    const attachmentUrl = "/api/leave/attachments/attachment-1/download";
    const wrapper = mount(LeaveFileCards, {
      props: {
        items: [
          {
            key: "attachment-1",
            name: LONG_FILE_NAME,
            previewUrl: attachmentUrl,
            downloadUrl: attachmentUrl,
          },
        ],
      },
      global: { stubs: globalStubs },
    });

    const links = wrapper.findAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].attributes("href")).toBe(attachmentUrl);
    expect(links[0].attributes("target")).toBe("_blank");
    expect(links[1].attributes("href")).toBe(attachmentUrl);
    expect(links[1].attributes("download")).toBe(LONG_FILE_NAME);
  });
});
