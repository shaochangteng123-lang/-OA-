/** 图表交互状态仅供前端使用；对比期保留真实来源范围，month为该期真实截止月。 */
export interface FinancialAnalysisPointSelection {
  month: string;
  comparison: boolean;
  metricKey: string;
  periodKey?: string;
  from?: string;
  to?: string;
}
