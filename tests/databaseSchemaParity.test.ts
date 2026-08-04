jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    query: jest.fn(),
    connect: jest.fn(),
  })),
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  })),
  types: {
    setTypeParser: jest.fn(),
  },
}));

import {
  assertRequiredDatabaseSchema,
  type DatabaseColumnReader,
} from "../server/db/index";

function createColumnReader(
  rows: Array<{ table_name: string; column_name: string }>,
) {
  const allMock = jest.fn(async (..._args: unknown[]) => rows);
  const database: DatabaseColumnReader = {
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      await allMock(sql, ...params);
      return rows as unknown as T[];
    },
  };

  return { database, allMock };
}

describe("数据库必需字段校验", () => {
  it("生产旧库缺少转正申请备注字段时阻止服务继续启动", async () => {
    const { database } = createColumnReader([]);

    await expect(assertRequiredDatabaseSchema(database)).rejects.toThrow(
      "转正申请备注（probation_confirmations.application_comment）",
    );
  });

  it("必需字段已完成迁移时通过校验", async () => {
    const { database, allMock } = createColumnReader([
      {
        table_name: "probation_confirmations",
        column_name: "application_comment",
      },
    ]);

    await expect(
      assertRequiredDatabaseSchema(database),
    ).resolves.toBeUndefined();
    expect(allMock).toHaveBeenCalledWith(
      expect.stringContaining("table_schema = current_schema()"),
      ["probation_confirmations"],
    );
  });
});
