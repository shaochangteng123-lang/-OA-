<template>
  <div class="yl-page settings-page">
    <div class="yl-page-header">
      <h1>个人设置</h1>
    </div>

    <div class="settings-content">
      <!-- 用户信息卡片 -->
      <el-card class="settings-card">
        <template #header>
          <div class="card-header">
            <el-icon><User /></el-icon>
            <span>账号信息</span>
          </div>
        </template>

        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户名">
            {{ authStore.user?.name || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="邮箱">
            {{ authStore.user?.email || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="角色">
            <el-tag :type="getRoleTagType(authStore.user?.role || '')">
              {{ getRoleLabel(authStore.user?.role || "") }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card
        v-if="!isBoss"
        v-loading="signatureLoading"
        class="settings-card"
      >
        <template #header>
          <div class="card-header">
            <el-icon><EditPen /></el-icon>
            <span>电子签名</span>
            <el-tag
              v-if="signatureLocked"
              class="signature-status"
              type="success"
              effect="light"
            >
              已确认并锁定
            </el-tag>
          </div>
        </template>

        <div class="signature-profile-list">
          <section class="personal-signature-panel">
            <div class="signature-profile-heading">
              <div>
                <h3>本人签名</h3>
                <p>用于本人参与的转正申请或审批环节</p>
              </div>
              <el-tag
                v-if="personalSignature"
                type="success"
                effect="plain"
                size="small"
              >
                {{ personalSignature.ownerName }}
              </el-tag>
            </div>

            <div class="personal-signature-preview">
              <img
                v-if="personalSignature"
                :src="personalSignature.dataUrl"
                alt="本人电子签名"
              />
              <el-empty
                v-else
                description="尚未保存本人签名"
                :image-size="58"
              />
            </div>

            <div class="signature-actions">
              <el-button
                type="primary"
                :icon="Upload"
                :disabled="signatureLocked"
                @click="openSignatureDialog"
              >
                {{ signatureLocked ? "签名已锁定" : "上传签名" }}
              </el-button>
            </div>

            <p v-if="personalSignature?.updatedAt" class="signature-updated">
              确认时间：{{ formatSignatureTime(personalSignature.updatedAt) }}
            </p>
          </section>
        </div>
      </el-card>

      <!-- 修改密码卡片 -->
      <el-card class="settings-card">
        <template #header>
          <div class="card-header">
            <el-icon><Lock /></el-icon>
            <span>修改密码</span>
          </div>
        </template>

        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-width="100px"
          style="max-width: 480px"
        >
          <el-form-item label="当前密码" prop="currentPassword">
            <el-input
              v-model="passwordForm.currentPassword"
              type="password"
              placeholder="请输入当前密码"
              show-password
            />
          </el-form-item>

          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="请输入新密码（至少6个字符）"
              show-password
            />
          </el-form-item>

          <el-form-item label="确认密码" prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              show-password
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              :loading="passwordLoading"
              @click="handleChangePassword"
            >
              修改密码
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <el-dialog
      v-model="signatureDialogVisible"
      :title="signatureDialogTitle"
      width="560px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div v-loading="signatureSaving">
        <ElectronicSignaturePicker @confirm="handleSaveSignature" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { EditPen, Lock, Upload, User } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/utils/api";
import ElectronicSignaturePicker from "@/components/common/ElectronicSignaturePicker.vue";
import {
  loadPersonalSignatureState,
  savePersonalSignature,
  type PersonalSignatureData,
} from "@/utils/personalSignature";

const authStore = useAuthStore();

const passwordFormRef = ref<FormInstance>();
const passwordLoading = ref(false);
const signatureLoading = ref(false);
const signatureSaving = ref(false);
const signatureDialogVisible = ref(false);
const personalSignature = ref<PersonalSignatureData | null>(null);
const signatureLocked = ref(false);
const isBoss = computed(() => authStore.user?.role === "boss");
const signatureDialogTitle = "上传本人电子签名";

// 密码表单
const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

// 验证确认密码
const validateConfirmPassword = (
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void,
) => {
  if (value !== passwordForm.newPassword) {
    callback(new Error("两次输入的密码不一致"));
  } else {
    callback();
  }
};

// 表单验证规则
const passwordRules: FormRules = {
  currentPassword: [
    { required: true, message: "请输入当前密码", trigger: "blur" },
  ],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "密码至少需要6个字符", trigger: "blur" },
    { max: 128, message: "密码不能超过128个字符", trigger: "blur" },
  ],
  confirmPassword: [
    { required: true, message: "请确认新密码", trigger: "blur" },
    { validator: validateConfirmPassword, trigger: "blur" },
  ],
};

// 获取角色标签类型
function getRoleTagType(
  role: string,
): "success" | "warning" | "danger" | "info" {
  const roleMap: Record<string, "success" | "warning" | "danger" | "info"> = {
    super_admin: "danger",
    chairman: "danger",
    admin: "warning",
    general_manager: "danger",
    boss: "danger",
    user: "success",
    guest: "info",
  };
  return roleMap[role] || "info";
}

// 获取角色标签文字
function getRoleLabel(role: string): string {
  const roleMap: Record<string, string> = {
    super_admin: "超级管理员",
    chairman: "董事长",
    admin: "管理员",
    general_manager: "总经理",
    boss: "BOSS",
    user: "普通用户",
    guest: "访客",
  };
  return roleMap[role] || role;
}

function formatSignatureTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  const requestError = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return (
    requestError.response?.data?.message || requestError.message || fallback
  );
}

async function fetchPersonalSignature() {
  signatureLoading.value = true;
  try {
    const state = await loadPersonalSignatureState();
    personalSignature.value = state.signature;
    signatureLocked.value = state.status.locked;
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "获取电子签名失败"));
  } finally {
    signatureLoading.value = false;
  }
}

