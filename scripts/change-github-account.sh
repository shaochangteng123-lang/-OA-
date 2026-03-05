#!/bin/bash
# 更换 GitHub 账号脚本

echo "🔧 开始更换 GitHub 账号..."

# 1. 清除 GitHub 凭证
echo "📝 清除 GitHub 凭证..."
security delete-internet-password -s github.com 2>/dev/null && echo "✅ 已清除 github.com 凭证" || echo "ℹ️  未找到 github.com 凭证"
security delete-internet-password -s api.github.com 2>/dev/null && echo "✅ 已清除 api.github.com 凭证" || echo "ℹ️  未找到 api.github.com 凭证"

# 2. 显示当前 Git 配置
echo ""
echo "📋 当前 Git 配置："
echo "用户名: $(git config --global user.name 2>/dev/null || echo '未配置')"
echo "邮箱: $(git config --global user.email 2>/dev/null || echo '未配置')"

# 3. 提示用户更新配置
echo ""
echo "💡 下一步操作："
echo "1. 访问 https://github.com/settings/applications 撤销 Cursor 授权"
echo "2. 如需更新 Git 用户信息，运行："
echo "   git config --global user.name '新用户名'"
echo "   git config --global user.email '新邮箱'"
echo ""
echo "✅ 凭证已清除，下次使用 GitHub 时会提示重新登录"
