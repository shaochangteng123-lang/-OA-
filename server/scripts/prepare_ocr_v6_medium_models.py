#!/usr/bin/env python3
"""下载并准备 PP-OCRv6_medium 正式候选模型，不写入其他模型缓存。"""

import hashlib
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path


CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "config" / "ocr-v6-medium.json"
)


def load_config():
    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def file_sha256(file_path):
    digest = hashlib.sha256()
    with file_path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract(archive_path, target_directory):
    target_root = target_directory.resolve()
    with tarfile.open(archive_path, "r") as archive:
        for member in archive.getmembers():
            member_path = (target_directory / member.name).resolve()
            if member_path != target_root and target_root not in member_path.parents:
                raise RuntimeError(f"模型压缩包包含越界路径: {member.name}")
            if member.issym() or member.islnk():
                raise RuntimeError(f"模型压缩包包含不允许的链接: {member.name}")
        archive.extractall(target_directory)


def download_model(model_config, model_root):
    archive_path = model_root / model_config["archiveName"]
    expected_digest = model_config["sha256"]
    if not archive_path.exists() or file_sha256(archive_path) != expected_digest:
        temporary_path = archive_path.with_suffix(".download")
        print(f"正在下载 {model_config['officialModelName']} ...", flush=True)
        urllib.request.urlretrieve(model_config["url"], temporary_path)
        actual_digest = file_sha256(temporary_path)
        if actual_digest != expected_digest:
            temporary_path.unlink(missing_ok=True)
            raise RuntimeError(
                f"{model_config['officialModelName']} 校验失败: {actual_digest}"
            )
        temporary_path.replace(archive_path)

    extraction_root = model_root / f".{model_config['officialModelName']}-extract"
    shutil.rmtree(extraction_root, ignore_errors=True)
    extraction_root.mkdir(parents=True)
    safe_extract(archive_path, extraction_root)
    extracted_candidates = [
        path
        for path in extraction_root.iterdir()
        if path.is_dir() and (path / "inference.yml").exists()
    ]
    if len(extracted_candidates) != 1:
        raise RuntimeError(
            f"{model_config['officialModelName']} 解压目录不符合预期"
        )

    destination = model_root / model_config["directoryName"]
    shutil.rmtree(destination, ignore_errors=True)
    shutil.move(str(extracted_candidates[0]), destination)
    shutil.rmtree(extraction_root, ignore_errors=True)

    metadata_path = destination / "inference.yml"
    metadata = metadata_path.read_text(encoding="utf-8")
    expected_name = f"model_name: {model_config['officialModelName']}"
    runtime_name = f"model_name: {model_config['runtimeModelName']}"
    if expected_name not in metadata:
        raise RuntimeError(
            f"{model_config['officialModelName']} 元数据缺少预期模型名称"
        )
    metadata_path.write_text(
        metadata.replace(expected_name, runtime_name, 1), encoding="utf-8"
    )
    print(f"已准备 {model_config['officialModelName']}: {destination}")


def main():
    config = load_config()
    root_env = config["modelRootEnvironmentVariable"]
    model_root = Path(
        os.environ.get(root_env) or config["defaultModelRoot"]
    ).expanduser()
    if not model_root.is_absolute():
        raise RuntimeError(f"{root_env} 必须是绝对路径")
    model_root.mkdir(parents=True, exist_ok=True)
    for section in ("detection", "recognition"):
        download_model(config[section], model_root)
    print(
        json.dumps(
            {
                "ready": True,
                "model": config["id"],
                "paddleocrVersion": config["paddleocrVersion"],
                "modelRoot": str(model_root),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"准备 PP-OCRv6_medium 正式候选模型失败: {error}", file=sys.stderr)
        sys.exit(1)
