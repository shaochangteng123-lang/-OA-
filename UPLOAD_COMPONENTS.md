# yulilog-worklog 项目 - 上传组件完整分析

## 📁 项目结构概览

### 前端组件位置
```
/src/components/reimbursement/
├── InvoiceUploader.vue      (发票上传组件)
├── DeductionUploader.vue    (核减上传组件)
├── ReceiptUploader.vue      (无票上传组件)
├── InvoiceTable.vue         (发票明细表格)
└── TypeSelector.vue
```

### 后端服务位置
```
/server/routes/
├── reimbursement.ts         (报销相关API)
└── files.ts                 (文件处理)

/server/services/
├── localOcr.js             (发票OCR识别)
├── receiptOcr.js           (收据/无票OCR识别)
└── paymentProofOcr.js      (付款回单OCR识别)

/server/utils/
└── file-validation.ts       (文件验证工具)
```

---

## 🔍 组件详细分析

### 1️⃣ **InvoiceUploader.vue** (发票上传)

**文件路径**: `/Users/yuli/Desktop/yulilog-worklog/src/components/reimbursement/InvoiceUploader.vue`

#### 核心特性
- ✅ **拖拽上传**: 支持拖拽文件到组件
- ✅ **点击上传**: 通过 el-upload 组件实现
- ✅ **文件验证**: 仅支持 PDF 格式，单个不超过 5MB
- ✅ **缩略图显示**: PDF 以图标+文件名方式显示
- ✅ **文件预览**: 双击打开新窗口预览
- ✅ **文件删除**: 支持删除已上传文件

#### 模板关键代码
```vue
<el-upload
  ref="uploadRef"
  v-model:file-list="fileList"
  action="#"
  :auto-upload="false"
  :before-upload="beforeUpload"
  :on-change="onFileChange"
  accept=".pdf"
  list-type="picture-card"
  multiple
>
  <div class="upload-trigger">
    <el-icon class="upload-icon"><Plus /></el-icon>
    <div class="upload-text">上传发票</div>
  </div>
  
  <template #file="{ file }">
    <div class="invoice-preview" @dblclick="handlePreview(file)">
      <el-icon class="pdf-icon"><Document /></el-icon>
      <span class="file-name">{{ file.name }}</span>
      <el-icon v-if="!disabled" class="delete-icon" @click.stop="onDeleteFile(file)">
        <Delete />
      </el-icon>
    </div>
  </template>
</el-upload>
```

#### 拖拽逻辑
```typescript
// 拖拽进入
function handleDragOver(_e: DragEvent): void {
  if (props.disabled) return
  isDragging.value = true
}

// 拖拽离开
function handleDragLeave(e: DragEvent): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY
  if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
    isDragging.value = false
  }
}

// 处理拖拽放下
function handleDrop(e: DragEvent): void {
  isDragging.value = false
  if (props.disabled) return
  
  const files = e.dataTransfer?.files
  // 检查文件数量限制（默认 50 个）
  // 验证文件类型（PDF）和大小（5MB）
  // 通过 uploadRef.value.handleStart(file) 添加文件
}
```

#### Props 配置
```typescript
{
  modelValue: any[]           // v-model 绑定的文件列表
  disabled?: boolean          // 禁用上传
  themeColor?: string         // 主题色（默认 '#667eea'）
  maxFiles?: number           // 最多上传文件数（默认 50）
  existingDeductions?: any[]  // 已上传的核减发票（用于交叉查重）
}
```

#### 事件 Emits
```typescript
'update:modelValue'  // 文件列表变化
'file-change'        // 文件变化时触发
'delete-file'        // 删除文件时触发
```

---

### 2️⃣ **DeductionUploader.vue** (核减上传)

**文件路径**: `/Users/yuli/Desktop/yulilog-worklog/src/components/reimbursement/DeductionUploader.vue`

