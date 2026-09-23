export type MonthlyProbationReviewStage =
  | "supervisor"
  | "hr"
  | "general_manager";

const MONTHLY_REVIEW_STAGES_BY_ROLE: Record<
  string,
  MonthlyProbationReviewStage[]
> = {
  general_manager: ["supervisor"],
  admin: ["hr"],
  super_admin: ["supervisor", "hr"],
  chairman: ["general_manager"],
};

export function getMonthlyProbationReviewStages(
  role: string | null | undefined,
): MonthlyProbationReviewStage[] {
  return role ? [...(MONTHLY_REVIEW_STAGES_BY_ROLE[role] || [])] : [];
}
