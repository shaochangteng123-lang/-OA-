export interface ContractTemplateCycleClient {
  query: (
    sql: string,
    params: unknown[],
  ) => Promise<{ rowCount: number | null }>
}

export async function closeContractTemplateCycle(
  client: ContractTemplateCycleClient,
  employeeId: string,
  updatedAt: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE employee_profiles
     SET last_contract_template_start_date = CASE
           WHEN contract_template_start_date IS NOT NULL
             AND contract_template_end_date IS NOT NULL
           THEN contract_template_start_date
           ELSE last_contract_template_start_date
         END,
         last_contract_template_end_date = CASE
           WHEN contract_template_start_date IS NOT NULL
             AND contract_template_end_date IS NOT NULL
           THEN contract_template_end_date
           ELSE last_contract_template_end_date
         END,
         last_probation_template_start_date = CASE
           WHEN contract_template_start_date IS NOT NULL
             AND contract_template_end_date IS NOT NULL
           THEN probation_template_start_date
           ELSE last_probation_template_start_date
         END,
         last_probation_template_end_date = CASE
           WHEN contract_template_start_date IS NOT NULL
             AND contract_template_end_date IS NOT NULL
           THEN probation_template_end_date
           ELSE last_probation_template_end_date
         END,
         last_contract_template_position = CASE
           WHEN contract_template_start_date IS NOT NULL
             AND contract_template_end_date IS NOT NULL
           THEN COALESCE(NULLIF(BTRIM(position), ''), last_contract_template_position)
           ELSE last_contract_template_position
         END,
         contract_template_start_date = NULL,
         contract_template_end_date = NULL,
         probation_template_start_date = NULL,
         probation_template_end_date = NULL,
         updated_at = $1
     WHERE id = $2`,
    [updatedAt, employeeId],
  )

  return (result.rowCount ?? 0) > 0
}
