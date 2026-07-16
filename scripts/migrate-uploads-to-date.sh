#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOADS_ROOT="$PROJECT_DIR/uploads"
TEMP_DIR=""
CURRENT_ENVIRONMENT=""
CURRENT_ROOT=""
CURRENT_MAP=""
CURRENT_DATABASE_UPDATED=0
MIGRATION_COUNT_RESULT=0
STATUS_FILE="$UPLOADS_ROOT/上传日期分类状态.txt"
DRY_RUN=0

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
elif [ "$#" -gt 0 ]; then
  printf '不支持的参数：%s\n' "$1" >&2
  exit 1
fi

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

fail() {
  log "上传日期分类失败：$1"
  exit 1
}

rollback_current_environment() {
  [ -n "$CURRENT_MAP" ] && [ -f "$CURRENT_MAP" ] || return
  [ "$CURRENT_DATABASE_UPDATED" -eq 0 ] || return

  log "回退 $CURRENT_ENVIRONMENT 环境已移动的文件"
  while IFS=$'\t' read -r old_path new_path; do
    [ -n "$old_path" ] || continue
    old_file="$CURRENT_ROOT/${old_path#uploads/}"
    new_file="$CURRENT_ROOT/${new_path#uploads/}"
    if [ \( -e "$new_file" -o -L "$new_file" \) ] && [ ! -e "$old_file" ] && [ ! -L "$old_file" ]; then
      mkdir -p "$(dirname "$old_file")"
      mv "$new_file" "$old_file"
    fi
  done < "$CURRENT_MAP"
}

