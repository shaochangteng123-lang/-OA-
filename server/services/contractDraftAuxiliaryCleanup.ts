import type { PoolClient } from "pg";

/**
 * 合同草稿永久删除前读取辅助档案附件路径。查询放在辅助域边界内，正式
 * 合同服务只消费路径结果，不直接读写辅助档案业务数据。
 */
export async function collectContractAuxiliaryDraftStoredPaths(
  client: PoolClient,
  contractId: string,
): Promise<string[]> {
  const result = await client.query<{ file_path: string }>(
    `SELECT auxiliary_file.file_path
     FROM contract_auxiliary_files auxiliary_file
     JOIN contract_auxiliary_packages package
       ON package.id = auxiliary_file.package_id
     WHERE package.parent_contract_id = $1`,
    [contractId],
  );
  return result.rows.map((row) => row.file_path);
}
