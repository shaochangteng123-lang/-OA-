/** @jest-environment jsdom */

import { api } from "../src/utils/api";
import {
  deletePersonalSignature,
  loadPersonalSignature,
  savePersonalSignature,
} from "../src/utils/personalSignature";

jest.mock("../src/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  delete: jest.Mock;
};

describe("个人电子签名", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("未保存签名时不请求图片", async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          signatureType: "personal",
          ownerName: "测试员工",
          hasSignature: false,
          updatedAt: null,
        },
      },
    });

    await expect(loadPersonalSignature()).resolves.toBeNull();
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(mockedApi.get).toHaveBeenCalledWith("/api/auth/signature", {
      params: { type: "personal" },
    });
  });

  it("读取本人签名并转换为可提交的数据地址", async () => {
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            signatureType: "personal",
            ownerName: "测试员工",
            hasSignature: true,
            updatedAt: "2026-07-24T08:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      });

    await expect(loadPersonalSignature()).resolves.toEqual({
      signatureType: "personal",
      ownerName: "测试员工",
      dataUrl: "data:image/png;base64,iVBORw==",
      updatedAt: "2026-07-24T08:00:00.000Z",
    });
    expect(mockedApi.get).toHaveBeenNthCalledWith(
      2,
      "/api/auth/signature/image",
      {
        params: { type: "personal" },
        responseType: "arraybuffer",
      },
    );
  });

  it("保存后重新读取服务器处理后的签名", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            signatureType: "personal",
            ownerName: "测试员工",
            hasSignature: true,
            updatedAt: "2026-07-24T09:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      });

    const result = await savePersonalSignature(
      "data:image/png;base64,iVBORw==",
    );
    expect(mockedApi.post).toHaveBeenCalledWith("/api/auth/signature", {
      signatureDataUrl: "data:image/png;base64,iVBORw==",
      signatureType: "personal",
    });
    expect(result?.updatedAt).toBe("2026-07-24T09:00:00.000Z");
  });

  it("删除当前账号保存的签名", async () => {
    mockedApi.delete.mockResolvedValueOnce({ data: { success: true } });

    await deletePersonalSignature();
    expect(mockedApi.delete).toHaveBeenCalledWith("/api/auth/signature", {
      params: { type: "personal" },
    });
  });

  it("管理员可独立保存并读取总经理签名", async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true } });
    mockedApi.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            signatureType: "general_manager",
            ownerName: "测试总经理",
            hasSignature: true,
            updatedAt: "2026-07-24T10:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      });

    const result = await savePersonalSignature(
      "data:image/png;base64,iVBORw==",
      "general_manager",
    );

    expect(mockedApi.post).toHaveBeenCalledWith("/api/auth/signature", {
      signatureDataUrl: "data:image/png;base64,iVBORw==",
      signatureType: "general_manager",
    });
    expect(result).toMatchObject({
      signatureType: "general_manager",
      ownerName: "测试总经理",
    });
  });
});
