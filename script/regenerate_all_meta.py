#!/usr/bin/env python3
"""
すべてのPDFファイルのメタデータを再生成するスクリプト
"""

import os
import yaml
import logging
from pathlib import Path
from pdf_link_extractor import (
    extract_links_from_pdf,
    extract_text_from_pdf,
    update_meta_file,
)

# ログ設定
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def load_slides_config():
    """slides.yamlを読み込む"""
    slides_file = Path("../slides.yaml")
    if not slides_file.exists():
        logger.error("slides.yamlが見つかりません")
        return None

    with open(slides_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def main():
    """メイン処理"""
    # slides.yamlを読み込み
    slides_config = load_slides_config()
    if not slides_config:
        return

    # PDFファイルのリストを取得
    pdf_files = []
    for slide_id, slide_info in slides_config.items():
        if "file" in slide_info:
            pdf_path = slide_info["file"]
            if pdf_path.startswith("pdf/"):
                pdf_path = f"../{pdf_path}"

            if os.path.exists(pdf_path):
                pdf_files.append((slide_id, pdf_path, slide_info))
            else:
                logger.warning(f"PDFファイルが見つかりません: {pdf_path}")

    logger.info(f"処理対象のPDFファイル数: {len(pdf_files)}")

    # 各PDFファイルのメタデータを再生成
    for i, (slide_id, pdf_path, slide_info) in enumerate(pdf_files, 1):
        logger.info(f"[{i}/{len(pdf_files)}] 処理中: {slide_id}")

        try:
            # メタファイルのパスを取得
            meta_file = slide_info.get("meta", f"../pdf/{slide_id}.yaml")
            if not meta_file.startswith("../"):
                meta_file = f"../{meta_file}"

            # テキストを抽出
            text_by_page = extract_text_from_pdf(pdf_path)

            if text_by_page:
                total_paragraphs = sum(
                    len(paragraphs) for paragraphs in text_by_page.values()
                )
                logger.info(
                    f"テキスト抽出完了: {len(text_by_page)}ページから{total_paragraphs}個の段落を抽出しました"
                )

            # メタファイルを更新（既存のリンク情報を保持、リンク抽出はスキップ）
            update_meta_file(
                pdf_path, {}, text_by_page, meta_file, preserve_existing_links=True
            )
            logger.info(f"メタデータファイルを更新しました: {meta_file}")

        except Exception as e:
            logger.error(f"エラー ({slide_id}): {e}")
            import traceback

            logger.error(f"詳細なエラー情報: {traceback.format_exc()}")

    logger.info("すべてのPDFファイルのメタデータ再生成が完了しました")


if __name__ == "__main__":
    main()
