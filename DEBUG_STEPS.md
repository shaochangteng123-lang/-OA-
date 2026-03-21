# 调试步骤

## 1. 强制刷新浏览器
- Windows: 按 `Ctrl + Shift + R`
- Mac: 按 `Cmd + Shift + R`

## 2. 打开浏览器开发者工具
- 按 `F12` 或右键点击页面选择"检查"

## 3. 查看控制台（Console）标签
查找以下日志：
- `🚀 [大额] onMounted` - 组件是否挂载
- `🔄 [大额] loadDetail` - 是否开始加载数据
- `⚠️ loadReimbursementDetail: reimbursementId 为空` - ID 是否为空
- `❌` 开头的错误日志

## 4. 查看网络（Network）标签
1. 刷新页面
2. 查找 `/api/reimbursement/R...` 的请求
3. 检查：
   - 请求状态码（应该是 200）
   - 响应内容（Preview 标签）

## 5. 截图并发送
请截图发送：
- Console 标签的所有日志
- Network 标签中 `/api/reimbursement/` 请求的详情

## 6. 临时解决方案
如果以上都不行，请尝试：
```bash
# 在项目目录执行
docker compose down
docker compose up -d --build
```
然后等待 30 秒，再刷新浏览器。
