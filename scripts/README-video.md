# 搞笑短视频生成工具使用指南

## 安装依赖

```bash
pip install -r requirements-video.txt
```

**注意**: 还需要安装 FFmpeg：

- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt-get install ffmpeg`
- Windows: 下载 FFmpeg 并添加到 PATH

## 快速开始

### 1. 创建示例配置文件

```bash
python scripts/generate-video.py --create-example
```

这会创建一个 `video-config.json` 文件，你可以编辑它来定制你的视频。

### 2. 编辑配置文件

打开 `video-config.json`，你可以：

- **修改文字内容**: 更改 `text` 字段
- **修改颜色**: 更改 `bg_color`（背景色）和 `text_color`（文字颜色）
- **调整时长**: 更改 `duration`（秒）
- **添加字幕**: 使用 `subtitle` 字段
- **添加图片**: 使用 `type: "image"` 和 `path` 字段指定图片路径
- **添加背景音乐**: 在 `bg_music` 字段指定音乐文件路径

### 3. 生成视频

```bash
python scripts/generate-video.py --config video-config.json
```

视频会保存在 `videos/` 目录下。

## 配置文件格式

```json
{
  "scenes": [
    {
      "type": "text",           // 场景类型: "text" 或 "image"
      "text": "你的文字内容",    // 文字内容（支持换行）
      "bg_color": "#FF6B6B",    // 背景颜色（十六进制）
      "text_color": "#FFFFFF",  // 文字颜色
      "font_size": 80,          // 字体大小
      "duration": 3.0,          // 显示时长（秒）
      "subtitle": "字幕内容",    // 可选：字幕
      "subtitle_position": "bottom"  // 字幕位置: "top", "bottom", "center"
    },
    {
      "type": "image",
      "path": "path/to/image.jpg",
      "duration": 3.0,
      "subtitle": "图片说明"
    }
  ],
  "bg_music": "path/to/music.mp3",  // 可选：背景音乐
  "output_filename": "my_video.mp4",
  "fps": 30
}
```

## 搞笑视频创意建议

1. **反转剧情**: 设置一个预期，然后突然反转
2. **夸张表情**: 使用大字体和鲜艳颜色
3. **节奏感**: 短场景（1-2秒）+ 长场景（3-5秒）交替
4. **互动性**: 在最后添加"记得点赞关注"等字幕
5. **热门话题**: 结合当下热点话题

## 抖音发布建议

- 视频格式: 竖屏 9:16 (1080x1920)
- 时长: 15-60秒最佳
- 前3秒要抓眼球
- 添加热门音乐和话题标签
- 发布时间: 晚上7-9点或中午12-1点

## 常见问题

**Q: 字体显示不正常？**
A: 脚本会自动尝试使用系统字体，如果失败会使用默认字体。你可以修改代码中的字体路径。

**Q: 视频生成很慢？**
A: 这是正常的，视频渲染需要时间。可以在配置中降低 `fps` 值（如改为24）来加快速度。

**Q: 如何添加自己的图片？**
A: 在配置文件中添加 `type: "image"` 的场景，并指定图片路径。

**Q: 背景音乐格式要求？**
A: 支持 MP3、WAV、AAC 等常见音频格式。
