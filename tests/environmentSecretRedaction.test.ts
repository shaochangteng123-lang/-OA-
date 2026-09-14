import fs from "node:fs";
import path from "node:path";

describe("生产启动日志敏感信息保护", () => {
  const entrypointSource = fs.readFileSync(
    path.resolve(process.cwd(), "docker-entrypoint.sh"),
    "utf8",
  );
  const environmentCheckSource = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/check-env.js"),
    "utf8",
  );
  const serverSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/index.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );

  it("容器启动脚本不输出数据库连接地址", () => {
    expect(entrypointSource).toContain("数据库: 已配置（敏感信息不输出）");
    expect(entrypointSource).not.toContain(
      'echo "  - 数据库: ${DATABASE_URL',
    );
  });

  it("环境检查只输出配置状态而不输出连接地址", () => {
    expect(environmentCheckSource).toContain(
      "已配置（敏感信息不输出）",
    );
    expect(environmentCheckSource).not.toContain("数据库: ${dbUrl ||");
  });

  it("服务启动和数据库模块同样不输出连接地址", () => {
    expect(serverSource).toContain("数据库: ${process.env.DATABASE_URL ?");
    expect(serverSource).not.toContain("✅ Database: ${process.env.DATABASE_URL");
    expect(databaseSource).toContain(
      "数据库连接: 已配置（敏感信息不输出）",
    );
    expect(databaseSource).not.toContain("connectionString.replace");
  });
});
