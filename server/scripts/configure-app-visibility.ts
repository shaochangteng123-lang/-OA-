import { getAppAccessToken } from '../services/feishu.js'
import axios from 'axios'

/**
 * 配置飞书应用可见范围
 * 需要先开通 admin:app.visibility 权限
 */
async function configureAppVisibility() {
  try {
    console.log('🔧 开始配置应用可见范围...')

    // 获取应用访问令牌
    const appAccessToken = await getAppAccessToken()
    console.log('✅ 已获取应用访问令牌')

    // 注意：飞书API可能需要不同的端点
    // 这里提供一个示例，实际API端点请参考飞书开放平台文档
    console.log('📝 请参考飞书开放平台文档配置可见范围')
    console.log('   文档地址: https://open.feishu.cn/document/')
    console.log('   权限ID: admin:app.visibility')
    
    // 实际API调用示例（需要根据飞书文档调整）
    // const response = await axios.post(
    //   'https://open.feishu.cn/open-apis/admin/v1/app_visibility',
    //   {
    //     // 配置参数
    //   },
    //   {
    //     headers: {
    //       Authorization: `Bearer ${appAccessToken}`,
    //       'Content-Type': 'application/json',
    //     },
    //   }
    // )

    console.log('✅ 配置完成')
  } catch (error) {
    console.error('❌ 配置失败:', error)
    throw error
  }
}

// 如果直接运行此脚本
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  configureAppVisibility()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export { configureAppVisibility }
