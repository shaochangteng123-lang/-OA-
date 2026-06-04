# 节假日数据更新说明

## 概述

节假日数据现在存储在数据库中。后端启动后会自动检查今年和明年的国务院节假日通知，发现缺失年份数据时会自动解析并写入 `holidays` 表。

## 数据来源

节假日数据来源于国务院办公厅发布的节假日安排通知。默认通过中国政府网政策库搜索接口发现通知链接，也可通过 `HOLIDAY_SOURCE_URL` 指定通知页面。

## 更新方法

### 方法1：后台自动更新（推荐）

1. **自动检查**
   - 服务启动后 30 秒自动检查一次
   - 每天 03:10 自动检查今年和明年数据
   - 仅在年份数据缺失时自动写入，避免重复覆盖

2. **手动兜底**
   ```bash
   npm run update:holidays 2027
   ```

3. **指定通知来源**
   ```bash
   HOLIDAY_SOURCE_URL=https://www.gov.cn/... npm run update:holidays 2027
   ```

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
5. **自动更新范围**：后台任务检查今年和明年；手动命令默认更新明年，也可传入指定年份

## 未来改进

- [x] 实现自动爬取政府网站数据
- [x] 添加定时任务自动检查更新
- [ ] 支持多年份数据管理
- [ ] 添加数据变更历史记录




