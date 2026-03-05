#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
搞笑短视频生成工具
支持文本、图片、音频合成抖音格式视频
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime

try:
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
    # moviepy 2.x 版本导入
    from moviepy import (
        VideoFileClip, ImageClip, TextClip, CompositeVideoClip,
        concatenate_videoclips, AudioFileClip
    )
except ImportError as e:
    print(f"❌ 缺少必要的库，请先安装：pip install -r requirements-video.txt")
    print(f"   错误详情: {e}")
    print(f"   如果已安装，请尝试: pip install --upgrade moviepy")
    sys.exit(1)


class FunnyVideoGenerator:
    """搞笑视频生成器"""
    
    # 抖音标准尺寸（竖屏）
    TIKTOK_WIDTH = 1080
    TIKTOK_HEIGHT = 1920
    
    def __init__(self, output_dir: str = "videos"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
    def create_text_image(
        self,
        text: str,
        width: int = TIKTOK_WIDTH,
        height: int = TIKTOK_HEIGHT,
        bg_color: str = "#000000",
        text_color: str = "#FFFFFF",
        font_size: int = 80,
        duration: float = 3.0
    ) -> ImageClip:
        """创建文字图片"""
        # 创建图片
        img = Image.new('RGB', (width, height), color=bg_color)
        draw = ImageDraw.Draw(img)
        
        # 尝试加载字体
        try:
            # macOS 系统字体
            font_paths = [
                "/System/Library/Fonts/PingFang.ttc",
                "/System/Library/Fonts/STHeiti Light.ttc",
                "/System/Library/Fonts/Helvetica.ttc",
            ]
            font = None
            for font_path in font_paths:
                if os.path.exists(font_path):
                    try:
                        font = ImageFont.truetype(font_path, font_size)
                        break
                    except:
                        continue
            
            if font is None:
                font = ImageFont.load_default()
        except:
            font = ImageFont.load_default()
        
        # 文字换行处理
        words = text.split('\n')
        lines = []
        for word in words:
            if len(word) > 20:  # 每行最多20个字
                for i in range(0, len(word), 20):
                    lines.append(word[i:i+20])
            else:
                lines.append(word)
        
        # 计算文字位置（居中）
        total_height = len(lines) * (font_size + 20)
        start_y = (height - total_height) // 2
        
        # 绘制文字
        for i, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font)
            text_width = bbox[2] - bbox[0]
            x = (width - text_width) // 2
            y = start_y + i * (font_size + 20)
            draw.text((x, y), line, fill=text_color, font=font)
        
        # 保存临时图片
        temp_path = self.output_dir / f"temp_text_{datetime.now().timestamp()}.png"
        img.save(temp_path)
        
        # 创建视频片段（moviepy 2.x 在构造函数中传入 duration）
        clip = ImageClip(str(temp_path), duration=duration)
        return clip
    
    def create_image_clip(
        self,
        image_path: str,
        duration: float = 3.0
    ) -> ImageClip:
        """从图片创建视频片段"""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"图片不存在: {image_path}")
        
        # moviepy 2.x 在构造函数中传入 duration
        clip = ImageClip(image_path, duration=duration)
        # 调整尺寸到抖音格式
        clip = clip.resize((self.TIKTOK_WIDTH, self.TIKTOK_HEIGHT))
        return clip
    
    def add_subtitle(
        self,
        clip: ImageClip,
        text: str,
        position: str = "bottom"
    ) -> CompositeVideoClip:
        """添加字幕"""
        try:
            # 计算字幕位置
            if position == "bottom":
                y_pos = self.TIKTOK_HEIGHT - 200
            elif position == "top":
                y_pos = 100
            else:
                y_pos = self.TIKTOK_HEIGHT // 2
            
            # 创建字幕（moviepy 2.x 在构造函数中传入 duration）
            # 注意：moviepy 2.x 的 TextClip 参数可能不同，简化处理
            try:
                txt_clip = TextClip(
                    text,
                    fontsize=60,
                    color='white',
                    duration=clip.duration
                ).set_position(('center', y_pos))
            except:
                # 如果 TextClip 失败，尝试更简单的参数
                txt_clip = TextClip(
                    text,
                    fontsize=60,
                    color='white',
                    duration=clip.duration
                ).set_position(('center', y_pos))
            
            return CompositeVideoClip([clip, txt_clip])
        except Exception as e:
            print(f"⚠️  字幕添加失败，继续使用原视频: {e}")
            return clip
    
    def generate_video(
        self,
        scenes: List[Dict],
        output_filename: str,
        bg_music: Optional[str] = None,
        fps: int = 30
    ) -> str:
        """生成视频"""
        print(f"🎬 开始生成视频: {output_filename}")
        
        clips = []
        
        for i, scene in enumerate(scenes):
            print(f"  处理场景 {i+1}/{len(scenes)}: {scene.get('type', 'unknown')}")
            
            if scene['type'] == 'text':
                clip = self.create_text_image(
                    text=scene.get('text', ''),
                    bg_color=scene.get('bg_color', '#000000'),
                    text_color=scene.get('text_color', '#FFFFFF'),
                    font_size=scene.get('font_size', 80),
                    duration=scene.get('duration', 3.0)
                )
            elif scene['type'] == 'image':
                clip = self.create_image_clip(
                    image_path=scene.get('path', ''),
                    duration=scene.get('duration', 3.0)
                )
            else:
                continue
            
            # 添加字幕
            if scene.get('subtitle'):
                clip = self.add_subtitle(clip, scene['subtitle'], scene.get('subtitle_position', 'bottom'))
            
            clips.append(clip)
        
        if not clips:
            raise ValueError("没有有效的视频片段")
        
        # 合并所有片段
        print("📹 合并视频片段...")
        final_clip = concatenate_videoclips(clips, method="compose")
        
        # 添加背景音乐
        if bg_music and os.path.exists(bg_music):
            print("🎵 添加背景音乐...")
            audio = AudioFileClip(bg_music)
            # 如果音频比视频长，截取；如果短，循环播放
            if audio.duration > final_clip.duration:
                audio = audio.subclip(0, final_clip.duration)
            else:
                # 循环播放音乐
                loops = int(final_clip.duration / audio.duration) + 1
                audio = concatenate_videoclips([audio] * loops).subclip(0, final_clip.duration)
            
            final_clip = final_clip.set_audio(audio)
        
        # 输出路径
        output_path = self.output_dir / output_filename
        
        # 渲染视频
        print(f"💾 渲染视频到: {output_path}")
        final_clip.write_videofile(
            str(output_path),
            fps=fps,
            codec='libx264',
            audio_codec='aac',
            preset='medium',
            threads=4
        )
        
        # 清理临时文件
        print("🧹 清理临时文件...")
        for clip in clips:
            clip.close()
        final_clip.close()
        
        # 删除临时图片
        for temp_file in self.output_dir.glob("temp_*.png"):
            temp_file.unlink()
        
        print(f"✅ 视频生成完成: {output_path}")
        return str(output_path)


