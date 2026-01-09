#!/bin/bash
# 自动修复未使用变量问题
# 将 catch (error) 改为 catch (_error)

echo "开始修复未使用变量..."

# 查找并修复 catch 块中的未使用 error 变量
find src -name "*.vue" -o -name "*.ts" | while read file; do
  # 备份原文件
  # sed -i.bak 's/} catch (error) {/} catch (_error) {/g' "$file"

  # Windows 上使用不同的语法
  sed -i 's/} catch (error) {/} catch (_error) {/g' "$file"
  sed -i 's/catch (error) {/catch (_error) {/g' "$file"
done

echo "修复完成！请运行 npm run lint 验证。"
