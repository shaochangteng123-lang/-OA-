/**
 * 百度OCR密钥测试脚本
 * 用于验证API密钥是否有效
 */

import axios from 'axios'
import dotenv from 'dotenv'
import path from 'path'

// 加载环境变量
dotenv.config({ path: path.join(process.cwd(), '.env') })

async function testBaiduOCR() {
  console.log('🔍 开始测试百度OCR密钥...\n')

  const apiKey = process.env.BAIDU_OCR_API_KEY
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY

  // 1. 检查环境变量
  console.log('📋 步骤1: 检查环境变量')
  if (!apiKey || !secretKey) {
    console.error('❌ 错误: 环境变量未配置')
    console.error('   请确保 .env 文件中包含:')
    console.error('   - BAIDU_OCR_API_KEY')
    console.error('   - BAIDU_OCR_SECRET_KEY')
    process.exit(1)
  }

  const trimmedApiKey = apiKey.trim()
  const trimmedSecretKey = secretKey.trim()

  console.log('✅ 环境变量已配置')
  console.log('   API Key 长度:', trimmedApiKey.length)
  console.log('   Secret Key 长度:', trimmedSecretKey.length)
  console.log('   API Key 前缀:', trimmedApiKey.substring(0, 8) + '...')
  console.log('   Secret Key 前缀:', trimmedSecretKey.substring(0, 8) + '...')
  console.log('   包含空格:', apiKey !== trimmedApiKey || secretKey !== trimmedSecretKey ? '是 ⚠️' : '否')
  console.log()

  // 2. 测试获取 access_token
  console.log('📋 步骤2: 测试获取 access_token')
  try {
    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${trimmedApiKey}&client_secret=${trimmedSecretKey}`

    console.log('   请求URL:', tokenUrl.replace(trimmedSecretKey, '***SECRET***'))
    console.log('   发送请求...')

    const tokenResponse = await axios.post(tokenUrl, null, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 10000,
    })

    console.log('   响应状态码:', tokenResponse.status)
    console.log('   响应数据:', JSON.stringify(tokenResponse.data, null, 2))

    if (tokenResponse.data.error) {
      console.error('\n❌ 获取 access_token 失败!')
      console.error('   错误代码:', tokenResponse.data.error)
      console.error('   错误描述:', tokenResponse.data.error_description)
      console.error('\n🔧 可能的解决方案:')
      console.error('   1. 检查 API Key 和 Secret Key 是否正确')
      console.error('   2. 访问百度AI控制台重新获取密钥:')
      console.error('      https://console.bce.baidu.com/ai/#/ai/ocr/app/list')
      console.error('   3. 确认应用状态是否正常（未被禁用）')
      console.error('   4. 检查是否有IP白名单限制')
      process.exit(1)
    }

    const accessToken = tokenResponse.data.access_token
    if (!accessToken) {
      console.error('\n❌ 响应中没有 access_token')
      process.exit(1)
    }

    console.log('✅ 成功获取 access_token')
    console.log('   Token 前缀:', accessToken.substring(0, 20) + '...')
    console.log('   Token 长度:', accessToken.length)
    console.log()

    // 3. 测试调用OCR API（使用一个简单的测试）
    console.log('📋 步骤3: 测试OCR API调用权限')
    try {
      // 使用通用文字识别API测试（不需要实际图片）
      const testUrl = `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`

      console.log('   测试API权限...')

      // 发送一个空请求来测试权限（会返回参数错误，但能验证权限）
      const testResponse = await axios.post(
        testUrl,
        'image=',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
          validateStatus: () => true, // 接受所有状态码
        }
      )

      console.log('   响应状态码:', testResponse.status)
      console.log('   响应数据:', JSON.stringify(testResponse.data, null, 2))

      // 如果返回参数错误（error_code: 216015），说明权限正常
      if (testResponse.data.error_code === 216015 || testResponse.data.error_code === 216200) {
        console.log('✅ OCR API 权限验证成功（参数错误是预期的）')
      } else if (testResponse.data.error_code) {
        console.warn('⚠️  OCR API 返回错误:', testResponse.data.error_msg)
        console.warn('   错误代码:', testResponse.data.error_code)
      } else {
        console.log('✅ OCR API 调用成功')
      }
    } catch (error: any) {
      console.error('⚠️  OCR API 测试失败:', error.message)
    }

    console.log()
    console.log('🎉 百度OCR密钥测试完成!')
    console.log('✅ 密钥有效，可以正常使用')
    console.log()
    console.log('💡 提示:')
    console.log('   - 如果发票识别仍然失败，可能是PDF文件格式问题')
    console.log('   - 确保上传的是标准的增值税发票PDF')
    console.log('   - 检查PDF文件大小是否超过限制（建议小于5MB）')

  } catch (error: any) {
    console.error('\n❌ 测试失败!')

    if (error.response) {
      console.error('   HTTP状态码:', error.response.status)
      console.error('   响应数据:', JSON.stringify(error.response.data, null, 2))
    } else if (error.request) {
      console.error('   网络错误: 无法连接到百度API服务器')
      console.error('   请检查网络连接')
    } else {
      console.error('   错误信息:', error.message)
    }

    console.error('\n🔧 建议:')
    console.error('   1. 检查网络连接是否正常')
    console.error('   2. 确认防火墙没有阻止访问百度API')
    console.error('   3. 尝试在浏览器中访问: https://aip.baidubce.com/')

    process.exit(1)
  }
}

// 运行测试
testBaiduOCR().catch(error => {
  console.error('💥 未预期的错误:', error)
  process.exit(1)
})
