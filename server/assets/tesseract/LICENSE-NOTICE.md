# Tesseract（开源文字识别）语言模型许可说明

本目录中的 `chi_sim.traineddata.gz` 与 `eng.traineddata.gz` 是 Tesseract（开源文字识别）简体中文、英文语言模型的压缩副本，仅供服务器离线文字识别使用。

- 许可协议：Apache License 2.0（Apache 2.0 许可证）
- SPDX（软件包数据交换标识）：`Apache-2.0`
- 上游项目：Tesseract OCR（Tesseract 光学字符识别）语言数据
- 完整性校验：见同目录 `SHA256SUMS`

模型随应用镜像分发并从本地文件加载。运行时不会从互联网下载模型，也不会把待识别文件发送到外部服务。