#### 核心特性
- ✅ **拖拽上传**: 支持拖拽 PDF 文件
- ✅ **自动识别**: 上传后自动 OCR 识别核减金额
- ✅ **交叉查重**: 防止与发票重复上传
- ✅ **实时验证**: 上传时进行前端和后端验证
- ✅ **文件预览**: 支持查看已上传的核减发票

#### 核减发票数据结构
```typescript
interface DeductionItem {
  id?: string
  amount: number              // 核减金额
  invoiceDate: string         // 发票日期
  invoiceNumber?: string      // 发票号码
  filePath?: string          // 文件存储路径
  fileHash?: string          // 文件哈希值（用于查重）
  status?: 'pending' | 'approved'  // 状态
  tempFile?: any
}
```

#### 上传流程
```typescript
async function onFileChange(file: any): Promise<void> {
  // 1. 前端验证文件格式和大小
  if (!beforeUpload(file.raw)) return
  
  // 2. 显示识别提示
  const loadingMessage = ElMessage({
    message: '正在识别核减发票...',
    type: 'info',
    duration: 0,  // 持久显示
  })
  
  // 3. 提交到后端进行 OCR 识别
  const formData = new FormData()
  formData.append('invoice', file.raw)
  const res = await api.post('/api/reimbursement/upload-deduction-invoice', formData, {
    timeout: 180000,  // 3 分钟超时
  })
  
  // 4. 前端查重（同时检查核减列表和发票列表）
  const duplicateInDeduction = deductionItems.value.find(
    item => item.fileHash === fileHash
  )
  if (duplicateInDeduction) {
    showUploadError('此核减发票已上传，请勿重复上传')
    return
  }
  
  // 5. 交叉查重：检查是否已在发票中上传
  const duplicateInInvoice = props.existingInvoices?.find(
    inv => inv.fileHash === fileHash
  )
  if (duplicateInInvoice) {
    showUploadError('此发票已在发票上传中上传，请勿重复上传')
    return
  }
  
  // 6. 添加到核减列表
  const newItem: DeductionItem = {
    amount: ocrResult.amount || 0,
    invoiceDate: ocrResult.date,
    invoiceNumber: ocrResult.invoiceNumber || '',
    filePath,
    fileHash,
  }
  const updated = [...deductionItems.value, newItem]
  emit('update:modelValue', updated)
}
```

#### 文件删除逻辑
```typescript
function handleFileRemove(file: any): void {
  // 通过多种方式查找对应的核减项
  // 方法1：通过 uid（fileHash）
  // 方法2：通过 url/filePath
  // 方法3：通过 name/invoiceNumber
  
  const index = deductionItems.value.findIndex(
    item => item.fileHash === file.uid
  )
  
  if (index > -1) {
    removeItem(index)
  }
}
```

#### Props 配置
```typescript
{
  modelValue: DeductionItem[]       // 核减项列表
  disabled?: boolean                // 禁用上传
  reimbursementId?: string          // 报销单 ID
  totalInvoiceAmount?: number       // 发票总金额
  yearlyDeductionUsed?: number      // 当年已使用的核减金额
  existingInvoices?: any[]          // 已上传的发票列表（交叉查重用）
}
```

---

### 3️⃣ **ReceiptUploader.vue** (无票上传)

**文件路径**: `/Users/yuli/Desktop/yulilog-worklog/src/components/reimbursement/ReceiptUploader.vue`

#### 核心特性
- ✅ **拖拽上传**: 支持拖拽图片文件
- ✅ **点击上传**: 通过 el-upload 选择文件
- ✅ **格式支持**: JPG、PNG 图片格式
- ✅ **缩略图显示**: 图片以预览缩略图方式显示
- ✅ **文件验证**: 仅支持 JPG/PNG，单个不超过 5MB
- ✅ **实时预览**: 上传后立即生成预览 URL