def create_example_config():
    """创建示例配置文件"""
    example = {
        "scenes": [
            {
                "type": "text",
                "text": "今天我要讲一个\n超级搞笑的故事",
                "bg_color": "#FF6B6B",
                "text_color": "#FFFFFF",
                "font_size": 80,
                "duration": 3.0,
                "subtitle": "准备好了吗？",
                "subtitle_position": "bottom"
            },
            {
                "type": "text",
                "text": "从前有个人\n他叫小明",
                "bg_color": "#4ECDC4",
                "text_color": "#FFFFFF",
                "font_size": 80,
                "duration": 2.5
            },
            {
                "type": "text",
                "text": "他每天都要\n做一件很搞笑的事",
                "bg_color": "#FFE66D",
                "text_color": "#000000",
                "font_size": 80,
                "duration": 3.0
            },
            {
                "type": "text",
                "text": "结果...",
                "bg_color": "#000000",
                "text_color": "#FFFFFF",
                "font_size": 100,
                "duration": 1.5
            },
            {
                "type": "text",
                "text": "他把自己逗笑了！\n哈哈哈哈",
                "bg_color": "#FF6B6B",
                "text_color": "#FFFFFF",
                "font_size": 90,
                "duration": 3.0,
                "subtitle": "记得点赞关注哦！",
                "subtitle_position": "bottom"
            }
        ],
        "bg_music": "",  # 可选：背景音乐路径
        "output_filename": "funny_video.mp4",
        "fps": 30
    }
    
    config_path = Path("video-config.json")
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(example, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 已创建示例配置文件: {config_path}")
    return config_path


def main():
    parser = argparse.ArgumentParser(description='搞笑短视频生成工具')
    parser.add_argument('--config', '-c', type=str, help='配置文件路径 (JSON)')
    parser.add_argument('--create-example', action='store_true', help='创建示例配置文件')
    parser.add_argument('--output-dir', '-o', type=str, default='videos', help='输出目录')
    
    args = parser.parse_args()
    
    if args.create_example:
        create_example_config()
        return
    
    if not args.config:
        print("❌ 请提供配置文件，或使用 --create-example 创建示例配置")
        parser.print_help()
        return
    
    # 读取配置
    config_path = Path(args.config)
    if not config_path.exists():
        print(f"❌ 配置文件不存在: {config_path}")
        return
    
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # 创建生成器
    generator = FunnyVideoGenerator(output_dir=args.output_dir)
    
    # 生成视频
    try:
        output_path = generator.generate_video(
            scenes=config['scenes'],
            output_filename=config.get('output_filename', 'output.mp4'),
            bg_music=config.get('bg_music'),
            fps=config.get('fps', 30)
        )
        print(f"\n🎉 成功！视频已保存到: {output_path}")
        print(f"📱 可以直接上传到抖音了！")
    except Exception as e:
        print(f"❌ 生成视频失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
