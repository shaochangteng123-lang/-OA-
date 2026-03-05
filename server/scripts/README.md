# 节假日数据更新说明

## 概述

节假日数据现在存储在数据库中，可以通过API自动获取和更新。系统支持从政府网站获取最新的节假日安排。

## 数据来源

节假日数据来源于国务院办公厅发布的节假日安排通知，参考：
- 北京政府网站：https://www.beijing.gov.cn/zhengce/zhengcefagui/

## 更新方法

### 方法1：使用更新脚本（推荐）

1. **编辑更新脚本**
   - 打开 `server/scripts/update-holidays.ts`
   - 根据最新的政府通知，更新 `holidays2026` 数组中的数据
   - 更新 `sourceUrl` 为最新的通知链接

2. **运行更新脚本**
   ```bash
   npm run update:holidays
   ```

3. **验证数据**
   - 脚本会自动将数据写入数据库
   - 前端会自动从API获取最新数据

### 方法2：通过API更新（需要管理员权限）

1. **准备数据格式**
   ```json
   {
     "holidays": [
       { "date": "2026-01-01", "name": "元旦", "type": "holiday" },
       { "date": "2026-01-04", "name": "元旦补班", "type": "workday" }
     ],
     "sourceUrl": "https://www.beijing.gov.cn/..."
   }
   ```

2. **调用API**
   ```bash
   POST /api/holidays/update
   Authorization: Cookie: connect.sid=...
   ```

## API接口

### 获取所有节假日
```
GET /api/holidays
GET /api/holidays?year=2026
```

### 获取指定日期
```
GET /api/holidays/date/2026-01-01
```

### 获取指定年份
```
GET /api/holidays/year/2026
```

### 更新节假日数据（需要管理员权限）
```
POST /api/holidays/update
Content-Type: application/json
{
  "holidays": [...],
  "sourceUrl": "..."
}
```

## 数据格式

```typescript
interface HolidayInfo {
  date: string      // yyyy-MM-dd 格式
  name: string      // 节假日名称，如"元旦"、"春节"等
  type: 'holiday' | 'workday'  // holiday: 放假, workday: 补班
}
```

## 注意事项

1. **数据缓存**：前端会缓存节假日数据1小时，更新后可能需要等待缓存过期或刷新页面
2. **备用数据**：如果API不可用，前端会使用内置的备用数据
3. **权限控制**：只有管理员可以更新节假日数据
4. **数据验证**：更新时会自动验证数据格式和日期格式

## 未来改进

- [ ] 实现自动爬取政府网站数据
- [ ] 添加定时任务自动检查更新
- [ ] 支持多年份数据管理
- [ ] 添加数据变更历史记录