#### 模板关键代码
```vue
<el-upload
  accept=".jpg,.jpeg,.png"
  list-type="picture-card"
  multiple
>
  <div class="upload-trigger">
    <el-icon class="upload-icon"><Plus /></el-icon>
    <div class="upload-text">无票上传</div>
  </div>
  
  <template #file="{ file }">
    <div class="receipt-preview" @dblclick="handlePreview(file)">
      <!-- 优先显示已上传的图片 -->
      <img v-if="file.url || (file as any).serverPath" 
           :src="file.url || (file as any).serverPath" 
           class="preview-image" />
      <!-- 否则显示图标占位符 -->
      <el-icon v-else class="image-icon"><Picture /></el-icon>
      <span class="file-name">{{ file.name }}</span>
      <el-icon v-if="!disabled" class="delete-icon" @click.stop="onDeleteFile(file)">
        <Delete />
      </el-icon>
    </div>
  </template>
</el-upload>
```

#### 文件变化处理
```typescript
function onFileChange(file: any, fileListParam: any[]): void {
  // 为图片文件创建预览 URL（ObjectURL）
  if (file.raw && file.raw.type.startsWith('image/')) {
    file.url = URL.createObjectURL(file.raw)
  }
  emit('file-change', file, fileListParam)
}
```

#### 拖拽和验证
```typescript
// 拖拽放下处理
function handleDrop(e: DragEvent): void {
  const files = e.dataTransfer?.files
  
  // 验证文件类型（JPG/PNG）
  const isValidType = file.type === 'image/jpeg' || file.type === 'image/png'
  
  // 验证文件大小（5MB）
  const maxSize = 5 * 1024 * 1024
}
```

#### Props 配置
```typescript
{
  modelValue: any[]        // v-model 绑定的文件列表
  disabled?: boolean       // 禁用上传
  themeColor?: string      // 主题色（默认 '#67c23a'）
  maxFiles?: number        // 最多上传文件数（默认 50）
}
```

---

### 4️⃣ **InvoiceTable.vue** (发票明细表)

**文件路径**: `/Users/yuli/Desktop/yulilog-worklog/src/components/reimbursement/InvoiceTable.vue`

#### 核心功能
- 📊 **显示发票明细**: 普通发票 + 核减发票合并展示
- 💰 **金额计算**: 精确计算总金额、核减金额、实际报销金额
- 🔍 **缩略图预览**: 图片小图显示 + PDF 图标显示
- 📁 **文件预览**: 点击缩略图打开全屏预览
- 🗑️ **删除操作**: 支持删除发票记录

#### 表格列定义
```vue
<el-table-column prop="id" label="序号" width="50" />
<el-table-column prop="category" label="报销类型" min-width="160" />
<el-table-column prop="amount" label="金额" width="100" />
<el-table-column prop="invoiceDate" label="开票日期" width="130" />
<el-table-column prop="invoiceNumber" label="发票号码" min-width="300" />
<el-table-column label="缩略图" width="110">
  <!-- 显示图片预览或 PDF 图标 -->
</el-table-column>
<el-table-column label="操作" width="60">
  <!-- 删除按钮 -->
</el-table-column>
```

#### 缩略图显示逻辑
```typescript
// 判断是否为图片文件
function isImageFile(filePath: string): boolean {
  return checkImageFile(filePath)
}

// 模板中的条件渲染
<div v-if="isImageFile(row.filePath)" class="image-thumbnail">
  <img :src="getImageUrl(row.filePath)" alt="发票" class="thumbnail-image" />
</div>
<div v-else class="pdf-icon">
  <el-icon :size="30"><Document /></el-icon>
  <div style="font-size: 10px; margin-top: 2px;">PDF</div>
</div>
```

