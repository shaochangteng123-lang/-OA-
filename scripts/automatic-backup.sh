#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${YULILOG_BACKUP_ROOT:-$HOME/Desktop/YuliLog换机备份/02-自动更新备份}"
MIGRATION_BACKUP_ROOT="$(dirname "$BACKUP_ROOT")"
MIGRATION_GUIDE_SOURCE="$PROJECT_DIR/docs/YuliLog换机重建说明.txt"
PRODUCTION_UPLOADS_DIR="$PROJECT_DIR/uploads/production"
DEVELOPMENT_UPLOADS_DIR="$PROJECT_DIR/uploads/development"
UNASSIGNED_UPLOADS_DIR="$PROJECT_DIR/uploads/unassigned"
UPLOAD_SPLIT_STATUS_FILE="$PROJECT_DIR/uploads/上传目录分离状态.txt"
UPLOAD_DATE_STATUS_FILE="$PROJECT_DIR/uploads/上传日期分类状态.txt"
LATEST_DIR="$BACKUP_ROOT/latest"
HISTORY_ROOT="$BACKUP_ROOT/history"
EXTERNAL_TARGET_FILE="$BACKUP_ROOT/移动硬盘目标.txt"

PRODUCTION_CONTAINER="yulilog-postgres-prod"
DEVELOPMENT_CONTAINER="yulilog-worklog-postgres"
DATABASE_NAME="yulilog_worklog"
DATABASE_USER="postgres"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_YEAR="$(date '+%Y')"
BACKUP_MONTH="$(date '+%m')"
BACKUP_DAY="$(date '+%d')"
BACKUP_TIME="$(date '+%H%M%S')"
HISTORY_DATE_DIR="$HISTORY_ROOT/$BACKUP_YEAR/$BACKUP_MONTH/$BACKUP_DAY"
HISTORY_DATABASE_DIR="$HISTORY_DATE_DIR/database"
HISTORY_PROJECT_DIR="$HISTORY_DATE_DIR/project"
HISTORY_FULL_DIR="$HISTORY_DATE_DIR/full"
LOG_DIR="$BACKUP_ROOT/logs/$BACKUP_YEAR/$BACKUP_MONTH"
WEEK_ID="$(date '+%Y-W%U')"
LOG_FILE="$LOG_DIR/$BACKUP_DAY.log"
LOCK_DIR="$BACKUP_ROOT/.backup-lock"
STAGING_DIR="$BACKUP_ROOT/.staging-$TIMESTAMP"
SUCCESS=0
LOCK_ACQUIRED=0

mkdir -p "$BACKUP_ROOT" "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG_FILE"
}

fail() {
  log "备份失败：$1"
  exit 1
}

check_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1"
}

check_container() {
  local container_name="$1"
  local container_status

  container_status="$(docker inspect --format '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
  [ "$container_status" = "running" ] || fail "容器 $container_name 未运行"
}