function openSignatureDialog() {
  if (signatureLocked.value) {
    ElMessage.info("个人电子签名确认后已锁定，不能重复上传");
    return;
  }
  signatureDialogVisible.value = true;
}

async function handleSaveSignature(dataUrl: string) {
  try {
    await ElMessageBox.confirm(
      "请确认签名方向和笔迹完整。确认后不能再次上传、更换或删除。",
      "确认并锁定本人签名",
      {
        confirmButtonText: "确认并锁定",
        cancelButtonText: "返回检查",
        type: "warning",
      },
    );
  } catch {
    return;
  }

  signatureSaving.value = true;
  try {
    const saved = await savePersonalSignature(dataUrl);
    personalSignature.value = saved;
    signatureLocked.value = true;
    signatureDialogVisible.value = false;
    ElMessage.success("本人电子签名已确认并锁定");
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "保存电子签名失败"));
  } finally {
    signatureSaving.value = false;
  }
}

// 修改密码
async function handleChangePassword() {
  if (!passwordFormRef.value) return;

  try {
    await passwordFormRef.value.validate();
  } catch {
    return;
  }

  try {
    passwordLoading.value = true;

    const response = await api.post("/api/auth/change-password", {
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });

    if (response.data.success) {
      ElMessage.success("密码修改成功");
      // 清空表单
      passwordFormRef.value?.resetFields();
    }
  } catch (error: unknown) {
    ElMessage.error(getRequestErrorMessage(error, "密码修改失败"));
  } finally {
    passwordLoading.value = false;
  }
}

onMounted(() => {
  if (!isBoss.value) {
    fetchPersonalSignature();
  }
});
</script>

<style scoped>
/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.settings-page {
  min-height: calc(100vh - 60px);
  margin: calc(-1 * var(--yl-main-padding-y, 24px))
    calc(-1 * var(--yl-main-padding-x, 45px));
  padding: 24px;
}

.settings-content {
  max-width: min(800px, 100%);
}

.settings-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.signature-status {
  margin-left: auto;
}

.signature-profile-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.personal-signature-panel {
  min-width: 0;
}

.signature-profile-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 48px;
  margin-bottom: 10px;
  gap: 12px;
}

.signature-profile-heading h3 {
  margin: 0;
  color: #303133;
  font-size: 15px;
}

.signature-profile-heading p {
  margin: 5px 0 0;
  color: #909399;
  font-size: 12px;
  line-height: 18px;
}

.personal-signature-preview {
  display: grid;
  height: 150px;
  overflow: hidden;
  border: 1px dashed #c0c4cc;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #eef0f3 25%, transparent 25%),
    linear-gradient(-45deg, #eef0f3 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef0f3 75%),
    linear-gradient(-45deg, transparent 75%, #eef0f3 75%);
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  place-items: center;
}

.personal-signature-preview img {
  display: block;
  max-width: 88%;
  max-height: 112px;
  object-fit: contain;
}

.signature-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.signature-updated {
  margin: 10px 0 0;
  color: #909399;
  font-size: 12px;
}

:deep(.el-descriptions__label) {
  width: 100px;
}

@media (max-width: 560px) {
  .signature-profile-list {
    grid-template-columns: 1fr;
  }

  .signature-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
