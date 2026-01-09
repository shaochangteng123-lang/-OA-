import axios from 'axios'

interface FeishuAppTokenResponse {
  code: number
  msg: string
  app_access_token: string
  expire: number
}

interface FeishuMessageResponse {
  code: number
  msg: string
  data?: {
    message_id: string
  }
}

// 飞书API基础URL
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

// 获取应用访问令牌（app_access_token）
export async function getAppAccessToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('飞书应用配置缺失：FEISHU_APP_ID 或 FEISHU_APP_SECRET 未设置')
  }

  try {
    const response = await axios.post<FeishuAppTokenResponse>(
      `${FEISHU_API_BASE}/auth/v3/app_access_token/internal`,
      {
        app_id: appId,
        app_secret: appSecret,
      }
    )

    if (response.data.code !== 0) {
      throw new Error(`获取飞书应用令牌失败: ${response.data.msg}`)
    }

    return response.data.app_access_token
  } catch (error) {
    console.error('获取飞书应用令牌错误:', error)
    throw error
  }
}

// 发送日历提醒消息到飞书
export async function sendCalendarReminder(
  openId: string,
  eventTitle: string,
  eventDescription: string | null,
  startTime: string,
  location: string | null,
  reminderMinutes: number
): Promise<string> {
  try {
    const appAccessToken = await getAppAccessToken()

    // 格式化提醒时间文本
    const reminderText = formatReminderTime(reminderMinutes)

    // 格式化开始时间
    const formattedStartTime = new Date(startTime).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

    // 构建富文本消息
    const messageContent = {
      zh_cn: {
        title: `📅 日历提醒：${eventTitle}`,
        content: [
          [
            {
              tag: 'text',
              text: `⏰ 提醒时间：${reminderText}\n`,
            },
          ],
          [
            {
              tag: 'text',
              text: `📍 开始时间：${formattedStartTime}\n`,
            },
          ],
          ...(location
            ? [
                [
                  {
                    tag: 'text',
                    text: `🏢 地点：${location}\n`,
                  },
                ],
              ]
            : []),
          ...(eventDescription
            ? [
                [
                  {
                    tag: 'text',
                    text: `📝 描述：${eventDescription}\n`,
                  },
                ],
              ]
            : []),
          [
            {
              tag: 'text',
              text: '\n祝您工作顺利！',
            },
          ],
        ],
      },
    }

    // 发送消息
    const response = await axios.post<FeishuMessageResponse>(
      `${FEISHU_API_BASE}/im/v1/messages`,
      {
        receive_id: openId,
        msg_type: 'post',
        content: JSON.stringify(messageContent),
      },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          receive_id_type: 'open_id',
        },
      }
    )

    if (response.data.code !== 0) {
      throw new Error(`发送飞书消息失败: ${response.data.msg}`)
    }

    console.log(`✅ 飞书提醒已发送给用户 ${openId}: ${eventTitle}`)
    return response.data.data?.message_id || ''
  } catch (error) {
    console.error('发送飞书消息错误:', error)
    throw error
  }
}

// 格式化提醒时间文本
function formatReminderTime(minutes: number): string {
  if (minutes === 0) return '事件开始时'
  if (minutes < 60) return `提前${minutes}分钟`
  if (minutes === 60) return '提前1小时'
  if (minutes < 1440) return `提前${Math.floor(minutes / 60)}小时`
  if (minutes === 1440) return '提前1天'
  return `提前${Math.floor(minutes / 1440)}天`
}

// OAuth相关接口
interface FeishuOAuthTokenResponse {
  code: number
  msg: string
  data?: {
    access_token: string
    token_type: string
    expires_in: number
    refresh_token: string
    scope: string
  }
}

interface FeishuUserInfoResponse {
  code: number
  msg: string
  data?: {
    access_token: string
    token_type: string
    expires_in: number
    name: string
    en_name: string
    avatar_url: string
    avatar_thumb: string
    avatar_middle: string
    avatar_big: string
    open_id: string
    union_id: string
    email: string
    user_id: string
    mobile: string
    tenant_key: string
  }
}

// 使用code换取access_token
export async function getAccessTokenByCode(code: string): Promise<string> {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('飞书应用配置缺失：FEISHU_APP_ID 或 FEISHU_APP_SECRET 未设置')
  }

  try {
    // 先获取app_access_token
    const appAccessToken = await getAppAccessToken()

    // 使用code换取user_access_token
    const response = await axios.post<FeishuOAuthTokenResponse>(
      `${FEISHU_API_BASE}/authen/v1/oidc/access_token`,
      {
        grant_type: 'authorization_code',
        code: code,
      },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (response.data.code !== 0) {
      throw new Error(`获取访问令牌失败: ${response.data.msg}`)
    }

    return response.data.data?.access_token || ''
  } catch (error) {
    console.error('获取访问令牌错误:', error)
    throw error
  }
}

// 获取用户信息
export async function getUserInfo(accessToken: string): Promise<{
  open_id: string
  union_id: string
  name: string
  email: string
  avatar_url: string
}> {
  try {
    const response = await axios.get<FeishuUserInfoResponse>(
      `${FEISHU_API_BASE}/authen/v1/user_info`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (response.data.code !== 0) {
      throw new Error(`获取用户信息失败: ${response.data.msg}`)
    }

    const data = response.data.data
    if (!data) {
      throw new Error('用户信息为空')
    }

    return {
      open_id: data.open_id,
      union_id: data.union_id,
      name: data.name,
      email: data.email || '',
      avatar_url: data.avatar_url || '',
    }
  } catch (error) {
    console.error('获取用户信息错误:', error)
    throw error
  }
}