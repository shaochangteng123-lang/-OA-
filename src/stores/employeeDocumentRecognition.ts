import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  createEmployeeDocumentUploadIssue,
  type EmployeeDocumentUploadIssue,
  type EmployeeDocumentUploadIssueType,
} from "@/utils/employeeDocumentUploadIssues";

export type EmployeeDocumentRecognitionTaskStatus =
  | "queued"
  | "processing"
  | "success"
  | "warning"
  | "error";

export type EmployeeDocumentRecognitionOutcomeType = Extract<
  EmployeeDocumentUploadIssueType,
  "success" | "warning" | "error"
>;

export interface EmployeeDocumentRecognitionTask {
  id: string;
  employeeId: string;
  employeeName: string;
  fileName: string;
  status: EmployeeDocumentRecognitionTaskStatus;
  message: string;
  order: number;
  completionOrder: number | null;
  dismissed: boolean;
}

export interface EmployeeDocumentRecognitionOutcome {
  type: EmployeeDocumentRecognitionOutcomeType;
  message: string;
}

interface EmployeeDocumentRecognitionTaskInput {
  employeeId: string;
  employeeName: string;
  fileName: string;
}

interface EmployeeDocumentUploadIssueInput {
  employeeId: string;
  employeeName: string;
  type: EmployeeDocumentUploadIssueType;
  message: string;
}

type EmployeeDocumentRecognitionRunner = (
  taskId: string,
) => Promise<EmployeeDocumentRecognitionOutcome>;

type PendingEmployeeDocumentRecognitionTask =
  EmployeeDocumentRecognitionTask & {
    status: "queued" | "processing";
  };

type CompletedEmployeeDocumentRecognitionTask =
  EmployeeDocumentRecognitionTask & {
    status: EmployeeDocumentRecognitionOutcomeType;
  };

const isPendingTask = (
  task: EmployeeDocumentRecognitionTask,
): task is PendingEmployeeDocumentRecognitionTask =>
  task.status === "queued" || task.status === "processing";

const isCompletedTask = (
  task: EmployeeDocumentRecognitionTask,
): task is CompletedEmployeeDocumentRecognitionTask =>
  task.status === "success" ||
  task.status === "warning" ||
  task.status === "error";

let employeeDocumentRecognitionTaskSequence = 0;

// 全局共享同一条队列，页面切换后仍保持文件串行处理
export const useEmployeeDocumentRecognitionStore = defineStore(
  "employee-document-recognition",
  () => {
    const tasks = ref<EmployeeDocumentRecognitionTask[]>([]);
    const issues = ref<EmployeeDocumentUploadIssue[]>([]);
    const completionSequence = ref(0);
    const lastCompletedEmployeeId = ref<string | null>(null);
    let taskQueue: Promise<void> = Promise.resolve();

    const pendingTasks = computed(() =>
      tasks.value
        .filter(isPendingTask)
        .sort((left, right) => left.order - right.order),
    );
    const pendingCount = computed(() => pendingTasks.value.length);
    const currentTask = computed(
      () =>
        pendingTasks.value.find((task) => task.status === "processing") ||
        pendingTasks.value[0] ||
        null,
    );
    const latestUndismissedResult = computed(
      () =>
        tasks.value
          .filter((task) => isCompletedTask(task) && !task.dismissed)
          .sort(
            (left, right) =>
              (right.completionOrder || 0) - (left.completionOrder || 0),
          )[0] || null,
    );

    const findTask = (taskId: string) =>
      tasks.value.find((task) => task.id === taskId);

    const completeTask = (
      taskId: string,
      outcome: EmployeeDocumentRecognitionOutcome,
    ) => {
      const task = findTask(taskId);
      if (!task || isCompletedTask(task)) return;

      completionSequence.value += 1;
      task.status = outcome.type;
      task.message = outcome.message;
      task.completionOrder = completionSequence.value;
      task.dismissed = false;
      lastCompletedEmployeeId.value = task.employeeId;
    };

    const runTask = async (
      taskId: string,
      runner: EmployeeDocumentRecognitionRunner,
    ) => {
      const task = findTask(taskId);
      if (!task) return;
      task.status = "processing";
      task.message = "";

      try {
        completeTask(taskId, await runner(taskId));
      } catch {
        completeTask(taskId, {
          type: "error",
          message: `员工「${task.employeeName}」文件「${task.fileName}」识别任务异常结束，请刷新档案后重试`,
        });
      }
    };

    const enqueueTask = (
      input: EmployeeDocumentRecognitionTaskInput,
      runner: EmployeeDocumentRecognitionRunner,
    ) => {
      employeeDocumentRecognitionTaskSequence += 1;
      const taskId = `employee-document-recognition-${employeeDocumentRecognitionTaskSequence}`;
      tasks.value.push({
        id: taskId,
        ...input,
        status: "queued",
        message: "",
        order: employeeDocumentRecognitionTaskSequence,
        completionOrder: null,
        dismissed: false,
      });

      taskQueue = taskQueue
        .then(() => runTask(taskId, runner))
        .catch(() => {
          const task = findTask(taskId);
          if (!task || isCompletedTask(task)) return;
          completeTask(taskId, {
            type: "error",
            message: `员工「${task.employeeName}」文件「${task.fileName}」识别任务异常结束，请刷新档案后重试`,
          });
        });

      return taskId;
    };

    const addIssue = (
      input: EmployeeDocumentUploadIssueInput,
      taskId?: string,
    ) => {
      if (taskId && !findTask(taskId)) return null;
      const issue = createEmployeeDocumentUploadIssue(input);
      issues.value.unshift(issue);
      return issue;
    };

    const dismissIssue = (issueId: string) => {
      issues.value = issues.value.filter((issue) => issue.id !== issueId);
    };

    const dismissTaskResult = (taskId: string) => {
      const task = findTask(taskId);
      if (task && isCompletedTask(task)) task.dismissed = true;
    };

    const clearAll = () => {
      tasks.value = [];
      issues.value = [];
      completionSequence.value = 0;
      lastCompletedEmployeeId.value = null;
    };

    return {
      tasks,
      issues,
      pendingTasks,
      pendingCount,
      currentTask,
      latestUndismissedResult,
      completionSequence,
      lastCompletedEmployeeId,
      enqueueTask,
      addIssue,
      dismissIssue,
      dismissTaskResult,
      clearAll,
    };
  },
);