cleanup() {
  exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    rollback_current_environment
  fi
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

for command_name in docker find stat sort mv mkdir dirname sed wc; do
  command -v "$command_name" >/dev/null 2>&1 || fail "缺少命令 $command_name"
done

[ -d "$UPLOADS_ROOT/production" ] || fail "缺少生产上传目录"
[ -d "$UPLOADS_ROOT/development" ] || fail "缺少开发上传目录"
[ -d "$UPLOADS_ROOT/unassigned" ] || fail "缺少未归属历史目录"

if [ "$DRY_RUN" -eq 0 ]; then
  for application_container in yulilog-prod yulilog-worklog-dev; do
    application_status="$(docker inspect --format '{{.State.Status}}' "$application_container" 2>/dev/null || true)"
    [ "$application_status" != "running" ] || fail "应用容器 $application_container 仍在运行，请先停止应用容器"
  done
fi

for database_container in yulilog-postgres-prod yulilog-worklog-postgres; do
  database_status="$(docker inspect --format '{{.State.Status}}' "$database_container" 2>/dev/null || true)"
  [ "$database_status" = "running" ] || fail "数据库容器 $database_container 未运行"
done

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yulilog-upload-date.XXXXXX")"

build_map() {
  local environment_root="$1"
  local map_file="$2"
  local relative_path category remaining date_path old_path new_path

  : > "$map_file"
  while IFS= read -r relative_path; do
    [ -n "$relative_path" ] || continue
    category="${relative_path%%/*}"
    remaining="${relative_path#*/}"

    case "$remaining" in
      [0-9][0-9][0-9][0-9]/[0-1][0-9]/[0-3][0-9]/*)
        continue
        ;;
    esac

    date_path="$(stat -f '%Sm' -t '%Y/%m/%d' "$environment_root/$relative_path")"
    old_path="uploads/$relative_path"
    new_path="uploads/$category/$date_path/$remaining"
    printf '%s\t%s\n' "$old_path" "$new_path" >> "$map_file"
  done < <(
    cd "$environment_root"
    find . -mindepth 2 \( -type f -o -type l \) -print \
      | sed 's#^\./##' \
      | LC_ALL=C sort
  )
}

move_map_files() {
  local environment_root="$1"
  local map_file="$2"
  local old_path new_path old_file new_file

  while IFS=$'\t' read -r old_path new_path; do
    [ -n "$old_path" ] || continue
    old_file="$environment_root/${old_path#uploads/}"
    new_file="$environment_root/${new_path#uploads/}"
    if [ -e "$new_file" ] || [ -L "$new_file" ]; then
      fail "日期目标文件已经存在：$new_file"
    fi
    mkdir -p "$(dirname "$new_file")"
    mv "$old_file" "$new_file"
  done < "$map_file"
}

append_database_update_block() {
  local sql_file="$1"

  {
    printf '%s\n' 'DO $migration$'
    printf '%s\n' 'DECLARE item RECORD;'
    printf '%s\n' 'BEGIN'
    printf '%s\n' '  FOR item IN SELECT old_path, new_path FROM upload_path_migration LOOP'
    printf '%s\n' "    UPDATE bank_receipt_batches SET pdf_path = replace(pdf_path, item.old_path, item.new_path) WHERE ltrim(pdf_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE bank_receipts SET image_path = replace(image_path, item.old_path, item.new_path) WHERE ltrim(image_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE daily_log_attachments SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE employee_documents SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE leave_attachments SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE onboarding_templates SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE probation_documents SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE probation_templates SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE reimbursement_deduction_invoices SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE reimbursement_invoices SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE resignation_documents SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE resignation_templates SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE user_uploaded_files SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE users SET avatar_url = replace(avatar_url, item.old_path, item.new_path) WHERE ltrim(avatar_url, '/') = item.old_path;"
    printf '%s\n' "    UPDATE worklog_attachments SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE worklog_contract_attachments SET file_path = replace(file_path, item.old_path, item.new_path) WHERE ltrim(file_path, '/') = item.old_path;"
    printf '%s\n' "    UPDATE reimbursements SET payment_proof_path = replace(payment_proof_path, item.old_path, item.new_path) WHERE position(item.old_path in payment_proof_path) > 0;"
    printf '%s\n' "    UPDATE payment_batches SET payment_proof_path = replace(payment_proof_path, item.old_path, item.new_path) WHERE position(item.old_path in payment_proof_path) > 0;"
    printf '%s\n' '  END LOOP;'
    printf '%s\n' 'END $migration$;'
  } >> "$sql_file"
}

update_database() {
  local container_name="$1"
  local map_file="$2"
  local sql_file="$3"
  local old_path new_path

  {
    printf '%s\n' 'BEGIN;'
    printf '%s\n' 'CREATE TEMP TABLE upload_path_migration (old_path TEXT PRIMARY KEY, new_path TEXT NOT NULL);'
  } > "$sql_file"

  while IFS=$'\t' read -r old_path new_path; do
    [ -n "$old_path" ] || continue
    printf 'INSERT INTO upload_path_migration VALUES ($upload_path$%s$upload_path$, $upload_path$%s$upload_path$);\n' \
      "$old_path" "$new_path" >> "$sql_file"
  done < "$map_file"

  append_database_update_block "$sql_file"
  printf '%s\n' 'COMMIT;' >> "$sql_file"

  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d yulilog_worklog \
    < "$sql_file" >/dev/null
}

verify_map() {
  local environment_root="$1"
  local map_file="$2"
  local old_path new_path old_file new_file

  while IFS=$'\t' read -r old_path new_path; do
    [ -n "$old_path" ] || continue
    old_file="$environment_root/${old_path#uploads/}"
    new_file="$environment_root/${new_path#uploads/}"
    if [ -e "$old_file" ] || [ -L "$old_file" ]; then
      fail "旧路径仍然存在：$old_file"
    fi
    if [ ! -e "$new_file" ] && [ ! -L "$new_file" ]; then
      fail "新路径不存在：$new_file"
    fi
  done < "$map_file"
}

migrate_environment() {
  local environment_name="$1"
  local environment_root="$2"
  local database_container="$3"
  local map_file="$TEMP_DIR/$environment_name-map.txt"
  local sql_file="$TEMP_DIR/$environment_name-update.sql"
  local migration_count

  CURRENT_ENVIRONMENT="$environment_name"
  CURRENT_ROOT="$environment_root"
  CURRENT_MAP="$map_file"
  CURRENT_DATABASE_UPDATED=0

  build_map "$environment_root" "$map_file"
  migration_count="$(wc -l < "$map_file" | tr -d ' ')"
  log "$environment_name 环境需要迁移 $migration_count 个文件或符号链接"

  if [ "$migration_count" -gt 0 ]; then
    move_map_files "$environment_root" "$map_file"
    update_database "$database_container" "$map_file" "$sql_file"
    CURRENT_DATABASE_UPDATED=1
    verify_map "$environment_root" "$map_file"
  fi

  find "$environment_root" -depth -type d -empty -delete
  MIGRATION_COUNT_RESULT="$migration_count"
}

if [ "$DRY_RUN" -eq 1 ]; then
  build_map "$UPLOADS_ROOT/production" "$TEMP_DIR/production-dry-run.txt"
  build_map "$UPLOADS_ROOT/development" "$TEMP_DIR/development-dry-run.txt"
  build_map "$UPLOADS_ROOT/unassigned" "$TEMP_DIR/unassigned-dry-run.txt"
  log "预演完成：生产 $(wc -l < "$TEMP_DIR/production-dry-run.txt" | tr -d ' ') 项，开发 $(wc -l < "$TEMP_DIR/development-dry-run.txt" | tr -d ' ') 项，未归属 $(wc -l < "$TEMP_DIR/unassigned-dry-run.txt" | tr -d ' ') 项"
  exit 0
fi

migrate_environment '生产' "$UPLOADS_ROOT/production" 'yulilog-postgres-prod'
PRODUCTION_COUNT="$MIGRATION_COUNT_RESULT"
migrate_environment '开发' "$UPLOADS_ROOT/development" 'yulilog-worklog-postgres'
DEVELOPMENT_COUNT="$MIGRATION_COUNT_RESULT"

CURRENT_ENVIRONMENT="未归属"
CURRENT_ROOT="$UPLOADS_ROOT/unassigned"
CURRENT_MAP="$TEMP_DIR/unassigned-map.txt"
CURRENT_DATABASE_UPDATED=0
build_map "$CURRENT_ROOT" "$CURRENT_MAP"
UNASSIGNED_COUNT="$(wc -l < "$CURRENT_MAP" | tr -d ' ')"
log "未归属历史目录需要迁移 $UNASSIGNED_COUNT 个文件或符号链接"
if [ "$UNASSIGNED_COUNT" -gt 0 ]; then
  move_map_files "$CURRENT_ROOT" "$CURRENT_MAP"
  verify_map "$CURRENT_ROOT" "$CURRENT_MAP"
fi
CURRENT_DATABASE_UPDATED=1
find "$CURRENT_ROOT" -depth -type d -empty -delete

{
  printf '上传日期分类完成时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '日期口径：文件实际上传或保存日期（中国时区）\n'
  printf '目录结构：业务类别/年/月/日/文件\n'
  printf '生产迁移项数量：%s\n' "$PRODUCTION_COUNT"
  printf '开发迁移项数量：%s\n' "$DEVELOPMENT_COUNT"
  printf '未归属历史迁移项数量：%s\n' "$UNASSIGNED_COUNT"
} > "$STATUS_FILE"

log "上传日期分类完成"
