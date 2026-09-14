export interface FinancialReimbursementScopeNode {
  id: string;
  parentId: string | null;
  name: string;
  value: string;
}

export interface FinancialReimbursementScopeResolution {
  value: string | null;
  path: string | null;
  region: string | null;
  source: string;
}

export function unknownFinancialReimbursementScope(
  value: string | null | undefined,
  reason = "报销范围值未匹配到完整层级配置",
): FinancialReimbursementScopeResolution {
  return {
    value: value?.trim() || null,
    path: null,
    region: null,
    source: `${reason}，行政区未知；未使用合同区域、服务对象或项目名称猜测`,
  };
}

/** 只解析财务区配置的父链；相同叶名称并不代表同一行政区，配置重复也不复制业务金额。 */
export function buildFinancialReimbursementScopeMap(
  rows: readonly FinancialReimbursementScopeNode[],
): Map<string, FinancialReimbursementScopeResolution> {
  const byId = new Map<string, FinancialReimbursementScopeNode[]>();
  const byValue = new Map<string, FinancialReimbursementScopeNode[]>();
  for (const raw of rows) {
    const node = {
      id: raw.id?.trim(),
      parentId: raw.parentId?.trim() || null,
      name: raw.name?.trim(),
      value: raw.value?.trim(),
    };
    if (!node.id || !node.value) continue;
    byId.set(node.id, [...(byId.get(node.id) || []), node]);
    byValue.set(node.value, [...(byValue.get(node.value) || []), node]);
  }
  const pathFor = (leaf: FinancialReimbursementScopeNode) => {
    const path: FinancialReimbursementScopeNode[] = [];
    const visited = new Set<string>();
    let current: FinancialReimbursementScopeNode | undefined = leaf;
    while (current) {
      if (visited.has(current.id) || !current.name) return null;
      visited.add(current.id);
      const matches = byId.get(current.id) || [];
      if (
        new Set(
          matches.map((node) =>
            JSON.stringify([node.parentId, node.name, node.value]),
          ),
        ).size !== 1
      )
        return null;
      path.unshift(current);
      if (!current.parentId) return path;
      const parents = byId.get(current.parentId);
      if (!parents?.length) return null;
      current = parents[0];
    }
    return null;
  };
  const result = new Map<string, FinancialReimbursementScopeResolution>();
  for (const [value, candidates] of byValue) {
    const paths = candidates.map(pathFor);
    if (paths.some((path) => !path)) {
      result.set(
        value,
        unknownFinancialReimbursementScope(
          value,
          "报销范围父链缺失、循环或编号冲突",
        ),
      );
      continue;
    }
    const variants = new Map(
      paths.map((path) => {
        const nodes = path!;
        return [
          JSON.stringify(nodes.map((node) => [node.name, node.value])),
          nodes,
        ] as const;
      }),
    );
    if (variants.size !== 1) {
      result.set(
        value,
        unknownFinancialReimbursementScope(
          value,
          "同一报销范围值对应不同父级区域或路径",
        ),
      );
      continue;
    }
    const nodes = [...variants.values()][0];
    const path = nodes.map((node) => node.name).join(" / ");
    const region = nodes[0].name;
    if (path.length > 1000) {
      result.set(
        value,
        unknownFinancialReimbursementScope(
          value,
          "报销范围路径超出可冻结字段长度",
        ),
      );
      continue;
    }
    result.set(value, {
      value,
      path,
      region,
      source: "财务区报销范围完整父链唯一核对；行政区取根级配置，公司内部单列",
    });
  }
  return result;
}
