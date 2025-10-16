#!/usr/bin/env python3
"""
指定したPDFからリンクを抽出してYAML形式で出力するスクリプト
"""

import os
import sys
import yaml
import argparse
from pathlib import Path
from typing import Dict, List, Any
import logging

try:
    import PyPDF2
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import urlparse
except ImportError:
    print("必要なライブラリがインストールされていません。")
    print("以下のコマンドでインストールしてください：")
    print("uv sync")
    sys.exit(1)

# ログ設定
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def get_page_title(url: str) -> str:
    """
    URLからページタイトルを取得する

    Args:
        url: 対象のURL

    Returns:
        ページタイトル
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }

        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")
        title = soup.find("title")

        if title:
            return title.get_text().strip()
        else:
            return urlparse(url).netloc

    except Exception as e:
        logger.warning(f"Failed to get title for {url}: {e}")
        return urlparse(url).netloc


def extract_links_from_pdf(pdf_path: str) -> Dict[int, List[Dict[str, str]]]:
    """
    PDFファイルからリンクを抽出する

    Args:
        pdf_path: PDFファイルのパス

    Returns:
        ページ番号をキーとしたリンク情報の辞書
    """
    links_by_page = {}
    url_title_cache = {}  # URLのタイトルをキャッシュ

    try:
        with open(pdf_path, "rb") as file:
            pdf_reader = PyPDF2.PdfReader(file)

            for page_num, page_obj in enumerate(pdf_reader.pages, 1):
                page_links = []
                seen_urls_in_page = set()  # ページ内での重複URLを避ける

                if "/Annots" in page_obj:
                    annotations = page_obj["/Annots"]
                    for annotation in annotations:
                        annotation_obj = annotation.get_object()
                        if annotation_obj.get("/Subtype") == "/Link":
                            if "/A" in annotation_obj:
                                action = annotation_obj["/A"]
                                if "/URI" in action:
                                    uri = action["/URI"]
                                    if hasattr(uri, "decode"):
                                        url = uri.decode("utf-8")
                                    else:
                                        url = str(uri)

                                    # ページ内での重複をチェック
                                    if url in seen_urls_in_page:
                                        continue
                                    seen_urls_in_page.add(url)

                                    # タイトルを取得（キャッシュを使用）
                                    if url not in url_title_cache:
                                        title = get_page_title(url)
                                        url_title_cache[url] = title
                                    else:
                                        title = url_title_cache[url]

                                    page_links.append({"url": url, "title": title})

                if page_links:
                    links_by_page[page_num] = page_links

    except Exception as e:
        logger.error(f"PDFファイルの読み込みでエラー ({pdf_path}): {e}")
        return {}

    return links_by_page


def format_to_yaml(
    pdf_path: str, links_by_page: Dict[int, List[Dict[str, str]]]
) -> str:
    """
    リンク情報を指定されたYAML形式にフォーマットする

    Args:
        pdf_path: PDFファイルのパス
        links_by_page: ページごとのリンク情報

    Returns:
        YAML形式の文字列
    """
    yaml_data = {"pdf": {"file": pdf_path, "links": {}}}

    for page_num, links in links_by_page.items():
        page_key = f"p{page_num}"
        yaml_data["pdf"]["links"][page_key] = links

    return yaml.dump(
        yaml_data, default_flow_style=False, allow_unicode=True, sort_keys=False
    )


def main():
    parser = argparse.ArgumentParser(
        description="指定したPDFからリンクを抽出してYAML形式で出力する"
    )
    parser.add_argument("pdf_file", help="処理するPDFファイルのパス")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="詳細なログを出力する"
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if not os.path.exists(args.pdf_file):
        logger.error(f"ファイルが存在しません: {args.pdf_file}")
        sys.exit(1)

    logger.info(f"PDFファイルを処理中: {args.pdf_file}")

    # リンクを抽出
    links_by_page = extract_links_from_pdf(args.pdf_file)

    if not links_by_page:
        logger.info("リンクが見つかりませんでした")
        yaml_output = yaml.dump(
            {"pdf": {"file": args.pdf_file, "links": {}}},
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
    else:
        # YAML形式にフォーマット
        yaml_output = format_to_yaml(args.pdf_file, links_by_page)

        total_links = sum(len(links) for links in links_by_page.values())
        logger.info(
            f"処理完了: {len(links_by_page)}ページから{total_links}個のリンクを抽出しました"
        )

    # 画面に出力
    print(yaml_output)


if __name__ == "__main__":
    main()
