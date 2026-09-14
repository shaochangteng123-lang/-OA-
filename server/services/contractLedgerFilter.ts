/** 合同台账的行政区归属固定取根合同，子协议异常区域值不得改变合同族筛选结果。 */
export const CONTRACT_LEDGER_ROOT_AREA_FILTER_SQL = `EXISTS (
  SELECT 1
  FROM contracts ledger_area_root
  WHERE ledger_area_root.id = COALESCE(c.root_contract_id, c.id)
    AND ledger_area_root.is_deleted = FALSE
    AND ledger_area_root.area = ?
)`;
