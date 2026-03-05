import { Client } from '@notionhq/client'

// Notion客户端实例
let notionClient: Client | null = null

/**
 * 初始化Notion客户端
 */
export function initNotionClient() {
  const notionToken = process.env.NOTION_TOKEN
  const notionDatabaseId = process.env.NOTION_DATABASE_ID

  if (!notionToken) {
    console.warn('⚠️  NOTION_TOKEN 未配置，Notion同步功能将不可用')
    return null
  }

  if (!notionDatabaseId) {
    console.warn('⚠️  NOTION_DATABASE_ID 未配置，Notion同步功能将不可用')
    return null
  }

  notionClient = new Client({
    auth: notionToken,
  })

  console.log('✅ Notion客户端初始化成功')
  return notionClient
}

/**
 * 获取Notion客户端实例
 */
export function getNotionClient(): Client | null {
  if (!notionClient) {
    return initNotionClient()
  }
  return notionClient
}


/**
 * 同步工作日志到Notion（服务器端版本）
 * @param date 日期 (YYYY-MM-DD)
 * @param title 标题
 * @param content HTML内容
 * @param projects 项目列表
 * @param existingPageId 已存在的Notion页面ID（用于更新）
 * @returns Notion页面ID
 */
export async function syncWorklogToNotion(
  date: string,
  title: string,
  content: string,
  projects: Array<{ projectId: string; projectName: string; content: string }> = [],
  existingPageId?: string
): Promise<string | null> {
  return syncWorklogToNotionServer(date, title, content, projects, existingPageId)
}

/**
 * 简化版本的HTML转Notion块（用于服务器端，不使用DOM API）
 */
function htmlToNotionBlocksServer(html: string): any[] {
  const blocks: any[] = []

  if (!html || !html.trim()) {
    return blocks
  }

  // 使用正则表达式按顺序提取所有h3和p标签
  // 匹配h3标签（支持data-heading-type和可选的data-project-id）
  const headingRegex = /<h3[^>]*data-heading-type="([^"]*)"[^>]*(?:data-project-id="([^"]*)")?[^>]*>(.*?)<\/h3>/gis
  // 匹配p标签（支持data-segment-type和可选的data-project-id）
  const paragraphRegex = /<p[^>]*data-segment-type="([^"]*)"[^>]*(?:data-project-id="([^"]*)")?[^>]*>(.*?)<\/p>/gis

  // 收集所有匹配项及其位置
  const items: Array<{ type: 'heading' | 'paragraph'; text: string; position: number }> = []

  // 提取标题
  let match
  while ((match = headingRegex.exec(html)) !== null) {
    const text = stripHtmlTags(match[3])
    if (text.trim()) {
      items.push({
        type: 'heading',
        text: text.trim(),
        position: match.index,
      })
    }
  }

  // 提取段落
  while ((match = paragraphRegex.exec(html)) !== null) {
    const text = stripHtmlTags(match[3])
    if (text.trim()) {
      items.push({
        type: 'paragraph',
        text: text.trim(),
        position: match.index,
      })
    }
  }

  // 按位置排序，保持原始顺序
  items.sort((a, b) => a.position - b.position)

  // 转换为Notion块
  items.forEach((item) => {
    if (item.type === 'heading') {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseRichTextFromHtml(item.text),
        },
      })
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseRichTextFromHtml(item.text),
        },
      })
    }
  })

  return blocks
}

/**
 * 从HTML文本中解析富文本格式（简化版，只处理基本格式）
 */
function parseRichTextFromHtml(text: string): any[] {
  // 简单的富文本解析：检测加粗、斜体等
  const richText: any[] = []

  // 检测加粗文本 **text** 或 <strong>text</strong> 或 <b>text</b>
  const boldRegex = /(\*\*|<\/?(?:strong|b)>)(.*?)\1/g
  // 检测斜体文本 *text* 或 <em>text</em> 或 <i>text</i>
  const italicRegex = /(\*|<\/?(?:em|i)>)(.*?)\1/g
  // 检测删除线 ~~text~~ 或 <s>text</s>
  const strikeRegex = /(~~|<\/?s>)(.*?)\1/g

  // 简化处理：直接返回纯文本，格式信息在stripHtmlTags中已移除
  // 如果需要保留格式，可以使用更复杂的解析逻辑
  const cleanText = text
    .replace(/<strong>|<\/strong>|<b>|<\/b>|\*\*/g, '')
    .replace(/<em>|<\/em>|<i>|<\/i>|\*/g, '')
    .replace(/<s>|<\/s>|~~/g, '')
    .trim()

  if (cleanText) {
    richText.push({
      type: 'text',
      text: {
        content: cleanText,
      },
    })
  }

  return richText.length > 0 ? richText : []
}

/**
 * 移除HTML标签，提取纯文本
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * 服务器端版本的同步函数（不使用DOM API）
 */
export async function syncWorklogToNotionServer(
  date: string,
  title: string,
  content: string,
  projects: Array<{ projectId: string; projectName: string; content: string }> = [],
  existingPageId?: string
): Promise<string | null> {
  const client = getNotionClient()
  if (!client) {
    console.warn('Notion客户端未初始化，跳过同步')
    return null
  }

  const databaseId = process.env.NOTION_DATABASE_ID
  if (!databaseId) {
    console.warn('NOTION_DATABASE_ID 未配置，跳过同步')
    return null
  }

  try {
    // 将HTML内容转换为Notion块（服务器端版本）
    const blocks = htmlToNotionBlocksServer(content)

    // 构建页面属性
    const properties: any = {
      '日期': {
        date: {
          start: date,
        },
      },
      '标题': {
        title: [
          {
            text: {
              content: title || '工作日志',
            },
          },
        ],
      },
    }

    // 如果有项目信息，添加到属性中
    if (projects && projects.length > 0) {
      const projectNames = projects.map((p) => p.projectName).join('、')
      properties['项目'] = {
        rich_text: [
          {
            text: {
              content: projectNames,
            },
          },
        ],
      }
    }

    if (existingPageId) {
      // 更新现有页面
      await client.pages.update({
        page_id: existingPageId,
        properties,
      })

      // 清空现有内容并添加新内容
      const existingBlocks = await client.blocks.children.list({
        block_id: existingPageId,
      })

      // 删除所有现有块
      for (const block of existingBlocks.results) {
        try {
          await client.blocks.delete({
            block_id: block.id,
          })
        } catch (error) {
          // 忽略删除失败的错误（可能块已经被删除）
          console.warn(`删除块失败: ${block.id}`, error)
        }
      }

      // 添加新内容
      if (blocks.length > 0) {
        // Notion API限制每次最多添加100个块
        const chunkSize = 100
        for (let i = 0; i < blocks.length; i += chunkSize) {
          const chunk = blocks.slice(i, i + chunkSize)
          await client.blocks.children.append({
            block_id: existingPageId,
            children: chunk,
          })
        }
      }

      return existingPageId
    } else {
      // 创建新页面
      const response = await client.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties,
        children: blocks.length > 0 ? blocks.slice(0, 100) : [], // 限制初始块数量
      })

      // 如果还有更多块，继续添加
      if (blocks.length > 100) {
        const remainingBlocks = blocks.slice(100)
        const chunkSize = 100
        for (let i = 0; i < remainingBlocks.length; i += chunkSize) {
          const chunk = remainingBlocks.slice(i, i + chunkSize)
          await client.blocks.children.append({
            block_id: response.id,
            children: chunk,
          })
        }
      }

      return response.id
    }
  } catch (error) {
    console.error('同步到Notion失败:', error)
    throw error
  }
}
