<template>
  <section class="worklog-overview" aria-labelledby="worklog-overview-title">
    <header class="worklog-header">
      <div>
        <span class="section-kicker">组织运行</span>
        <h2 id="worklog-overview-title">日报与周报</h2>
        <p>同步员工当日填写情况、归档日报以及系统生成的周报摘要。</p>
      </div>
      <span class="sync-badge">
        <i></i>
        实时汇总 · {{ refreshCountdown }}秒后同步
      </span>
    </header>

    <div class="log-stat-grid">
      <article>
        <span>今日已填写</span>
        <strong>
          {{ summary.daily.writtenCount }}
          <small>/ {{ summary.daily.eligibleCount }}人</small>
        </strong>
        <div class="progress-track">
          <i :style="{ width: `${summary.daily.completionRate || 0}%` }"></i>
        </div>
        <small>填写率 {{ formatRate(summary.daily.completionRate) }}</small>
      </article>
      <article>
        <span>今日已归档</span>
        <strong>
          {{ summary.daily.archivedCount }}
          <small>人</small>
        </strong>
        <p>白天填写、每日结束后统一归档</p>
      </article>
      <article>
        <span>本周已生成周报</span>
        <strong>
          {{ summary.weekly.generatedCount }}
          <small>/ {{ summary.weekly.eligibleCount }}人</small>
        </strong>
        <div class="progress-track weekly-track">
          <i :style="{ width: `${summary.weekly.completionRate || 0}%` }"></i>
        </div>
        <small>生成率 {{ formatRate(summary.weekly.completionRate) }}</small>
      </article>
      <article class="missing-stat">
        <span>今日尚未填写</span>
        <strong>
          {{ summary.daily.missingCount }}
          <small>人</small>
        </strong>
        <p>{{ missingDailySummary }}</p>
      </article>
    </div>

    <div class="log-content-grid">
      <article class="log-panel">
        <div class="panel-heading">
          <div>
            <span>工作日报</span>
            <h3>最近员工日报</h3>
          </div>
          <small>{{ formatDate(summary.daily.date) }}实时状态</small>
        </div>

        <div v-if="summary.daily.missingUsers.length" class="missing-users">
          <span>今日未填写</span>
          <div>
            <i
              v-for="user in summary.daily.missingUsers.slice(0, 8)"
              :key="user.userId"
              :title="formatUserMeta(user)"
            >
              {{ user.userName }}
            </i>
            <i v-if="summary.daily.missingUsers.length > 8">
              +{{ summary.daily.missingUsers.length - 8 }}
            </i>
          </div>
        </div>

        <div v-if="summary.daily.items.length" class="log-list">
          <details
            v-for="item in summary.daily.items"
            :key="item.id"
            class="log-item"
          >
            <summary>
              <span class="avatar">{{ getNameInitial(item.userName) }}</span>
              <div class="log-summary-copy">
                <div>
                  <strong>{{ item.userName }}</strong>
                  <small>{{ formatUserMeta(item) }}</small>
                </div>
                <p>{{ getExcerpt(item.content, 86) }}</p>
              </div>
              <div class="log-time">
                <strong>{{ formatShortDate(item.date) }}</strong>
                <small>{{
                  item.state === "archived" ? "已归档" : "填写中"
                }}</small>
              </div>
            </summary>
            <p class="log-full-content">{{ getPlainText(item.content) }}</p>
          </details>
        </div>
        <div v-else class="inline-empty">尚无员工日报记录</div>
      </article>

      <article class="log-panel weekly-panel">
        <div class="panel-heading">
          <div>
            <span>工作周报</span>
            <h3>
              {{
                summary.weekly.isCurrentWeek ? "本周周报" : "最近生成的团队周报"
              }}
            </h3>
          </div>
          <small>
            {{
              formatDateRange(
                summary.weekly.displayWeekStart,
                summary.weekly.displayWeekEnd,
              )
            }}
          </small>
        </div>

        <div v-if="!summary.weekly.isCurrentWeek" class="fallback-hint">
          本周尚未生成周报，以下展示最近一个有周报的周期
        </div>

        <div v-if="summary.weekly.items.length" class="log-list weekly-list">
          <details
            v-for="item in summary.weekly.items"
            :key="item.id"
            class="log-item weekly-log-item"
          >
            <summary>
              <span class="avatar">{{ getNameInitial(item.userName) }}</span>
              <div class="log-summary-copy">
                <div>
                  <strong>{{ item.userName }}</strong>
                  <small>{{ formatUserMeta(item) }}</small>
                </div>
                <p>{{ getExcerpt(item.content, 100) }}</p>
              </div>
              <div class="log-time">
                <strong>周报</strong>
                <small>{{ formatDateTime(item.generatedAt) }}</small>
              </div>
            </summary>
            <p class="log-full-content">{{ getPlainText(item.content) }}</p>
          </details>
        </div>
        <div v-else class="inline-empty">尚无团队周报记录</div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  BossWorkLogSummary,
  BossWorkLogUser,
} from "@/utils/bossDashboardApi";

