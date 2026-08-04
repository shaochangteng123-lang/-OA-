export type MonthlyProbationReviewStage =
  | "supervisor"
  | "hr"
  | "general_manager";

const MONTHLY_REVIEW_STAGE_BY_ROLE: Record<
  string,
  MonthlyProbationReviewStage
> = {
  general_manager: "supervisor",
  admin: "hr",
  super_admin: "hr",
  chairman: "general_manager",
};

export function getMonthlyProbationReviewStage(
  role: string | null | undefined,
): MonthlyProbationReviewStage | null {
  return role ? MONTHLY_REVIEW_STAGE_BY_ROLE[role] || null : null;
}