#### 核减相关计算
```typescript
// 运输/交通/汽油/柴油/通行费类发票小计
const transportFuelSubtotal = computed(() => {
  return props.invoiceList.reduce((acc, item) => {
    const category = item.category?.toLowerCase() || ''
    const isTransportOrFuel =
      category.includes('运输') ||
      category.includes('交通') ||
      category.includes('汽油') ||
      category.includes('柴油') ||
      category.includes('通行费')
    return isTransportOrFuel ? acc + item.amount : acc
  }, 0)
})

// 本年累计核减金额
const yearlyTotalDeduction = computed(() => {
  return props.yearlyDeductionUsed + currentTotalDeduction.value
})

// 实际报销金额
const actualReimbursementAmount = computed(() => {
  return Math.max(0, totalAmountNumber.value - effectiveDeduction.value)
})
```

#### 文件预览对话框
```vue
<el-dialog
  v-model="previewVisible"
  fullscreen
  class="preview-dialog"
>
  <div class="preview-container">
    <!-- 图片预览 -->
    <img v-if="previewImageUrl && !previewPdfUrl"
         :src="previewImageUrl"
         class="preview-image" />
    <!-- PDF 预览 -->
    <iframe v-if="previewPdfUrl"
            :src="previewPdfUrl"
            class="preview-pdf"
            frameborder="0" />
  </div>
</el-dialog>
```

---

## 🎨 上传组件的样式特点

### 统一的缩略图尺寸
```css
/* 缩小上传框尺寸 */
.upload :deep(.el-upload--picture-card) {
  width: 100px;
  height: 100px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .upload :deep(.el-upload--picture-card) {
    width: 80px;
    height: 80px;
  }
}
```

### 拖拽覆盖层动画
```css
.drag-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(102, 126, 234, 0.1);
  border: 2px dashed v-bind('props.themeColor');
  z-index: 1000;
}

.drag-icon {
  animation: bounce 1s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
```

### 缩略图样式
```css
.invoice-preview {
  background: linear-gradient(135deg, v-bind('props.themeColor') 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.pdf-icon { font-size: 36px; color: #fff; }
.file-name { font-size: 11px; color: #fff; -webkit-line-clamp: 2; }
.delete-icon { position: absolute; top: 6px; right: 6px; }
```

---

## 🔌 组件在页面中的使用示例

**文件**: `/src/views/BasicReimbursementCreate.vue`

```vue
<template>
  <div class="create-reimbursement-container">
    <!-- 两列布局：左侧发票，右侧无票 -->
    <div class="upload-layout">
      <!-- 发票上传 -->
      <div class="upload-left">
        <el-form-item label="发票上传" required>
          <InvoiceUploader
            v-model="invoice.fileList.value"
            theme-color="#667eea"
            :existing-deductions="deductionItems"
            @file-change="handleFileChange"
            @delete-file="handleDeleteFile"
          />
        </el-form-item>
      </div>

      <!-- 无票上传 -->
      <div class="upload-right">
        <el-form-item label="无票上传">
          <ReceiptUploader
            v-model="receiptFileList"
            theme-color="#67c23a"
            :existing-deductions="deductionItems"
            @file-change="handleReceiptChange"
            @delete-file="handleDeleteReceipt"
          />
        </el-form-item>
      </div>

      <!-- 核减上传 -->
      <div class="upload-deduction">
        <el-form-item label="核减上传">
          <DeductionUploader
            v-model="deductionItems"
            :total-invoice-amount="invoice.totalAmount.value"
            :yearly-deduction-used="0"
            :existing-invoices="invoice.invoiceList.value"
          />
        </el-form-item>
      </div>
    </div>

    <!-- 发票明细表格 -->
    <el-form-item label="发票明细" class="invoice-detail-item">
      <InvoiceTable
        :invoice-list="invoice.invoiceList.value"
        :readonly="false"
        :show-deduction="true"
        :monthly-used-quota="invoice.monthlyUsedQuota.value"
        :deduction-invoices="deductionItems"
        :total-invoice-amount="invoice.totalAmount.value"
        :yearly-deduction-used="yearlyDeductionUsed"
        @delete="handleDeleteInvoice"
      />
    </el-form-item>
  </div>
</template>

<script setup lang="ts">
import InvoiceUploader from '@/components/reimbursement/InvoiceUploader.vue'
import ReceiptUploader from '@/components/reimbursement/ReceiptUploader.vue'
import DeductionUploader from '@/components/reimbursement/DeductionUploader.vue'
import InvoiceTable from '@/components/reimbursement/InvoiceTable.vue'
</script>
```