const props = defineProps<{
  summary: BossWorkLogSummary;
  refreshCountdown: number;
}>();

const missingDailySummary = computed(() => {
  const users = props.summary.daily.missingUsers;
  if (users.length === 0) {
    return "今日人员均已填写";
  }
  const names = users.slice(0, 3).map((user) => user.userName);
  return `${names.join("、")}${users.length > 3 ? `等${users.length}人` : ""}`;
});

function formatRate(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function getPlainText(content: string) {
  return String(content || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getExcerpt(content: string, maximum: number) {
  const text = getPlainText(content).replace(/\s+/g, " ");
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function getNameInitial(name: string) {
  return String(name || "员").slice(-1);
}

function formatUserMeta(user: BossWorkLogUser) {
  return (
    [user.department, user.position].filter(Boolean).join(" · ") ||
    "未设置部门岗位"
  );
}

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
    : value;
}

function formatShortDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}/${Number(match[3])}` : value;
}

function formatDateRange(start: string, end: string) {
  return `${formatShortDate(start)}—${formatShortDate(end)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
</script>

<style scoped>
.worklog-overview {
  margin-top: 18px;
  padding: 24px;
  border: 1px solid rgb(219 228 236 / 92%);
  border-radius: 20px;
  background:
    radial-gradient(circle at 0% 0%, rgb(61 120 182 / 7%), transparent 28%),
    linear-gradient(150deg, #ffffff, #f9fbfc);
  box-shadow:
    0 14px 36px rgb(27 48 70 / 7%),
    inset 0 1px 0 #ffffff;
}

.worklog-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.section-kicker,
.panel-heading span {
  color: #3d719e;
  font-size: 10px;
  font-weight: 720;
  letter-spacing: 0.15em;
}

.worklog-header h2 {
  margin: 5px 0 0;
  color: #1d3248;
  font-size: 20px;
  letter-spacing: -0.025em;
}

.worklog-header p {
  margin: 7px 0 0;
  color: #8895a3;
  font-size: 11px;
}

.sync-badge {
  display: inline-flex;
  min-height: 28px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border: 1px solid #cfe9e4;
  border-radius: 999px;
  background: #eef9f7;
  color: #287b74;
  font-size: 10px;
}

.sync-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3db8a3;
  box-shadow: 0 0 0 4px rgb(61 184 163 / 10%);
}

.log-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 22px;
}

.log-stat-grid article {
  min-width: 0;
  padding: 15px;
  border: 1px solid #e3eaf0;
  border-radius: 14px;
  background: rgb(255 255 255 / 88%);
}

.log-stat-grid article > span {
  color: #7d8a97;
  font-size: 10px;
}

.log-stat-grid article > strong {
  display: block;
  margin-top: 5px;
  color: #203e59;
  font-size: 23px;
  font-weight: 750;
  letter-spacing: -0.035em;
}

.log-stat-grid article > strong small {
  color: #8794a1;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
}

.log-stat-grid article > small,
.log-stat-grid article > p {
  display: block;
  overflow: hidden;
  margin: 7px 0 0;
  color: #929da8;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-track {
  height: 5px;
  overflow: hidden;
  margin-top: 9px;
  border-radius: 99px;
  background: #edf2f5;
}

.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3d78b6, #2ca3a0);
}

.weekly-track i {
  background: linear-gradient(90deg, #7257b6, #3d78b6);
}

.missing-stat {
  background:
    radial-gradient(circle at 100% 0%, rgb(185 119 49 / 10%), transparent 45%),
    #ffffff !important;
}

.missing-stat > strong {
  color: #a76829 !important;
}

.log-content-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
  margin-top: 13px;
}

.log-panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e4eaf0;
  border-radius: 15px;
  background: rgb(255 255 255 / 84%);
}