validate_dated_upload_tree() {
  local environment_name="$1"
  local environment_root="$2"
  local ignore_temp="${3:-0}"
  local relative_path category year month day remaining

  while IFS= read -r -d '' relative_path; do
    relative_path="${relative_path#./}"

    case "$relative_path" in
      .DS_Store|*/.DS_Store)
        continue
        ;;
    esac
    if [ "$ignore_temp" -eq 1 ] && [[ "$relative_path" = temp/* ]]; then
      continue
    fi

    IFS='/' read -r category year month day remaining <<< "$relative_path"

    if [ -z "$category" ] || [ -z "$remaining" ] \
      || [[ ! "$year" =~ ^[0-9]{4}$ ]] \
      || [[ ! "$month" =~ ^(0[1-9]|1[0-2])$ ]] \
      || [[ ! "$day" =~ ^(0[1-9]|[12][0-9]|3[01])$ ]]; then
      fail "$environment_name 上传目录存在未日期化文件：$environment_root/$relative_path"
    fi
  done < <(
    cd "$environment_root"
    find . \( -type f -o -type l \) -print0
  )
}

sync_upload_tree() {
  local source_dir="$1"
  local destination_dir="$2"
  local exclude_temp="${3:-0}"

  if [ "$exclude_temp" -eq 1 ]; then
    # 生产与开发临时文件不属于可恢复业务附件；同时清除旧备份中的残留。
    rsync -a --delete --delete-excluded \
      --exclude '/temp/' \
      --exclude '.DS_Store' \
      "$source_dir/" "$destination_dir/"
  else
    rsync -a --delete --delete-excluded \
      --exclude '.DS_Store' \
      "$source_dir/" "$destination_dir/"
  fi
}

write_upload_date_status() {
  local production_count development_count unassigned_count

  production_count="$(find "$LATEST_DIR/uploads/production" \( -type f -o -type l \) | wc -l | tr -d ' ')"
  development_count="$(find "$LATEST_DIR/uploads/development" \( -type f -o -type l \) | wc -l | tr -d ' ')"
  unassigned_count="$(find "$LATEST_DIR/uploads/unassigned" \( -type f -o -type l \) | wc -l | tr -d ' ')"

  {
    printf '分类状态：已完成\n'
    printf '分类校验时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf '日期口径：文件实际上传或保存日期（中国时区）\n'
    printf '目录结构：业务类别/年/月/日/文件\n'
    printf '生产文件及符号链接数量：%s\n' "$production_count"
    printf '开发文件及符号链接数量：%s\n' "$development_count"
    printf '未归属历史文件及符号链接数量：%s\n' "$unassigned_count"
  } > "$LATEST_DIR/uploads/上传日期分类状态.txt"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    LOCK_ACQUIRED=1
    return
  fi

  [ -d "$LOCK_DIR" ] || fail "无法创建备份锁目录：$LOCK_DIR"

  local previous_pid=""
  if [ -f "$LOCK_DIR/pid" ]; then
    previous_pid="$(sed -n '1p' "$LOCK_DIR/pid")"
  fi

  if [ -n "$previous_pid" ] && kill -0 "$previous_pid" 2>/dev/null; then
    fail "已有备份任务正在运行，进程号为 $previous_pid"
  fi

  mv "$LOCK_DIR" "$BACKUP_ROOT/.stale-lock-$TIMESTAMP"
  mkdir "$LOCK_DIR"
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  LOCK_ACQUIRED=1
}

cleanup() {
  if [ -d "$STAGING_DIR" ]; then
    if [ "$SUCCESS" -eq 1 ]; then
      rmdir "$STAGING_DIR" 2>/dev/null || true
    else
      mv "$STAGING_DIR" "$BACKUP_ROOT/failed-$TIMESTAMP" 2>/dev/null || true
    fi
  fi
  if [ "$LOCK_ACQUIRED" -eq 1 ]; then
    unlink "$LOCK_DIR/pid" 2>/dev/null || true
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT

check_command docker
check_command rsync
check_command shasum
check_command tar
acquire_lock

[ -f "$MIGRATION_GUIDE_SOURCE" ] || fail "缺少换机重建说明：$MIGRATION_GUIDE_SOURCE"

mkdir -p \
  "$LATEST_DIR/uploads/production" \
  "$LATEST_DIR/uploads/development" \
  "$LATEST_DIR/uploads/unassigned" \
  "$LATEST_DIR/project" \
  "$HISTORY_DATABASE_DIR" \
  "$HISTORY_PROJECT_DIR" \
  "$HISTORY_FULL_DIR" \
  "$STAGING_DIR"

log "开始自动备份生产数据库、开发数据库、分离上传文件和项目配置"

check_container "$PRODUCTION_CONTAINER"
check_container "$DEVELOPMENT_CONTAINER"

[ -d "$PRODUCTION_UPLOADS_DIR" ] || fail "缺少生产上传目录：$PRODUCTION_UPLOADS_DIR"
[ -d "$DEVELOPMENT_UPLOADS_DIR" ] || fail "缺少开发上传目录：$DEVELOPMENT_UPLOADS_DIR"
[ -d "$UNASSIGNED_UPLOADS_DIR" ] || fail "缺少未归属历史文件目录：$UNASSIGNED_UPLOADS_DIR"
[ -f "$UPLOAD_SPLIT_STATUS_FILE" ] || fail "缺少上传目录分离状态文件：$UPLOAD_SPLIT_STATUS_FILE"
[ -f "$UPLOAD_DATE_STATUS_FILE" ] || fail "缺少上传日期分类状态文件：$UPLOAD_DATE_STATUS_FILE"

# 在改写 latest 前先拒绝未日期化业务附件，确保失败时保留上一次成功备份。
validate_dated_upload_tree '生产' "$PRODUCTION_UPLOADS_DIR" 1
validate_dated_upload_tree '开发' "$DEVELOPMENT_UPLOADS_DIR" 1
validate_dated_upload_tree '未归属' "$UNASSIGNED_UPLOADS_DIR"

# 先复制现有附件，再在数据库快照完成后补同步一次，降低在线备份期间的文件遗漏风险。
sync_upload_tree "$PRODUCTION_UPLOADS_DIR" "$LATEST_DIR/uploads/production" 1
sync_upload_tree "$DEVELOPMENT_UPLOADS_DIR" "$LATEST_DIR/uploads/development" 1
sync_upload_tree "$UNASSIGNED_UPLOADS_DIR" "$LATEST_DIR/uploads/unassigned"
cp "$UPLOAD_SPLIT_STATUS_FILE" "$LATEST_DIR/uploads/上传目录分离状态.txt"

docker exec "$PRODUCTION_CONTAINER" \
  pg_dump -U "$DATABASE_USER" -d "$DATABASE_NAME" -Fc \
  > "$STAGING_DIR/production.dump"

docker exec "$DEVELOPMENT_CONTAINER" \
  pg_dump -U "$DATABASE_USER" -d "$DATABASE_NAME" -Fc \
  > "$STAGING_DIR/development.dump"

[ -s "$STAGING_DIR/production.dump" ] || fail "生产数据库备份为空"
[ -s "$STAGING_DIR/development.dump" ] || fail "开发数据库备份为空"

docker exec -i "$PRODUCTION_CONTAINER" pg_restore -l \
  < "$STAGING_DIR/production.dump" >/dev/null
docker exec -i "$DEVELOPMENT_CONTAINER" pg_restore -l \
  < "$STAGING_DIR/development.dump" >/dev/null

validate_dated_upload_tree '生产' "$PRODUCTION_UPLOADS_DIR" 1
validate_dated_upload_tree '开发' "$DEVELOPMENT_UPLOADS_DIR" 1
validate_dated_upload_tree '未归属' "$UNASSIGNED_UPLOADS_DIR"
sync_upload_tree "$PRODUCTION_UPLOADS_DIR" "$LATEST_DIR/uploads/production" 1
sync_upload_tree "$DEVELOPMENT_UPLOADS_DIR" "$LATEST_DIR/uploads/development" 1
sync_upload_tree "$UNASSIGNED_UPLOADS_DIR" "$LATEST_DIR/uploads/unassigned"
cp "$UPLOAD_SPLIT_STATUS_FILE" "$LATEST_DIR/uploads/上传目录分离状态.txt"
validate_dated_upload_tree '生产备份' "$LATEST_DIR/uploads/production"
validate_dated_upload_tree '开发备份' "$LATEST_DIR/uploads/development"
validate_dated_upload_tree '未归属备份' "$LATEST_DIR/uploads/unassigned"
write_upload_date_status

cp "$STAGING_DIR/production.dump" \
  "$HISTORY_DATABASE_DIR/production-$BACKUP_TIME.dump"
cp "$STAGING_DIR/development.dump" \
  "$HISTORY_DATABASE_DIR/development-$BACKUP_TIME.dump"
mv "$STAGING_DIR/production.dump" "$LATEST_DIR/production.dump"
mv "$STAGING_DIR/development.dump" "$LATEST_DIR/development.dump"

# 最新项目副本保持与当前项目一致，历史项目包每天只生成一次。
rsync -a --delete \
  --exclude '/backup/' \
  --exclude '/node_modules/' \
  --exclude '/uploads/' \
  --exclude '/.git/fsmonitor--daemon.ipc' \
  "$PROJECT_DIR/" "$LATEST_DIR/project/"

DAILY_PROJECT_ARCHIVE="$HISTORY_PROJECT_DIR/project.tar.gz"
if [ ! -f "$DAILY_PROJECT_ARCHIVE" ]; then
  DAILY_PROJECT_STAGING="$HISTORY_PROJECT_DIR/.project.tar.gz.tmp"
  tar -czf "$DAILY_PROJECT_STAGING" \
    --exclude='./backup' \
    --exclude='./node_modules' \
    --exclude='./uploads' \
    --exclude='./.git/fsmonitor--daemon.ipc' \
    -C "$PROJECT_DIR" .
  mv "$DAILY_PROJECT_STAGING" "$DAILY_PROJECT_ARCHIVE"
fi

PRODUCTION_UPLOAD_COUNT="$(find "$LATEST_DIR/uploads/production" \( -type f -o -type l \) | wc -l | tr -d ' ')"
DEVELOPMENT_UPLOAD_COUNT="$(find "$LATEST_DIR/uploads/development" \( -type f -o -type l \) | wc -l | tr -d ' ')"
UNASSIGNED_UPLOAD_COUNT="$(find "$LATEST_DIR/uploads/unassigned" \( -type f -o -type l \) | wc -l | tr -d ' ')"
PRODUCTION_SIZE="$(du -h "$LATEST_DIR/production.dump" | awk '{print $1}')"
DEVELOPMENT_SIZE="$(du -h "$LATEST_DIR/development.dump" | awk '{print $1}')"

{
  printf '最新数据快照时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '生产数据库备份大小：%s\n' "$PRODUCTION_SIZE"
  printf '开发数据库备份大小：%s\n' "$DEVELOPMENT_SIZE"
  printf '生产上传文件数量：%s\n' "$PRODUCTION_UPLOAD_COUNT"
  printf '开发上传文件数量：%s\n' "$DEVELOPMENT_UPLOAD_COUNT"
  printf '未归属历史文件数量：%s\n' "$UNASSIGNED_UPLOAD_COUNT"
  printf '上传文件分类规则：业务类别/年/月/日，按实际上传日期归档\n'
  printf '项目目录：%s\n' "$PROJECT_DIR"
} > "$LATEST_DIR/备份状态.txt"

(
  cd "$LATEST_DIR"
  shasum -a 256 production.dump development.dump > SHA256SUMS
)

# 每次备份都重新生成说明，使其与当前项目构建文件保持一致。
GUIDE_STAGING="$STAGING_DIR/换机说明.txt"
cp "$MIGRATION_GUIDE_SOURCE" "$GUIDE_STAGING"
{
  printf '\n五、当前构建依据（自动更新）\n\n'
  printf '本节由自动备份脚本生成，请勿手工修改。\n'
  printf '更新时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf '构建文件校验值：\n'
  for dependency_file in \
    Dockerfile \
    docker-compose.yml \
    docker-compose.prod.yml \
    package.json \
    package-lock.json; do
    [ -f "$PROJECT_DIR/$dependency_file" ] || fail "缺少构建文件：$dependency_file"
    dependency_checksum="$(shasum -a 256 "$PROJECT_DIR/$dependency_file" | awk '{print $1}')"
    printf '%s  %s\n' "$dependency_checksum" "$dependency_file"
  done
  printf '\n恢复时必须使用同一份 latest/project 中的上述文件，不得替换为其他时间点的版本。\n'
} >> "$GUIDE_STAGING"
unlink "$LATEST_DIR/换机说明.txt" 2>/dev/null || true
mv "$GUIDE_STAGING" "$MIGRATION_BACKUP_ROOT/换机说明.txt"

WEEKLY_FULL_NAME="YuliLog-自动完整快照-$WEEK_ID.tar.gz"
WEEKLY_FULL_ARCHIVE="$HISTORY_FULL_DIR/$WEEKLY_FULL_NAME"
EXISTING_WEEKLY_FULL="$(find "$HISTORY_ROOT" -type f -name "$WEEKLY_FULL_NAME" -print -quit 2>/dev/null || true)"
if [ -z "$EXISTING_WEEKLY_FULL" ]; then
  WEEKLY_FULL_STAGING="$HISTORY_FULL_DIR/.$WEEKLY_FULL_NAME.tmp"
  log "开始生成本周完整快照：$WEEKLY_FULL_NAME"
  tar -czf "$WEEKLY_FULL_STAGING" -C "$LATEST_DIR" .
  mv "$WEEKLY_FULL_STAGING" "$WEEKLY_FULL_ARCHIVE"
  (
    cd "$HISTORY_FULL_DIR"
    shasum -a 256 "$WEEKLY_FULL_NAME" > "$WEEKLY_FULL_NAME.sha256"
  )
  log "本周完整快照已生成"
fi

# 数据库历史保留 30 天，每日项目包保留 14 天，每周完整快照保留 35 天。
find "$HISTORY_ROOT" -type f -path '*/database/*.dump' -mtime +30 -delete
find "$HISTORY_ROOT" -type f -path '*/project/*.tar.gz' -mtime +14 -delete
find "$HISTORY_ROOT" -type f \
  \( -name 'YuliLog-自动完整快照-*.tar.gz' -o -name 'YuliLog-自动完整快照-*.tar.gz.sha256' \) \
  -mtime +35 -delete
find "$HISTORY_ROOT" "$BACKUP_ROOT/logs" -depth -type d -empty -delete

EXTERNAL_ROOT="${YULILOG_EXTERNAL_BACKUP_ROOT:-}"
if [ -z "$EXTERNAL_ROOT" ] && [ -f "$EXTERNAL_TARGET_FILE" ]; then
  EXTERNAL_ROOT="$(sed -n '1p' "$EXTERNAL_TARGET_FILE")"
fi

if [ -n "$EXTERNAL_ROOT" ]; then
  case "$EXTERNAL_ROOT" in
    "$MIGRATION_BACKUP_ROOT"|"$MIGRATION_BACKUP_ROOT"/*)
      fail "移动硬盘目标不能位于本机换机备份目录内部"
      ;;
  esac

  EXTERNAL_PARENT="$(dirname "$EXTERNAL_ROOT")"
  if [ -d "$EXTERNAL_PARENT" ] && [ -w "$EXTERNAL_PARENT" ]; then
    mkdir -p "$EXTERNAL_ROOT"
    rsync -a \
      --exclude '/02-自动更新备份/.backup-lock/' \
      --exclude '/02-自动更新备份/.staging-*' \
      --exclude '/02-自动更新备份/failed-*' \
      "$MIGRATION_BACKUP_ROOT/" "$EXTERNAL_ROOT/"
    log "已同步到移动硬盘目标：$EXTERNAL_ROOT"
  else
    log "移动硬盘目标不可用，本次仅完成本机备份：$EXTERNAL_ROOT"
  fi
else
  log "尚未配置移动硬盘目标，本次仅完成本机备份"
fi

SUCCESS=1
log "自动备份完成，最新备份目录：$LATEST_DIR"
