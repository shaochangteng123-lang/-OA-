#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成证件办理情况柱形图 - 用于PPT汇报
采用并排柱形图，数值标注在柱形顶部，包含未办理项目和办理周期
"""

import matplotlib.pyplot as plt
import numpy as np

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['PingFang SC', 'Heiti SC', 'STHeiti', 'SimHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False

# 数据
categories = [
    '建设工程\n规划许可证',
    '建筑工程\n施工许可证',
    '规划核验\n(备案)意见',
    '临时用地\n延期批复',
    '临时建设工程\n规划许可证',
    '施工图设计\n综合审查告知书',
    '"多规合一"\n会商意见函'
]

planned = [10, 14, 5, 2, 5, 3, 4]  # 计划办理量
actual = [8, 13, 3, 2, 3, 1, 0]    # 实际办理量
completion_rate = [80, 93, 60, 100, 60, 33, 0]  # 完成率(%)

# 平均办理周期
processing_labels = ['2-3日', '2-3日', '2-3日', '4-5日', '2-3日', '5-7日', '8个月']

# 未办理项目
unfinished_projects = [
    'CBD500变电站规证\n柳芳10千伏规证',
    '何各庄隧道',
    '华能隧道\n三营门红星隧道',
    '无',
    '何各庄变电站\n费家村变电站',
    '三营门110送出\nCBD500千伏110送出',
    '东旭110千伏变电站隧道\n三岔河110千伏变电站隧道'
]

# 创建图表 - 增加高度以容纳底部信息
fig, ax = plt.subplots(figsize=(18, 12), dpi=150)

# 设置柱形位置
x = np.arange(len(categories))
width = 0.35

# 绘制并排柱形图
bars1 = ax.bar(x - width/2, planned, width, label='计划办理量',
               color='#4472C4', edgecolor='white', linewidth=0.5)
bars2 = ax.bar(x + width/2, actual, width, label='实际办理量',
               color='#ED7D31', edgecolor='white', linewidth=0.5)

# 在柱形顶部添加数值
for bar in bars1:
    height = bar.get_height()
    ax.annotate(f'{int(height)}',
                xy=(bar.get_x() + bar.get_width() / 2, height),
                xytext=(0, 3),
                textcoords="offset points",
                ha='center', va='bottom',
                fontsize=12, color='#333333')

for bar in bars2:
    height = bar.get_height()
    ax.annotate(f'{int(height)}',
                xy=(bar.get_x() + bar.get_width() / 2, height),
                xytext=(0, 3),
                textcoords="offset points",
                ha='center', va='bottom',
                fontsize=12, color='#333333')

# 在柱形组上方添加完成率标签
for i, rate in enumerate(completion_rate):
    # 根据完成率设置颜色
    if rate >= 80:
        rate_color = '#2E7D32'  # 绿色
    elif rate >= 50:
        rate_color = '#F57C00'  # 橙色
    else:
        rate_color = '#C62828'  # 红色

    top = max(planned[i], actual[i])
    ax.annotate(f'{rate}%',
                xy=(x[i], top + 1.0),
                ha='center', va='bottom',
                fontsize=11, fontweight='normal',
                color=rate_color,
                bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor=rate_color, linewidth=1.2))

# 在x轴标签下方添加办理周期
for i, period in enumerate(processing_labels):
    period_color = '#C62828' if period == '8个月' else '#666666'
    ax.annotate(f'周期: {period}',
                xy=(x[i], -2.8),
                ha='center', va='top',
                fontsize=9, color=period_color,
                annotation_clip=False)

# 在办理周期下方添加未办理项目
for i, project in enumerate(unfinished_projects):
    if project and project != '无':
        ax.annotate(f'未办理:\n{project}',
                    xy=(x[i], -4.2),
                    ha='center', va='top',
                    fontsize=8, color='#C55A11',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='#FFF3E0', edgecolor='#ED7D31', alpha=0.9),
                    annotation_clip=False)
    else:
        ax.annotate('已全部完成',
                    xy=(x[i], -4.2),
                    ha='center', va='top',
                    fontsize=8, color='#2E7D32',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='#E8F5E9', edgecolor='#2E7D32', alpha=0.9),
                    annotation_clip=False)

# 设置标题和标签
ax.set_title('证件办理情况统计', fontsize=22, fontweight='bold', pad=20, color='#333333')
ax.set_xlabel('证件类型', fontsize=13, labelpad=10)
ax.set_ylabel('办理数量', fontsize=13, labelpad=10)

# 设置x轴标签
ax.set_xticks(x)
ax.set_xticklabels(categories, fontsize=11)

# 设置y轴范围和刻度
ax.set_ylim(0, 18)
ax.set_yticks(range(0, 19, 2))

# 添加网格线
ax.yaxis.grid(True, linestyle='-', alpha=0.3, color='#CCCCCC')
ax.set_axisbelow(True)

# 设置图例
ax.legend(loc='upper right', fontsize=12, framealpha=0.95)

# 美化边框
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_color('#CCCCCC')
ax.spines['bottom'].set_color('#CCCCCC')

# 设置背景色
ax.set_facecolor('white')
fig.patch.set_facecolor('white')

# 添加说明
fig.text(0.5, 0.02, '注：百分比为完成率，绿色≥80%，橙色50%-79%，红色<50%',
         ha='center', fontsize=10, color='#666666')

# 调整布局，为底部信息留出空间
plt.tight_layout()
plt.subplots_adjust(bottom=0.28)

# 保存图片
output_path = '/Users/shaochangteng/Desktop/证件办理情况柱形图.png'
plt.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white', edgecolor='none')
print(f'图表已保存到: {output_path}')

# 同时保存一个高清版本用于PPT
output_path_hd = '/Users/shaochangteng/Desktop/证件办理情况柱形图_高清.png'
plt.savefig(output_path_hd, dpi=400, bbox_inches='tight', facecolor='white', edgecolor='none')
print(f'高清版本已保存到: {output_path_hd}')

plt.close()
