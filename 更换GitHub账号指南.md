# 更换 GitHub 账号指南

## 📋 方法汇总

### 方法一：通过 GitHub 网站撤销授权（最简单）

1. **访问授权应用页面**
   - 打开：https://github.com/settings/applications
   - 使用当前 GitHub 账号登录

2. **撤销 Cursor 授权**
   - 找到 "Authorized OAuth Apps"（已授权的 OAuth 应用）
   - 找到 Cursor 应用
   - 点击 "Revoke"（撤销）

3. **重新授权**
   - 在 Cursor 中使用 GitHub 功能时
   - 系统会提示重新登录
   - 选择要使用的新账号登录

### 方法二：更新 Git 配置

#### 步骤1：更新全局 Git 用户信息

```bash
# 设置新的用户名和邮箱
git config --global user.name "新GitHub用户名"
git config --global user.email "新GitHub邮箱"
```

#### 步骤2：清除旧的凭证

**清除 macOS 钥匙串中的 GitHub 凭证：**
```bash
# 清除 github.com 的凭证
security delete-internet-password -s github.com

# 清除 api.github.com 的凭证
security delete-internet-password -s api.github.com
```

**或者通过钥匙串访问应用：**
1. 打开"钥匙串访问"（Keychain Access）
2. 搜索 "github"
3. 删除所有 GitHub 相关条目

#### 步骤3：更新远程仓库 URL（如果已配置）

```bash
# 查看当前远程仓库
git remote -v

# 更新为新账号的仓库
git remote set-url origin https://github.com/新用户名/仓库名.git
```

### 方法三：在 Cursor 中更换（如果支持）

1. **打开命令面板**
   - 按 `Cmd + Shift + P`（Mac）
   - 或 `Ctrl + Shift + P`（Windows/Linux）

2. **登出当前账号**
   - 输入：`GitHub: Sign Out`
   - 或搜索：`sign out`

3. **登录新账号**
   - 输入：`GitHub: Sign In`
   - 或搜索：`sign in`
   - 选择要使用的新账号

### 方法四：清除所有 Git 凭证缓存

```bash
# 清除 Git 凭证缓存
git credential-osxkeychain erase
host=github.com
protocol=https

# 或者重置 credential helper
git config --global --unset credential.helper
git config --global credential.helper osxkeychain
```

## 🔍 验证是否更换成功

### 检查 Git 配置
```bash
git config --global user.name
git config --global user.email
```

### 测试 GitHub 连接
```bash
# 测试 GitHub 连接（会提示输入新账号的凭证）
git ls-remote https://github.com/新用户名/测试仓库.git
```

### 检查当前使用的账号
```bash
# 查看 Git 配置
git config --global --list | grep user
```

## 📝 完整操作示例

假设要更换为新的 GitHub 账号：

```bash
# 1. 更新 Git 用户信息
git config --global user.name "新用户名"
git config --global user.email "新邮箱@example.com"

# 2. 清除旧凭证
security delete-internet-password -s github.com
security delete-internet-password -s api.github.com

# 3. 如果项目已关联远程仓库，更新 URL
git remote set-url origin https://github.com/新用户名/仓库名.git

# 4. 验证配置
git config --global --list | grep user
```

## ⚠️ 注意事项

1. **撤销授权后**：需要重新授权才能使用 GitHub 功能
2. **更新 Git 配置**：只影响 Git 提交的作者信息，不影响 GitHub 登录
3. **远程仓库 URL**：如果更换账号，需要更新仓库 URL 或确保新账号有访问权限
4. **凭证缓存**：清除凭证后，下次操作时会提示输入新账号的密码或 token

## 🆘 常见问题

### Q1: 清除凭证后还是使用旧账号？
**解决方案：**
- 确保已清除所有 GitHub 相关凭证
- 重启 Cursor
- 检查是否有其他应用在使用旧账号

### Q2: 如何确认当前使用的是哪个账号？
**解决方案：**
- 查看 Git 配置：`git config --global user.name`
- 测试推送操作，看使用哪个账号
- 查看 GitHub 网站的授权应用列表

### Q3: 更换账号后无法推送代码？
**解决方案：**
- 确保新账号有仓库的访问权限
- 更新远程仓库 URL
- 使用 Personal Access Token（如果启用了2FA）

---

**提示**：最简单的方法是访问 https://github.com/settings/applications 撤销 Cursor 的授权，然后重新登录。
