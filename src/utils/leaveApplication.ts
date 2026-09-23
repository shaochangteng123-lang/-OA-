export type LeaveApplicationKind =
  | "normal"
  | "combined"
  | "extension"
  | "supplement";

export interface LeaveApplicationKindSource {
  application_kind: LeaveApplicationKind;
  combination_group_id?: string | null;
  parent_request_id?: string | null;
}

export function getLeaveApplicationKindLabel(
  request: LeaveApplicationKindSource,
): string {
  if (request.application_kind === "extension") {
    return request.combination_group_id ? "组合续假" : "续假";
  }
  if (request.application_kind === "supplement") {
    if (request.parent_request_id === null) {
      return request.combination_group_id ? "组合返岗补假" : "返岗补假";
    }
    return request.combination_group_id ? "组合补假" : "补假";
  }
  return request.application_kind === "combined" ? "组合请假" : "普通请假";
}