.panel-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading h3 {
  margin: 3px 0 0;
  color: #31485e;
  font-size: 14px;
}

.panel-heading > small {
  color: #98a3ae;
  font-size: 9px;
}

.missing-users {
  display: flex;
  min-height: 37px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding: 7px 9px;
  border: 1px solid #f0e1cf;
  border-radius: 9px;
  background: #fdf8f2;
}

.missing-users > span {
  flex-shrink: 0;
  color: #9b6a36;
  font-size: 9px;
}

.missing-users > div {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.missing-users i {
  padding: 2px 5px;
  border-radius: 5px;
  background: #f4e9dc;
  color: #8b6339;
  font-size: 8px;
  font-style: normal;
}

.fallback-hint {
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid #dfe7f2;
  border-radius: 9px;
  background: #f3f7fb;
  color: #667f98;
  font-size: 9px;
}

.log-list {
  display: flex;
  max-height: 390px;
  flex-direction: column;
  overflow-y: auto;
  margin-top: 8px;
}

.weekly-list {
  margin-top: 12px;
}

.log-item {
  border-bottom: 1px solid #edf1f4;
}

.log-item:last-child {
  border-bottom: 0;
}

.log-item summary {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 10px;
  padding: 11px 4px;
  cursor: pointer;
  list-style: none;
}

.log-item summary::-webkit-details-marker {
  display: none;
}

.log-item summary:hover {
  background: #f8fafb;
}

.avatar {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(145deg, #e8f0f7, #f3f7fa);
  color: #3d719e;
  font-size: 12px;
  font-weight: 720;
}

.weekly-log-item .avatar {
  background: linear-gradient(145deg, #efebf8, #f7f4fb);
  color: #7257b6;
}

.log-summary-copy {
  min-width: 0;
}

.log-summary-copy > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.log-summary-copy strong {
  color: #32485d;
  font-size: 11px;
}

.log-summary-copy small {
  overflow: hidden;
  color: #9aa4ae;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-summary-copy p {
  overflow: hidden;
  margin: 4px 0 0;
  color: #6f7e8d;
  font-size: 9px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-time {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
}

.log-time strong {
  color: #607284;
  font-size: 10px;
}

.log-time small {
  margin-top: 3px;
  color: #9aa5af;
  font-size: 8px;
}

.log-full-content {
  margin: 0 4px 12px 48px;
  padding: 11px 12px;
  border-left: 2px solid #c9dae8;
  border-radius: 0 8px 8px 0;
  background: #f5f8fa;
  color: #516273;
  font-size: 10px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.weekly-log-item .log-full-content {
  border-left-color: #d5caea;
}

.inline-empty {
  display: flex;
  min-height: 130px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  border: 1px dashed #dfe5ea;
  border-radius: 10px;
  color: #99a4ae;
  font-size: 10px;
}

@media (max-width: 980px) {
  .log-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .log-content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .worklog-overview {
    padding: 18px;
  }

  .worklog-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .log-stat-grid {
    grid-template-columns: 1fr;
  }

  .panel-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
}
</style>
