/**
 * 测试PDF转图片功能
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas, Image } from 'canvas'
import fs from 'fs'
import path from 'path'

// 配置pdfjs在Node.js环境中使用canvas
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height)
    return {
      canvas,
      context: canvas.getContext('2d'),
    }
  }

  reset(canvasAndContext: any, width: number, height: number) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  destroy(canvasAndContext: any) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

async function testPdfToImage() {
  console.log('🔍 开始测试PDF转图片功能...')

  // 使用已存在的PDF文件
  const pdfPath = path.join(process.cwd(), 'uploads/invoices/invoice-1773804690157-26117000000202648656.pdf')

  if (!fs.existsSync(pdfPath)) {
    console.log('❌ PDF文件不存在:', pdfPath)
    return
  }

  console.log('📄 使用PDF文件:', pdfPath)

  try {
    // 读取PDF文件
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath))
    console.log('✅ PDF文件读取成功，大小:', pdfData.length, 'bytes')

    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({
      data: pdfData,
      useSystemFonts: true,
    })
    const pdfDocument = await loadingTask.promise
    console.log('✅ PDF文档加载成功，共', pdfDocument.numPages, '页')

    // 获取第一页
    const page = await pdfDocument.getPage(1)
    console.log('✅ 获取第一页成功')

    // 设置渲染比例
    const scale = 2.0
    const viewport = page.getViewport({ scale })
    console.log('✅ 视口设置成功:', viewport.width, 'x', viewport.height)

    // 使用NodeCanvasFactory创建canvas
    const canvasFactory = new NodeCanvasFactory()
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height)
    console.log('✅ Canvas创建成功')

    // 渲染PDF页面到canvas
    await page.render({
      canvasContext: canvasAndContext.context,
      viewport: viewport,
      canvasFactory: canvasFactory as any,
    }).promise
    console.log('✅ PDF渲染成功')

    // 将canvas转换为PNG图片
    const tempDir = path.join(process.cwd(), 'uploads', 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    const outputPath = path.join(tempDir, `test-output-${Date.now()}.png`)
    const buffer = canvasAndContext.canvas.toBuffer('image/png')
    fs.writeFileSync(outputPath, buffer)
    console.log('✅ 图片保存成功:', outputPath)
    console.log('✅ 图片大小:', buffer.length, 'bytes')

    console.log('\n🎉 PDF转图片功能测试成功！')
  } catch (error) {
    console.error('❌ 测试失败:', error)
    if (error instanceof Error) {
      console.error('错误堆栈:', error.stack)
    }
  }
}

testPdfToImage()
