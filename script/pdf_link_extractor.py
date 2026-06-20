#!/usr/bin/env python3
"""
指定したPDFからリンクを抽出してYAML形式で出力するスクリプト
"""

import os
import sys
import yaml
import argparse
from typing import Dict, List, Any
import logging

try:
    import fitz  # PyMuPDF
    import requests
    from bs4 import BeautifulSoup
    from urllib.parse import urlparse
except ImportError:
    print("必要なライブラリがインストールされていません。")
    print("以下のコマンドでインストールしてください：")
    print("uv sync")
    sys.exit(1)


class SingleQuotedDumper(yaml.SafeDumper):
    """シングルクォートをデフォルトで使用するYAMLダンパー"""

    def choose_scalar_style(self):
        """スカラー値のスタイルを選択（シングルクォートを優先）"""
        style = super().choose_scalar_style()
        if style == '"':
            return "'"
        return style


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


def extract_links_from_pdf(
    pdf_path: str, skip_crawling: bool = False
) -> Dict[int, List[Dict[str, str]]]:
    """
    PDFファイルからリンクを抽出する

    Args:
        pdf_path: PDFファイルのパス
        skip_crawling: リンク先のクローリングをスキップするかどうか

    Returns:
        ページ番号をキーとしたリンク情報の辞書
    """
    links_by_page = {}
    url_title_cache = {}  # URLのタイトルをキャッシュ

    try:
        with fitz.open(pdf_path) as doc:
            for page_num, page in enumerate(doc, 1):
                page_links = []
                seen_urls_in_page = set()  # ページ内での重複URLを避ける

                for link in page.get_links():
                    if link.get("kind") != fitz.LINK_URI:
                        continue
                    url = link.get("uri")
                    if not url:
                        continue

                    # ページ内での重複をチェック
                    if url in seen_urls_in_page:
                        continue
                    seen_urls_in_page.add(url)

                    # タイトルを取得（スキップオプションに応じて）
                    if skip_crawling:
                        title = url  # URLをそのまま使用
                    elif url in url_title_cache:
                        title = url_title_cache[url]
                    else:
                        title = get_page_title(url)
                        url_title_cache[url] = title

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
        yaml_data,
        default_flow_style=False,
        allow_unicode=True,
        sort_keys=False,
        Dumper=SingleQuotedDumper,
    )


def get_pdf_size(pdf_file: str) -> Dict[str, int]:
    """
    PDFファイルからサイズ情報を取得する

    Args:
        pdf_file: PDFファイルのパス

    Returns:
        サイズ情報の辞書 {"max_width": int, "max_height": int}
    """
    try:
        with fitz.open(pdf_file) as doc:
            if doc.page_count > 0:
                # 最初のページのサイズを取得（回転を考慮）
                page = doc[0]
                rect = page.rect
                width, height = int(rect.width), int(rect.height)
                if page.rotation in (90, 270):
                    width, height = height, width
                return {"max_width": width, "max_height": height}
            else:
                return {"max_width": 1024, "max_height": 768}  # デフォルト値
    except Exception as e:
        logger.warning(f"PDFサイズの取得に失敗: {e}")
        return {"max_width": 1024, "max_height": 768}  # デフォルト値


def update_meta_file(
    pdf_file: str,
    links_by_page: Dict[int, List[Dict[str, str]]],
    meta_file: str = None,
    preserve_existing_links: bool = False,
):
    """
    PDFメタデータファイルを更新する

    Args:
        pdf_file: PDFファイルのパス
        links_by_page: ページごとのリンク情報
        meta_file: メタデータファイルのパス（指定されない場合は自動生成）
        preserve_existing_links: 既存のリンク情報を保持するかどうか
    """
    try:
        if meta_file is None:
            filename = os.path.basename(pdf_file)
            file_key = filename.replace(".pdf", "")
            meta_file = f"../pdf/{file_key}.yaml"

        pdf_size = get_pdf_size(pdf_file)

        existing_data: Dict[str, Any] = {}
        if os.path.exists(meta_file):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    loaded = yaml.safe_load(f)
                    if isinstance(loaded, dict):
                        existing_data = loaded
            except Exception as e:
                logger.warning(f"既存のメタデータファイルの読み込みに失敗: {e}")

        links_section: Dict[str, Any]
        if preserve_existing_links and isinstance(existing_data.get("links"), dict):
            links_section = existing_data["links"]
        else:
            links_section = {}

        meta_data: Dict[str, Any] = {}
        if isinstance(existing_data, dict):
            meta_data.update(existing_data)

        meta_data["size"] = pdf_size
        meta_data["links"] = links_section

        for page_num, links in links_by_page.items():
            page_key = f"p{page_num}"
            meta_data["links"][page_key] = links

        with open(meta_file, "w", encoding="utf-8") as f:
            yaml.dump(
                meta_data,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
                Dumper=SingleQuotedDumper,
            )

        logger.info(f"メタデータファイルを更新しました: {meta_file}")

    except Exception as e:
        logger.error(f"メタデータファイルの更新でエラー: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="指定したPDFからリンクを抽出してYAML形式で出力する"
    )
    parser.add_argument("pdf_file", help="処理するPDFファイルのパス")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="詳細なログを出力する"
    )
    parser.add_argument(
        "--update-meta", "-u", action="store_true", help="メタデータファイルを更新する"
    )
    parser.add_argument(
        "--meta-file",
        "-m",
        help="更新するメタデータファイルのパス（指定しない場合は自動生成）",
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

    # メタデータファイルを更新
    if args.update_meta:
        update_meta_file(args.pdf_file, links_by_page, args.meta_file)

    # 画面に出力
    print(yaml_output)


if __name__ == "__main__":
    main()
