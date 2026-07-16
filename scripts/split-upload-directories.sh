#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOADS_ROOT="$PROJECT_DIR/uploads"
PRODUCTION_DIR="$UPLOADS_ROOT/production"
DEVELOPMENT_DIR="$UPLOADS_ROOT/development"
UNASSIGNED_DIR="$UPLOADS_ROOT/unassigned"
STATUS_FILE="$UPLOADS_ROOT/上传目录分离状态.txt"
PRODUCTION_DATABASE_CONTAINER="yulilog-postgres-prod"
DEVELOPMENT_DATABASE_CONTAINER="yulilog-worklog-postgres"
TEMP_DIR=""

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

fail() {
  log "上传目录分离失败：$1"
  exit 1
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

for command_name in docker find sort comm mv cp cmp mkdir readlink; do
  command -v "$command_name" >/dev/null 2>&1 || fail "缺少命令 $command_name"
done

[ -d "$UPLOADS_ROOT" ] || fail "找不到原共享上传目录：$UPLOADS_ROOT"

for application_container in yulilog-prod yulilog-worklog-dev; do
  application_status="$(docker inspect --format '{{.State.Status}}' "$application_container" 2>/dev/null || true)"
  [ "$application_status" != "running" ] || fail "应用容器 $application_container 仍在运行，请先停止应用容器"
done

for database_container in "$PRODUCTION_DATABASE_CONTAINER" "$DEVELOPMENT_DATABASE_CONTAINER"; do
  database_status="$(docker inspect --format '{{.State.Status}}' "$database_container" 2>/dev/null || true)"
  [ "$database_status" = "running" ] || fail "数据库容器 $database_container 未运行"
done

if [ -e "$PRODUCTION_DIR" ] || [ -e "$DEVELOPMENT_DIR" ] || [ -e "$UNASSIGNED_DIR" ]; then
  fail "目标目录已经存在，为避免重复迁移，本脚本不会再次执行"
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yulilog-upload-split.XXXXXX")"
ALL_FILES="$TEMP_DIR/all-files.txt"
PRODUCTION_PATHS="$TEMP_DIR/production-paths.txt"
DEVELOPMENT_PATHS="$TEMP_DIR/development-paths.txt"
PRODUCTION_EXISTING="$TEMP_DIR/production-existing.txt"
DEVELOPMENT_EXISTING="$TEMP_DIR/development-existing.txt"
PRODUCTION_MISSING="$TEMP_DIR/production-missing.txt"
DEVELOPMENT_MISSING="$TEMP_DIR/development-missing.txt"
BOTH_PATHS="$TEMP_DIR/both-paths.txt"
PRODUCTION_ONLY="$TEMP_DIR/production-only.txt"
DEVELOPMENT_ONLY="$TEMP_DIR/development-only.txt"
REFERENCED_PATHS="$TEMP_DIR/referenced-paths.txt"
UNASSIGNED_PATHS="$TEMP_DIR/unassigned-paths.txt"

PATH_QUERY="
WITH paths(path) AS (
  SELECT pdf_path FROM bank_receipt_batches
  UNION ALL SELECT image_path FROM bank_receipts
  UNION ALL SELECT file_path FROM daily_log_attachments
  UNION ALL SELECT file_path FROM employee_documents
  UNION ALL SELECT file_path FROM leave_attachments
  UNION ALL SELECT file_path FROM onboarding_templates
  UNION ALL SELECT regexp_split_to_table(payment_proof_path, ',') FROM payment_batches
  UNION ALL SELECT file_path FROM probation_documents
  UNION ALL SELECT file_path FROM probation_templates
  UNION ALL SELECT file_path FROM reimbursement_deduction_invoices
  UNION ALL SELECT file_path FROM reimbursement_invoices
  UNION ALL SELECT regexp_split_to_table(payment_proof_path, ',') FROM reimbursements
  UNION ALL SELECT file_path FROM resignation_documents
  UNION ALL SELECT file_path FROM resignation_templates
  UNION ALL SELECT file_path FROM user_uploaded_files
  UNION ALL SELECT avatar_url FROM users
  UNION ALL SELECT file_path FROM worklog_attachments
  UNION ALL SELECT file_path FROM worklog_contract_attachments
)
SELECT DISTINCT regexp_replace(btrim(path), '^/?uploads/', '')
FROM paths
WHERE path IS NOT NULL
  AND btrim(path) ~ '^/?uploads/'
ORDER BY 1;
"

export_paths() {
  local container_name="$1"
  local output_file="$2"

  docker exec "$container_name" \
    psql -U postgres -d yulilog_worklog -Atc "$PATH_QUERY" \
    | LC_ALL=C sort -u > "$output_file"
}

validate_paths() {
  local path_file="$1"
  local relative_path

  while IFS= read -r relative_path; do
    case "$relative_path" in
      ""|/*|../*|*/../*|*/..)
        fail "数据库中包含不安全的上传路径：$relative_path"
        ;;
    esac
  done < "$path_file"
}

move_file() {
  local relative_path="$1"
  local target_root="$2"
  local source_path="$UPLOADS_ROOT/$relative_path"
  local target_path="$target_root/$relative_path"

  mkdir -p "$(dirname "$target_path")"
  mv "$source_path" "$target_path"
}

log "读取生产与开发数据库中的上传文件引用"
export_paths "$PRODUCTION_DATABASE_CONTAINER" "$PRODUCTION_PATHS"
export_paths "$DEVELOPMENT_DATABASE_CONTAINER" "$DEVELOPMENT_PATHS"
validate_paths "$PRODUCTION_PATHS"
validate_paths "$DEVELOPMENT_PATHS"

(
  cd "$UPLOADS_ROOT"
  find . \( -type f -o -type l \) -print | sed 's#^\./##' | LC_ALL=C sort
) > "$ALL_FILES"