---

## 🚀 后端上传处理 API

**文件**: `/server/routes/reimbursement.ts`

### 配置 Multer 用于不同类型文件上传

```typescript
// 发票上传（PDF）
const upload = multer({
  dest: tempDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('只支持PDF格式的文件'))
    }
  },
})

// 收据/无票上传（图片）
const uploadReceipt = multer({
  dest: tempDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png',
      'image/gif', 'image/bmp', 'image/webp',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 JPG、PNG、GIF、BMP、WEBP 格式的图片'))
    }
  },
})

// 付款回单上传（JPG/PNG）
const uploadPaymentProof = multer({
  dest: tempDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png']
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('付款回单只支持 JPG/PNG 格式'))
    }
  },
})
```

### OCR 识别服务

```typescript
import { recognizeInvoiceLocally } from '../services/localOcr.js'
import { recognizeReceipt } from '../services/receiptOcr.js'
import { recognizePaymentProof } from '../services/paymentProofOcr.js'
```

---

## 📋 文件验证工具

**文件**: `/server/utils/file-validation.ts`

```typescript
// 验证文件路径安全性
export function validateFilePath(filePath: string): boolean {
  // 防止路径穿越攻击
  // 检查是否包含 ../ 等危险字符
}
```

---

## 💡 关键特性总结

### 发票上传 (InvoiceUploader)
| 特性 | 实现方式 |
|------|---------|
| 拖拽上传 | `@drop.prevent="handleDrop"` |
| 点击上传 | `el-upload` 组件 |
| 文件验证 | `beforeUpload()` 函数 |
| 格式限制 | 仅 PDF |
| 大小限制 | 5MB |
| 缩略图 | PDF 图标 + 文件名 |
| 文件预览 | `window.open()` 新标签页 |
| 交叉查重 | 检查 `existingDeductions` |

### 核减上传 (DeductionUploader)
| 特性 | 实现方式 |
|------|---------|
| 自动识别 | OCR `/api/reimbursement/upload-deduction-invoice` |
| 拖拽上传 | 原生拖拽事件处理 |
| 格式限制 | 仅 PDF |
| 大小限制 | 5MB |
| 查重 | 双向查重（核减列表 + 发票列表） |
| 超时处理 | 180秒 (3分钟) |
| 缓存机制 | `deductionOcrCache` Map |
| 持久化提示 | `ElMessage` 不自动关闭 |

### 无票上传 (ReceiptUploader)
| 特性 | 实现方式 |
|------|---------|
| 拖拽上传 | `@drop.prevent="handleDrop"` |
| 点击上传 | `el-upload` 组件 |
| 文件验证 | `beforeUpload()` 函数 |
| 格式限制 | JPG、PNG |
| 大小限制 | 5MB |
| 缩略图 | 实时预览图片 |
| 文件预览 | 直接显示或转换 URL |
| ObjectURL | 上传后生成预览 URL |

---

## 📝 使用页面

- ✅ `/views/BasicReimbursementCreate.vue` - 基础报销新建
- ✅ `/views/BasicReimbursementDetail.vue` - 基础报销详情
- ✅ `/views/BusinessReimbursementCreate.vue` - 商务报销新建
- ✅ `/views/BusinessReimbursementDetail.vue` - 商务报销详情
- ✅ `/views/LargeReimbursementCreate.vue` - 大额报销新建
- ✅ `/views/LargeReimbursementDetail.vue` - 大额报销详情

---

**生成时间**: 2026-04-15
**项目路径**: /Users/yuli/Desktop/yulilog-worklog
