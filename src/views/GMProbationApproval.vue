<template>
  <div class="gm-probation-approval">
    <!-- 状态筛选标签 -->
    <div class="filter-bar">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="待我签署" name="submitted" />
        <el-tab-pane label="本月已审批" name="approved" />
        <el-tab-pane label="全部查询" name="" />
      </el-tabs>
    </div>

    <!-- 全部查询搜索栏 -->
    <div v-if="activeTab === ''" class="search-bar">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="姓名">
          <el-input
            v-model="searchForm.name"
            placeholder="全部"
            clearable
            style="width: 130px"
          />
        </el-form-item>
        <el-form-item label="部门">
          <el-select
            v-model="searchForm.department"
            placeholder="全部"
            clearable
            style="width: 140px"
          >
            <el-option
              v-for="dept in departmentList"
              :key="dept"
              :label="dept"
              :value="dept"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="searchForm.status"
            placeholder="全部"
            clearable
            style="width: 130px"
          >
            <el-option label="实习期" value="pending" />
            <el-option label="签署中" value="submitted" />
            <el-option label="已转正" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="handleSearch"
            >查询</el-button
          >
          <el-button @click="handleResetSearch">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <ProbationSignatureTasks
      v-if="activeTab === 'submitted'"
      ref="signatureTasksRef"
      :show-title="false"
      @updated="handleSignatureUpdated"
    />

    <el-table
      v-else
      :data="displayList"
      stripe
      class="probation-table"
      empty-text="暂无转正记录"
    >
      <el-table-column label="序号" width="50" align="center">
        <template #default="{ $index }">{{ $index + 1 }}</template>
      </el-table-column>
      <el-table-column label="申请人" min-width="90" align="center">
        <template #default="{ row }">
          <div class="applicant-cell">
            <el-avatar :size="28"
              ><el-icon><User /></el-icon
            ></el-avatar>
            <span>{{ row.employee_name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="部门" min-width="84" align="center">
        <template #default="{ row }">{{
          row.employee_department || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="职位" min-width="84" align="center">
        <template #default="{ row }">{{
          row.employee_position || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="入职日期" min-width="92" align="center">
        <template #default="{ row }">{{
          formatDateOnly(row.hire_date)
        }}</template>
      </el-table-column>
      <el-table-column label="试用期截止" min-width="92" align="center">
        <template #default="{ row }">{{
          formatDateOnly(row.probation_end_date)
        }}</template>
      </el-table-column>
      <el-table-column label="剩余天数" min-width="78" align="center">
        <template #default="{ row }">
          <span
            :class="{
              'text-danger':
                row.probation_end_date &&
                getRemainingDaysNum(row.probation_end_date) < 0,
              'text-warning':
                row.probation_end_date &&
                getRemainingDaysNum(row.probation_end_date) <= 30 &&
                getRemainingDaysNum(row.probation_end_date) >= 0,
            }"
          >
            {{ getRemainingDaysText(row.probation_end_date) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="76" align="center">
        <template #default="{ row }">
          <el-tag :type="getProbationStatusType(row.status)" size="small">
            {{ getProbationStatusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" min-width="122" align="center">
        <template #default="{ row }">{{
          row.submit_time ? formatDateTime(row.submit_time) : "-"
        }}</template>
      </el-table-column>
      <el-table-column label="操作" min-width="198" align="center">
        <template #default="{ row }">
          <div class="action-buttons">
            <!-- 虚拟记录（未提交过转正申请的实习期员工）不显示操作按钮 -->
            <template v-if="isVirtualRecord(row)">
              <span class="no-action-text">未申请转正</span>
            </template>
            <template v-else>
              <el-button
                type="primary"
                size="small"
                :icon="View"
                @click="handleViewProbation(row)"
              >
                详情
              </el-button>
              <!-- 已提交/已审批/已驳回都显示审批流程按钮 -->
              <el-button
                v-if="
                  ['submitted', 'approved', 'rejected'].includes(row.status)
                "
                type="info"
                size="small"
                :icon="List"
                @click="handleViewApprovalFlow(row)"
              >
                审批流程
              </el-button>
            </template>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      title="转正申请详情"
      width="min(920px, 94vw)"
      top="4vh"
      :close-on-click-modal="false"
    >
      <div v-if="detailRow">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{
            detailRow.employee_name
          }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{
            detailRow.employee_department || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="职位">{{
            detailRow.employee_position || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{
            detailRow.employee_mobile || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="入职日期">{{
            formatDateOnly(detailRow.hire_date)
          }}</el-descriptions-item>
          <el-descriptions-item label="试用期截止">{{
            formatDateOnly(detailRow.probation_end_date)
          }}</el-descriptions-item>
          <el-descriptions-item label="剩余天数">
            <span
              :class="{
                'text-danger':
                  detailRow.probation_end_date &&
                  getRemainingDaysNum(detailRow.probation_end_date) < 0,
                'text-warning':
                  detailRow.probation_end_date &&
                  getRemainingDaysNum(detailRow.probation_end_date) <= 30 &&
                  getRemainingDaysNum(detailRow.probation_end_date) >= 0,
              }"
            >
              {{ getRemainingDaysText(detailRow.probation_end_date) }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag
              :type="getProbationStatusType(detailRow.status)"
              size="small"
            >
              {{ getProbationStatusText(detailRow.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{
              detailRow.submit_time
                ? formatDateTime(detailRow.submit_time)
                : "-"
            }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailRow.application_comment"
            label="申请说明"
            :span="2"
          >
            {{ detailRow.application_comment }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailRow.self_statement"
            label="本人述职"
            :span="2"
          >
            <div class="detail-statement">{{ detailRow.self_statement }}</div>
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailRow.review_stage_label"
            label="当前环节"
          >
            {{ detailRow.review_stage_label }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailRow.approve_time"
            label="审批时间"
            :span="2"
          >
            {{ formatDateTime(detailRow.approve_time) }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="detailRow.approver_comment"
            label="审批意见"
            :span="2"
          >
            {{ detailRow.approver_comment }}
          </el-descriptions-item>
        </el-descriptions>
        <div v-if="detailRow.signatures?.length" style="margin-top: 20px">
          <div style="font-weight: 600; margin-bottom: 10px; color: #303133">
            电子签署记录
          </div>
          <el-table :data="detailRow.signatures" stripe size="small">
            <el-table-column label="环节" width="105">
              <template #default="{ row }">{{
                getSignatureStageText(row.stage)
              }}</template>
            </el-table-column>
            <el-table-column label="操作人" width="130">
              <template #default="{ row }">{{
                probationApprovalActorLabel(row)
              }}</template>
            </el-table-column>
            <el-table-column prop="opinion" label="意见">
              <template #default="{ row }">{{ row.opinion || "-" }}</template>
            </el-table-column>
            <el-table-column label="签署时间" width="145">
              <template #default="{ row }">{{
                formatDateTime(row.signed_at)
              }}</template>
            </el-table-column>
          </el-table>
        </div>
        <div
          v-if="
            detailRow.generated_documents &&
            detailRow.generated_documents.length > 0
          "
          style="margin-top: 20px"
        >
          <div style="font-weight: 600; margin-bottom: 6px; color: #303133">
            待盖章申请单（系统底稿）
          </div>
          <div class="document-section-tip">
            下载打印并完成盖章后，请到员工数据的“转正档案”上传正式文件。
          </div>
          <el-table :data="detailRow.generated_documents" stripe size="small">
            <el-table-column prop="file_name" label="文件名" />
            <el-table-column label="生成时间" width="150" align="center">
              <template #default="{ row: doc }">{{
                formatDateTime(doc.created_at)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="210" align="center">
              <template #default="{ row: doc }">
                <el-button
                  type="primary"
                  link
                  size="small"
                  :icon="View"
                  @click="previewDoc(detailRow.id, doc.id)"
                  >预览</el-button
                >
                <el-button
                  type="success"
                  link
                  size="small"
                  :icon="Download"
                  @click="downloadDoc(detailRow.id, doc.id)"
                  >下载</el-button
                >
                <el-button
                  type="warning"
                  link
                  size="small"
                  :icon="Printer"
                  @click="printDoc(detailRow.id, doc.id)"
                  >打印</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div style="margin-top: 20px">
          <div style="font-weight: 600; margin-bottom: 10px; color: #303133">
            正式转正申请单（盖章归档）
          </div>
          <el-table
            v-if="detailRow.documents && detailRow.documents.length > 0"
            :data="detailRow.documents"
            stripe
            size="small"
          >
            <el-table-column prop="file_name" label="文件名" />
            <el-table-column
              prop="uploaded_by_name"
              label="归档人"
              width="90"
              align="center"
            />
            <el-table-column label="归档时间" width="150" align="center">
              <template #default="{ row: doc }">{{
                formatDateTime(doc.created_at)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="210" align="center">
              <template #default="{ row: doc }">
                <el-button
                  type="primary"
                  link
                  size="small"
                  :icon="View"
                  @click="previewDoc(detailRow.id, doc.id)"
                  >预览</el-button
                >
                <el-button
                  type="success"
                  link
                  size="small"
                  :icon="Download"
                  @click="downloadDoc(detailRow.id, doc.id)"
                  >下载</el-button
                >
                <el-button
                  type="warning"
                  link
                  size="small"
                  :icon="Printer"
                  @click="printDoc(detailRow.id, doc.id)"
                  >打印</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          <el-empty
            v-else
            description="待管理员在员工转正档案上传正式盖章文件"
          />
        </div>
        <!-- 历史转正记录 -->
        <div
          v-if="
            detailRow.probation_history &&
            detailRow.probation_history.length > 0
          "
          style="margin-top: 20px"
        >
          <div style="font-weight: 600; margin-bottom: 10px; color: #303133">
            历史转正记录
          </div>
          <el-table :data="detailRow.probation_history" stripe size="small">
            <el-table-column label="入职时间" min-width="100" align="center">
              <template #default="{ row: h }">{{
                formatDateOnly(h.hire_date)
              }}</template>
            </el-table-column>
            <el-table-column label="试用期截止" min-width="100" align="center">
              <template #default="{ row: h }">{{
                formatDateOnly(h.probation_end_date)
              }}</template>
            </el-table-column>
            <el-table-column label="转正状态" min-width="80" align="center">
              <template #default="{ row: h }">
                <el-tag :type="getProbationStatusType(h.status)" size="small">
                  {{ getProbationStatusText(h.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="审批时间" min-width="130" align="center">
              <template #default="{ row: h }">{{
                h.approve_time ? formatDateTime(h.approve_time) : "-"
              }}</template>
            </el-table-column>
            <el-table-column label="重置原因" min-width="160">
              <template #default="{ row: h }">{{
                h.reset_reason || "-"
              }}</template>
            </el-table-column>
            <el-table-column label="重置时间" min-width="130" align="center">
              <template #default="{ row: h }">{{
                formatDateTime(h.reset_at)
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row: h }">
                <el-button
                  type="primary"
                  link
                  @click="handleViewHistoryApproval(h)"
                >
                  审批记录
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="historyFlowVisible"
      title="历史审批记录"
      width="min(880px, 94vw)"
      :close-on-click-modal="false"
      append-to-body
    >
      <el-skeleton v-if="historyFlowLoading" :rows="6" animated />
      <template v-else-if="historyFlowRow">
        <el-descriptions :column="2" border size="small" class="history-meta">
          <el-descriptions-item label="入职日期">
            {{ formatDateOnly(historyFlowRow.hire_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="试用期截止">
            {{ formatDateOnly(historyFlowRow.probation_end_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="转正状态">
            {{ getProbationStatusText(historyFlowRow.status) }}
          </el-descriptions-item>
          <el-descriptions-item label="审批时间">
            {{
              historyFlowRow.approve_time
                ? formatDateTime(historyFlowRow.approve_time)
                : "-"
            }}
          </el-descriptions-item>
          <el-descriptions-item label="重置时间">
            {{ formatDateTime(historyFlowRow.reset_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="重置原因">
            {{ historyFlowRow.reset_reason || "-" }}
          </el-descriptions-item>
        </el-descriptions>

        <ProbationApprovalRecords
          v-if="historyFlowSignatures.length || historyFlowRecords.length"
          :records="historyFlowSignatures"
          :fallback-records="historyFlowRecords"
          :current-version="historyFlowRow.form_version"
          :review-stage="historyFlowRow.review_stage"
          :status="historyFlowRow.status"
        />
        <el-empty
          v-else
          description="暂无历史审批明细，该记录可能产生于审批快照启用前"
        />
      </template>
      <template #footer>
        <el-button @click="historyFlowVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 审批流程弹窗 -->
    <el-dialog
      v-model="flowVisible"
      title="审批流程"
      width="560px"
      :close-on-click-modal="false"
    >
      <div v-if="flowRow" class="flow-dialog">
        <!-- 基本信息 -->
        <el-descriptions
          :column="2"
          border
          size="small"
          style="margin-bottom: 20px"
        >
          <el-descriptions-item label="申请人">{{
            flowRow.employee_name
          }}</el-descriptions-item>
          <el-descriptions-item label="部门">{{
            flowRow.employee_department || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="当前状态">
            <el-tag :type="getProbationStatusType(flowRow.status)" size="small">
              {{ getProbationStatusText(flowRow.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">
            {{
              flowRow.submit_time ? formatDateTime(flowRow.submit_time) : "-"
            }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 时间线 -->
        <div class="flow-section-title">审批流程</div>
        <el-timeline v-if="!flowLoading">
          <!-- 所有历史记录（过滤 cc 和 withdraw） -->
          <el-timeline-item
            v-for="record in flowRecords.filter(
              (r) => r.action !== 'cc' && r.action !== 'withdraw',
            )"
            :key="record.id"
            :timestamp="formatDateTime(record.action_time)"
            placement="top"
            :type="getActionType(record.action)"
          >
            <div class="tl-title">{{ getActionTitle(record) }}</div>
            <div
              v-if="['submit', 'resubmit', 'withdraw'].includes(record.action)"
              class="tl-desc"
            >
              <template v-if="record.action === 'withdraw'"
                >{{ record.approver_name }} 撤回了转正申请</template
              >
              <template v-else-if="record.action === 'resubmit'">
                {{ record.approver_name }} 重新提交了转正申请
                <div v-if="record.comment" class="tl-comment">
                  {{ formatSubmitComment(record.comment) }}
                </div>
              </template>
              <template v-else>
                {{ record.approver_name }}
                {{
                  flowRecords
                    .filter(
                      (r: any) =>
                        r.action === "submit" || r.action === "resubmit",
                    )
                    .indexOf(record) > 0
                    ? "重新提交了转正申请"
                    : "提交了转正申请"
                }}
                <div v-if="record.comment" class="tl-comment">
                  {{ formatSubmitComment(record.comment) }}
                </div>
              </template>
            </div>
            <template v-else>
              <div class="tl-desc">
                <el-tag
                  :type="getActionType(record.action)"
                  size="small"
                  effect="dark"
                >
                  {{ getActionLabel(record.action) }}
                </el-tag>
              </div>
              <div
                v-if="record.action === 'reject' && record.comment"
                class="tl-reject-reason"
              >
                驳回原因：{{ record.comment }}
              </div>
              <div
                v-else-if="record.action === 'approve' && record.comment"
                class="tl-comment"
              >
                审批意见：{{ record.comment }}
              </div>
            </template>
          </el-timeline-item>

          <!-- 下一步：待审批 -->
          <el-timeline-item
            v-if="flowRow.status === 'submitted'"
            timestamp="待审批"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">
              {{ flowRow.review_stage_label || "分级签署" }}：
              {{ flowCurrentApprover }}
            </div>
            <div class="tl-desc">等待当前签署人填写意见并完成电子签名...</div>
          </el-timeline-item>

          <!-- 下一步：驳回后等待重新提交 -->
          <el-timeline-item
            v-if="flowRow.status === 'rejected'"
            timestamp="待处理"
            placement="top"
            type="warning"
          >
            <div class="tl-title tl-pending">重新提交</div>
            <div class="tl-desc">等待员工修改后重新提交...</div>
          </el-timeline-item>

          <!-- 已通过 -->
          <el-timeline-item
            v-if="flowRow.status === 'approved'"
            :timestamp="
              flowRow.approve_time ? formatDateTime(flowRow.approve_time) : ''
            "
            placement="top"
            type="success"
          >
            <div class="tl-title">转正完成</div>
            <div class="tl-desc" style="color: #67c23a">
              {{ flowRow.employee_name }} 已正式转正
            </div>
          </el-timeline-item>
        </el-timeline>
        <div v-else style="text-align: center; padding: 20px">
          <el-icon class="is-loading"><Loading /></el-icon>
        </div>
      </div>
      <template #footer>
        <el-button @click="flowVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import {
  Download,
  List,
  Loading,
  Printer,
  Search,
  User,
  View,
} from "@element-plus/icons-vue";
import { api } from "@/utils/api";
import { usePendingStore } from "@/stores/pending";
import { formatBeijingDateTimeMinute } from "@/utils/date";
import ProbationSignatureTasks from "@/components/probation/ProbationSignatureTasks.vue";
import ProbationApprovalRecords from "@/components/probation/ProbationApprovalRecords.vue";
import {
  probationApprovalActorLabel,
  probationApprovalTimelineRoleNameLabel,
  type ProbationApprovalRecord,
  type ProbationApproverNames,
} from "@/utils/probationApproval";

interface ArchivedApprovalRecord {
  id: string;
  action: string;
  comment: string | null;
  action_time: string;
  approver_name: string;
}

const pendingStore = usePendingStore();

const probationList = ref<any[]>([]);
const signatureTasksRef = ref<InstanceType<typeof ProbationSignatureTasks>>();
const detailVisible = ref(false);
const detailRow = ref<any>(null);
const activeTab = ref("submitted");
const departmentList = ref<string[]>([]);

// 全部查询搜索条件
const searchForm = reactive({ name: "", department: "", status: "" });
const appliedSearch = reactive({ name: "", department: "", status: "" });

// 审批流程弹窗
const flowVisible = ref(false);
const flowRow = ref<any>(null);
const flowRecords = ref<any[]>([]);
const flowApproverNames = ref<ProbationApproverNames>({});
const flowLoading = ref(false);
const historyFlowVisible = ref(false);
const historyFlowRow = ref<any>(null);
const historyFlowSignatures = ref<ProbationApprovalRecord[]>([]);
const historyFlowRecords = ref<ArchivedApprovalRecord[]>([]);
const historyFlowLoading = ref(false);
const flowCurrentApprover = computed(() => {
  const stage = flowRow.value?.review_stage as
    | "employee"
    | "supervisor"
    | "hr"
    | "general_manager"
    | undefined;
  const roles = {
    employee: "员工本人",
    supervisor: "总经理",
    hr: "管理员",
    general_manager: "董事长",
  } as const;
  if (!stage) return "待分配";
  const name = flowApproverNames.value[stage]?.trim();
  return name ? `${roles[stage]} ${name}` : roles[stage];
});

const displayList = computed(() => {
  if (activeTab.value !== "") return probationList.value;
  return probationList.value.filter((item) => {
    const nameMatch =
      !appliedSearch.name ||
      (item.employee_name || "").includes(appliedSearch.name);
    const deptMatch =
      !appliedSearch.department ||
      item.employee_department === appliedSearch.department;
    const statusMatch =
      !appliedSearch.status || item.status === appliedSearch.status;
    return nameMatch && deptMatch && statusMatch;
  });
});

// 判断是否为虚拟记录（没有提交过转正申请的实习期员工）
function isVirtualRecord(row: any): boolean {
  return typeof row.id === "string" && row.id.startsWith("virtual_");
}

function handleSearch() {
  appliedSearch.name = searchForm.name;
  appliedSearch.department = searchForm.department;
  appliedSearch.status = searchForm.status;
}

function handleResetSearch() {
  searchForm.name = "";
  searchForm.department = "";
  searchForm.status = "";
  appliedSearch.name = "";
  appliedSearch.department = "";
  appliedSearch.status = "";
}

async function fetchDepartmentList() {
  try {
    const response = await api.get("/api/departments/org-options");
    if (response.data.success) {
      departmentList.value = Object.keys(response.data.data);
    }
  } catch {
    // 静默失败
  }
}

async function handleViewApprovalFlow(row: any) {
  flowRow.value = row;
  flowRecords.value = [];
  flowApproverNames.value = {};
  flowVisible.value = true;
  flowLoading.value = true;
  try {
    const res = await api.get(`/api/probation/${row.id}/approval-flow`);
    if (res.data.success) {
      flowRecords.value = res.data.data.records || [];
      flowApproverNames.value =
        res.data.data.confirmation?.approver_names || {};
    }
  } catch {
    // 静默失败
  } finally {
    flowLoading.value = false;
  }
}

async function handleViewHistoryApproval(row: any) {
  historyFlowRow.value = row;
  historyFlowSignatures.value = [];
  historyFlowRecords.value = [];
  historyFlowVisible.value = true;
  historyFlowLoading.value = true;
  try {
    const response = await api.get(
      `/api/probation/history/${encodeURIComponent(row.id)}/approval-flow`,
    );
    if (response.data.success) {
      historyFlowSignatures.value = response.data.data.signatures || [];
      historyFlowRecords.value = response.data.data.records || [];
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || "获取历史审批记录失败");
  } finally {
    historyFlowLoading.value = false;
  }
}

function getActionType(
  action: string,
): "success" | "danger" | "warning" | "info" | "primary" {
  const map: Record<
    string,
    "success" | "danger" | "warning" | "info" | "primary"
  > = {
    submit: "primary",
    resubmit: "primary",
    approve: "success",
    reject: "danger",
    withdraw: "warning",
  };
  return map[action] || "info";
}

function getActionLabel(action: string) {
  const map: Record<string, string> = {
    submit: "员工提交",
    resubmit: "重新提交",
    approve: "审批通过",
    reject: "审批驳回",
    withdraw: "撤回申请",
  };
  return map[action] || action;
}

function getActionTitle(record: any) {
  const actorName =
    record.approver_name || flowRow.value?.employee_name || "员工";
  if (["submit", "resubmit", "withdraw"].includes(record.action)) {
    return `员工本人 ${actorName}`;
  }
  return probationApprovalTimelineRoleNameLabel(record);
}

function formatSubmitComment(comment: string | null | undefined) {
  if (!comment) return "";
  return (
    comment
      .replace(/^员工(?:驳回后)?重新?提交转正申请；?/, "")
      .replace(/^员工提交转正申请；?/, "")
      .trim() || comment
  );
}

function formatDateOnly(dateStr: string) {
  if (!dateStr) return "-";
  return dateStr.split("T")[0].split(" ")[0];
}

function getRemainingDaysNum(endDate: string | null | undefined): number {
  if (!endDate) return -1;
  const end = new Date(endDate.split("T")[0]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getRemainingDaysText(endDate: string | null | undefined): string {
  if (!endDate) return "-";
  const days = getRemainingDaysNum(endDate);
  if (days < 0) return "已到期";
  if (days === 0) return "今天到期";
  return `${days}天`;
}

function formatDateTime(dateStr: string) {
  return formatBeijingDateTimeMinute(dateStr) || "-";
}

function getProbationStatusType(
  status: string,
): "success" | "warning" | "danger" | "info" {
  const typeMap: Record<string, "success" | "warning" | "danger" | "info"> = {
    pending: "info",
    submitted: "warning",
    approved: "success",
    rejected: "danger",
  };
  return typeMap[status] || "info";
}

function getProbationStatusText(status: string): string {
  const textMap: Record<string, string> = {
    pending: "实习期",
    submitted: "签署中",
    approved: "已转正",
    rejected: "已驳回",
  };
  return textMap[status] || status;
}

async function fetchProbationList() {
  try {
    const params: Record<string, string> = {};
    if (activeTab.value === "submitted") {
      params.status = "submitted";
    } else if (activeTab.value === "approved") {
      params.reviewedByMeThisMonth = "1";
    }
    const response = await api.get("/api/probation/list", { params });
    if (response.data.success) {
      probationList.value = response.data.data.list || [];
    }
  } catch (error) {
    console.error("获取转正列表失败:", error);
    ElMessage.error("获取转正列表失败");
  }
}

function handleTabChange() {
  fetchProbationList();
}

function handleViewProbation(row: any) {
  detailRow.value = row;
  detailVisible.value = true;
}

function formalDocumentUrl(
  confirmationId: string,
  docId: string,
  forceDownload = false,
) {
  const baseUrl = `/api/probation/${confirmationId}/documents/${docId}/download`;
  return forceDownload ? `${baseUrl}?download=1` : baseUrl;
}

function previewDoc(confirmationId: string, docId: string) {
  window.open(formalDocumentUrl(confirmationId, docId), "_blank");
}

function downloadDoc(confirmationId: string, docId: string) {
  const link = document.createElement("a");
  link.href = formalDocumentUrl(confirmationId, docId, true);
  link.download = "";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function printDoc(confirmationId: string, docId: string) {
  const printWindow = window.open(
    formalDocumentUrl(confirmationId, docId),
    "_blank",
  );
  if (!printWindow) {
    ElMessage.warning("浏览器阻止了打印窗口，请允许弹出窗口后重试");
    return;
  }
  printWindow.addEventListener(
    "load",
    () => {
      window.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch {
          ElMessage.info("正式文件已打开，请使用浏览器打印按钮");
        }
      }, 600);
    },
    { once: true },
  );
}

function getSignatureStageText(stage: string) {
  const labels: Record<string, string> = {
    employee: "员工本人",
    supervisor: "主管领导",
    hr: "人事部",
    general_manager: "董事长",
  };
  return labels[stage] || stage;
}

async function handleSignatureUpdated() {
  await pendingStore.refreshPendingCounts();
  if (activeTab.value !== "submitted") await fetchProbationList();
}

async function refresh() {
  await fetchProbationList();
  if (activeTab.value === "submitted") {
    await signatureTasksRef.value?.refresh?.();
  }
}

defineExpose({ refresh });

onMounted(() => {
  fetchDepartmentList();
  fetchProbationList();
});
</script>

<style scoped>
.gm-probation-approval {
  padding: 0;
}

.filter-bar {
  margin: -2px 0 12px;
}

.filter-bar :deep(.el-tabs__header) {
  margin: 0;
}

.filter-bar :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
  background: #edf0f5;
}

.filter-bar :deep(.el-tabs__item) {
  height: 40px;
  color: #6b7785;
  font-weight: 600;
}

.filter-bar :deep(.el-tabs__item.is-active) {
  color: #2c5aa0;
}

.search-bar {
  padding: 12px 14px;
  background: #f7f9fc;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  margin-bottom: 16px;
}

.search-form {
  margin-bottom: 0;
}

.search-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 12px;
}

.probation-table {
  width: 100%;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  overflow: hidden;
}

.probation-table :deep(.el-table__header-wrapper th.el-table__cell) {
  background: #f7f9fc;
  color: #44505f;
  font-weight: 700;
}

.probation-table :deep(.el-table__cell) {
  padding-top: 10px;
  padding-bottom: 10px;
}

.probation-table :deep(.cell) {
  padding-right: 6px;
  padding-left: 6px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}

.applicant-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.applicant-cell span {
  font-weight: 500;
}

.action-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
}

.no-action-text {
  color: #909399;
  font-size: 13px;
}

.flow-dialog {
  padding: 0 4px;
}

.history-meta {
  margin-bottom: 20px;
}

.flow-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.tl-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.tl-pending {
  color: #c0c4cc;
}

.tl-desc {
  font-size: 13px;
  color: #606266;
}

.tl-reject-reason {
  margin-top: 6px;
  padding: 8px 10px;
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 4px;
  font-size: 13px;
  color: #f56c6c;
}

.tl-comment {
  margin-top: 6px;
  font-size: 13px;
  color: #909399;
}

.text-danger {
  color: #f56c6c;
  font-weight: 600;
}

.text-warning {
  color: #e6a23c;
  font-weight: 600;
}

.no-action-text {
  color: #909399;
  font-size: 13px;
}

.detail-statement {
  min-height: 56px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.document-section-tip {
  margin-bottom: 10px;
  color: #909399;
  font-size: 12px;
  line-height: 1.6;
}
</style>
