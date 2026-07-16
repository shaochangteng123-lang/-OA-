#!/usr/bin/env bash

set -euo pipefail

BACKUP_ROOT="${YULILOG_BACKUP_ROOT:-$HOME/Desktop/YuliLog换机备份/02-自动更新备份}"
HISTORY_ROOT="$BACKUP_ROOT/history"
LOG_ROOT="$BACKUP_ROOT/logs"
LOCK_DIR="$BACKUP_ROOT/.backup-lock"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

fail() {
  log "历史目录分类失败：$1"
  exit 1
}

move_without_overwrite() {
  local source_path="$1"
  local target_path="$2"

  [ ! -e "$target_path" ] || fail "目标文件已经存在：$target_path"
  mkdir -p "$(dirname "$target_path")"
  mv "$source_path" "$target_path"
}

[ -d "$HISTORY_ROOT" ] || fail "找不到历史备份目录：$HISTORY_ROOT"
[ -d "$LOG_ROOT" ] || fail "找不到备份日志目录：$LOG_ROOT"
[ ! -d "$LOCK_DIR" ] || fail "自动备份正在运行，请稍后再执行"

DATABASE_COUNT=0
PROJECT_COUNT=0
FULL_COUNT=0
LOG_COUNT=0

shopt -s nullglob

for source_path in "$HISTORY_ROOT/database/"*.dump; do
  file_name="$(basename "$source_path")"
  if [[ "$file_name" =~ ^(production|development)-([0-9]{8})-([0-9]{6})\.dump$ ]]; then
    mode_name="${BASH_REMATCH[1]}"
    date_value="${BASH_REMATCH[2]}"
    time_value="${BASH_REMATCH[3]}"
    year="${date_value:0:4}"
    month="${date_value:4:2}"
    day="${date_value:6:2}"
    target_path="$HISTORY_ROOT/$year/$month/$day/database/$mode_name-$time_value.dump"
    move_without_overwrite "$source_path" "$target_path"
    DATABASE_COUNT=$((DATABASE_COUNT + 1))
  else
    fail "无法识别数据库历史文件日期：$file_name"
  fi
done

for source_path in "$HISTORY_ROOT/project/"project-*.tar.gz; do
  file_name="$(basename "$source_path")"
  if [[ "$file_name" =~ ^project-([0-9]{8})\.tar\.gz$ ]]; then
    date_value="${BASH_REMATCH[1]}"
    year="${date_value:0:4}"
    month="${date_value:4:2}"
    day="${date_value:6:2}"
    target_path="$HISTORY_ROOT/$year/$month/$day/project/project.tar.gz"
    if [ -e "$target_path" ]; then
      legacy_target_path="$HISTORY_ROOT/$year/$month/$day/project/project-before-date-structure.tar.gz"
      move_without_overwrite "$source_path" "$legacy_target_path"
    else
      move_without_overwrite "$source_path" "$target_path"
    fi
    PROJECT_COUNT=$((PROJECT_COUNT + 1))
  else
    fail "无法识别项目历史文件日期：$file_name"
  fi
done

for source_path in "$HISTORY_ROOT/full/"YuliLog-自动完整快照-*.tar.gz; do
  file_name="$(basename "$source_path")"
  date_value="$(stat -f '%Sm' -t '%Y/%m/%d' "$source_path")"
  target_dir="$HISTORY_ROOT/$date_value/full"
  target_path="$target_dir/$file_name"
  move_without_overwrite "$source_path" "$target_path"
  if [ -f "$HISTORY_ROOT/full/$file_name.sha256" ]; then
    move_without_overwrite "$HISTORY_ROOT/full/$file_name.sha256" "$target_path.sha256"
  fi
  FULL_COUNT=$((FULL_COUNT + 1))
done

for source_path in "$LOG_ROOT/"[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].log; do
  file_name="$(basename "$source_path")"
  date_value="${file_name%.log}"
  year="${date_value:0:4}"
  month="${date_value:4:2}"
  day="${date_value:6:2}"
  target_path="$LOG_ROOT/$year/$month/$day.log"
  if [ -e "$target_path" ]; then
    merged_log_path="$target_path.merge.$$"
    cat "$source_path" "$target_path" > "$merged_log_path"
    mv "$merged_log_path" "$target_path"
    unlink "$source_path"
  else
    move_without_overwrite "$source_path" "$target_path"
  fi
  LOG_COUNT=$((LOG_COUNT + 1))
done

find "$HISTORY_ROOT" "$LOG_ROOT" -depth -type d -empty -delete

log "历史目录分类完成：数据库 $DATABASE_COUNT 个，项目 $PROJECT_COUNT 个，完整快照 $FULL_COUNT 个，运行日志 $LOG_COUNT 个"