ORIGINAL_COUNT="$(wc -l < "$ALL_FILES" | tr -d ' ')"
[ "$ORIGINAL_COUNT" -gt 0 ] || fail "原共享上传目录中没有文件"

comm -12 "$PRODUCTION_PATHS" "$ALL_FILES" > "$PRODUCTION_EXISTING"
comm -12 "$DEVELOPMENT_PATHS" "$ALL_FILES" > "$DEVELOPMENT_EXISTING"
comm -23 "$PRODUCTION_PATHS" "$ALL_FILES" > "$PRODUCTION_MISSING"
comm -23 "$DEVELOPMENT_PATHS" "$ALL_FILES" > "$DEVELOPMENT_MISSING"
comm -12 "$PRODUCTION_EXISTING" "$DEVELOPMENT_EXISTING" > "$BOTH_PATHS"
comm -23 "$PRODUCTION_EXISTING" "$DEVELOPMENT_EXISTING" > "$PRODUCTION_ONLY"
comm -13 "$PRODUCTION_EXISTING" "$DEVELOPMENT_EXISTING" > "$DEVELOPMENT_ONLY"
LC_ALL=C sort -u "$PRODUCTION_EXISTING" "$DEVELOPMENT_EXISTING" > "$REFERENCED_PATHS"
comm -23 "$ALL_FILES" "$REFERENCED_PATHS" > "$UNASSIGNED_PATHS"

mkdir -p "$PRODUCTION_DIR" "$DEVELOPMENT_DIR" "$UNASSIGNED_DIR"

log "迁移仅由生产数据库引用的文件"
while IFS= read -r relative_path; do
  [ -n "$relative_path" ] || continue
  move_file "$relative_path" "$PRODUCTION_DIR"
done < "$PRODUCTION_ONLY"

log "迁移仅由开发数据库引用的文件"
while IFS= read -r relative_path; do
  [ -n "$relative_path" ] || continue
  move_file "$relative_path" "$DEVELOPMENT_DIR"
done < "$DEVELOPMENT_ONLY"

log "复制两个数据库共同引用的文件"
while IFS= read -r relative_path; do
  [ -n "$relative_path" ] || continue
  source_path="$UPLOADS_ROOT/$relative_path"
  production_path="$PRODUCTION_DIR/$relative_path"
  development_path="$DEVELOPMENT_DIR/$relative_path"
  mkdir -p "$(dirname "$production_path")" "$(dirname "$development_path")"
  if [ -L "$source_path" ]; then
    cp -Pp "$source_path" "$production_path"
    [ "$(readlink "$source_path")" = "$(readlink "$production_path")" ] \
      || fail "共同符号链接复制校验失败：$relative_path"
  else
    cp -p "$source_path" "$production_path"
    cmp -s "$source_path" "$production_path" || fail "共同文件复制校验失败：$relative_path"
  fi
  mv "$source_path" "$development_path"
done < "$BOTH_PATHS"

log "保存数据库尚未归属的历史文件"
while IFS= read -r relative_path; do
  [ -n "$relative_path" ] || continue
  move_file "$relative_path" "$UNASSIGNED_DIR"
done < "$UNASSIGNED_PATHS"

# 文件迁移后清理旧共享结构留下的空目录。
find "$UPLOADS_ROOT" -depth -type d -empty -delete
mkdir -p "$PRODUCTION_DIR" "$DEVELOPMENT_DIR" "$UNASSIGNED_DIR"

PRODUCTION_COUNT="$(find "$PRODUCTION_DIR" \( -type f -o -type l \) | wc -l | tr -d ' ')"
DEVELOPMENT_COUNT="$(find "$DEVELOPMENT_DIR" \( -type f -o -type l \) | wc -l | tr -d ' ')"
UNASSIGNED_COUNT="$(find "$UNASSIGNED_DIR" \( -type f -o -type l \) | wc -l | tr -d ' ')"
BOTH_COUNT="$(wc -l < "$BOTH_PATHS" | tr -d ' ')"
PRODUCTION_MISSING_COUNT="$(wc -l < "$PRODUCTION_MISSING" | tr -d ' ')"
DEVELOPMENT_MISSING_COUNT="$(wc -l < "$DEVELOPMENT_MISSING" | tr -d ' ')"

if [ "$((PRODUCTION_COUNT + DEVELOPMENT_COUNT + UNASSIGNED_COUNT - BOTH_COUNT))" -ne "$ORIGINAL_COUNT" ]; then
  fail "迁移前后文件数量校验不一致"
fi

{
  printf '上传目录分离时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '原共享目录文件及符号链接数量：%s\n' "$ORIGINAL_COUNT"
  printf '生产目录文件及符号链接数量：%s\n' "$PRODUCTION_COUNT"
  printf '开发目录文件及符号链接数量：%s\n' "$DEVELOPMENT_COUNT"
  printf '生产与开发共同引用项数量：%s\n' "$BOTH_COUNT"
  printf '未归属历史文件及符号链接数量：%s\n' "$UNASSIGNED_COUNT"
  printf '生产数据库原有缺失引用数量：%s\n' "$PRODUCTION_MISSING_COUNT"
  printf '开发数据库原有缺失引用数量：%s\n' "$DEVELOPMENT_MISSING_COUNT"
  printf '\n生产数据库原有缺失引用：\n'
  sed 's/^/- /' "$PRODUCTION_MISSING"
  printf '\n开发数据库原有缺失引用：\n'
  sed 's/^/- /' "$DEVELOPMENT_MISSING"
} > "$STATUS_FILE"

log "上传目录分离完成：生产 $PRODUCTION_COUNT 个，开发 $DEVELOPMENT_COUNT 个，未归属 $UNASSIGNED_COUNT 个"
