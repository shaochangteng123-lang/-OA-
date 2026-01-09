<template>
  <div class="yl-page">
    <!-- 页面头部 -->
    <div class="yl-page-header">
      <div class="yl-page-title">
        <el-icon :size="24" color="var(--yl-primary)">
          <Setting />
        </el-icon>
        <h1>系统设置</h1>
      </div>
    </div>

    <!-- 设置区域 -->
    <div class="settings-grid">
      <!-- 用户管理卡片 -->
      <el-card class="settings-card" shadow="hover" @click="goTo('/users')">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-primary)">
            <User />
          </el-icon>
          <div class="settings-card-info">
            <h3>用户管理</h3>
            <p>管理系统用户、角色分配和权限控制</p>
          </div>
          <el-icon class="settings-card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 部门管理卡片 -->
      <el-card class="settings-card" shadow="hover" @click="goTo('/departments')">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-success)">
            <OfficeBuilding />
          </el-icon>
          <div class="settings-card-info">
            <h3>部门管理</h3>
            <p>管理政府部门信息、简称和网站链接</p>
          </div>
          <el-icon class="settings-card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 事件库卡片 -->
      <el-card class="settings-card" shadow="hover" @click="goTo('/events')">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-warning)">
            <Files />
          </el-icon>
          <div class="settings-card-info">
            <h3>事件库管理</h3>
            <p>管理全局事件库、事件类型和层级结构</p>
          </div>
          <el-icon class="settings-card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 预设方案卡片 -->
      <el-card class="settings-card" shadow="hover" @click="goTo('/presets')">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-info)">
            <Collection />
          </el-icon>
          <div class="settings-card-info">
            <h3>预设方案</h3>
            <p>管理项目预设模板和工作流配置</p>
          </div>
          <el-icon class="settings-card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 板块设置卡片 -->
      <el-card class="settings-card" shadow="hover" @click="goTo('/blocks')">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-danger)">
            <Grid />
          </el-icon>
          <div class="settings-card-info">
            <h3>板块设置</h3>
            <p>管理预设板块分类和区块配置</p>
          </div>
          <el-icon class="settings-card-arrow"><ArrowRight /></el-icon>
        </div>
      </el-card>

      <!-- 系统信息卡片 -->
      <el-card class="settings-card settings-card-info-only">
        <div class="settings-card-content">
          <el-icon :size="40" color="var(--yl-text-secondary)">
            <InfoFilled />
          </el-icon>
          <div class="settings-card-info">
            <h3>系统信息</h3>
            <p>版本: 1.0.0</p>
            <p>环境: {{ nodeEnv }}</p>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import {
  Setting,
  User,
  OfficeBuilding,
  Files,
  Collection,
  Grid,
  ArrowRight,
  InfoFilled,
} from '@element-plus/icons-vue'

const router = useRouter()
const nodeEnv = import.meta.env.MODE

function goTo(path: string) {
  router.push(path)
}
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: var(--yl-gap-lg);
}

.settings-card {
  cursor: pointer;
  transition: all 0.3s ease;
}

.settings-card:hover {
  transform: translateY(-2px);
}

.settings-card-info-only {
  cursor: default;
}

.settings-card-info-only:hover {
  transform: none;
}

.settings-card-content {
  display: flex;
  align-items: center;
  gap: var(--yl-gap-md);
  padding: var(--yl-padding-sm);
}

.settings-card-info {
  flex: 1;
}

.settings-card-info h3 {
  margin: 0 0 4px 0;
  font-size: var(--yl-font-size-lg);
  font-weight: var(--yl-font-weight-semibold);
  color: var(--yl-text-primary);
}

.settings-card-info p {
  margin: 0;
  font-size: var(--yl-font-size-small);
  color: var(--yl-text-secondary);
  line-height: 1.5;
}

.settings-card-arrow {
  color: var(--yl-text-placeholder);
  font-size: 20px;
}

@media (max-width: 768px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
