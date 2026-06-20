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
    """slides/*.yaml を読み込み、{slug: data} の辞書を返す"""
    slides_dir = Path("../slides")
    if not slides_dir.is_dir():
        logger.error("slides/ ディレクトリが見つかりません")
        return None

    config = {}
    for path in sorted(slides_dir.glob("*.yaml")):
        with open(path, "r", encoding="utf-8") as f:
            config[path.stem] = yaml.safe_load(f) or {}
    return config


def main():
    """メイン処理"""
    # slides/ を読み込み
    slides_config = load_slides_config()
    if not slides_config:
        return

    # PDFファイルのリストを取得 (file/meta は slug または stem から導出)
    pdf_files = []
    for slide_id, slide_info in slides_config.items():
        stem = slide_info.get("stem") or slide_id
        pdf_path = slide_info.get("file", f"pdf/{stem}.pdf")
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
            # メタファイルのパスを取得 (slug または stem から導出)
            stem = slide_info.get("stem") or slide_id
            meta_file = slide_info.get("meta", f"pdf/{stem}.yaml")
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
