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
    import pdfplumber
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


def extract_text_from_pdf(pdf_path: str) -> Dict[int, List[Dict]]:
    """
    PDFファイルからテキストを抽出する（フォーマット情報付き）

    Args:
        pdf_path: PDFファイルのパス

    Returns:
        ページ番号をキーとした構造化されたノードのリストの辞書
    """
    text_by_page = {}
    previous_pages = {}
    removed_page_numbers = set()  # 削除したページ番号の履歴

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                # フォーマット情報付きでテキストを抽出
                chars = page.chars
                words = page.extract_words()

                if chars:
                    # 文字レベルの情報から段落を構築（構造化されたノードとして返される）
                    structured_nodes = extract_formatted_paragraphs(chars, words)

                    if structured_nodes:
                        # 構造化されたノードを処理（ページ番号履歴を渡す）
                        processed_content = process_page_content(
                            structured_nodes,
                            page_num,
                            previous_pages,
                            removed_page_numbers,
                        )
                        if processed_content:
                            text_by_page[page_num] = processed_content

                        # 次のページの処理のために保存（テキスト形式で保存）
                        previous_texts = []
                        for node in processed_content:
                            if node["node"] == "p":
                                text_parts = []
                                for child in node.get("children", []):
                                    if child["node"] == "text":
                                        text_parts.append(child["content"])
                                    elif child["node"] == "link":
                                        text_parts.append(child["content"])
                                    elif child["node"] == "bold":
                                        text_parts.append(child["content"])
                                previous_texts.append("".join(text_parts))
                            elif node["node"] == "ul":
                                for li in node.get("children", []):
                                    if "content" in li:
                                        previous_texts.append(li["content"])
                                    elif "children" in li:
                                        # childrenがある場合は、テキストを結合
                                        text_parts = []
                                        for child in li["children"]:
                                            if child["node"] == "text":
                                                text_parts.append(child["content"])
                                            elif child["node"] == "link":
                                                text_parts.append(child["content"])
                                            elif child["node"] == "bold":
                                                text_parts.append(child["content"])
                                        previous_texts.append("".join(text_parts))
                        previous_pages[page_num] = previous_texts
                else:
                    # フォーマット情報がない場合は従来の方法で抽出
                    text = page.extract_text()
                    if text:
                        paragraphs = []
                        for line in text.split("\n"):
                            line = line.strip()
                            if line:
                                paragraphs.append(line)

                        if paragraphs:
                            # 文字列の段落を構造化されたノードに変換
                            structured_nodes = []
                            for paragraph in paragraphs:
                                structured_nodes.append(
                                    {
                                        "node": "p",
                                        "children": [
                                            {"node": "text", "content": paragraph}
                                        ],
                                    }
                                )

                            processed_content = process_page_content(
                                structured_nodes, page_num, previous_pages
                            )
                            if processed_content:
                                text_by_page[page_num] = processed_content

    except Exception as e:
        logger.error(f"PDFテキスト抽出でエラー ({pdf_path}): {e}")
        import traceback

        logger.error(f"詳細なエラー情報: {traceback.format_exc()}")
        return {}

    return text_by_page


def extract_formatted_paragraphs(chars: List[Dict], words: List[Dict]) -> List[Dict]:
    """
    文字レベルの情報からフォーマット付き段落を抽出し、構造化されたノードとして返す

    Args:
        chars: 文字レベルの情報
        words: 単語レベルの情報

    Returns:
        構造化されたノードのリスト
    """
    if not chars:
        return []

    # 文字をY座標でグループ化（行ごと）
    lines = {}
    for char in chars:
        y = round(char["top"], 1)  # Y座標を丸めて行を判定
        if y not in lines:
            lines[y] = []
        lines[y].append(char)

    # 各行をX座標でソートしてテキストを構築
    paragraphs = []
    current_paragraph = []

    for y in sorted(lines.keys()):
        line_chars = sorted(lines[y], key=lambda c: c["x0"])

        # 行のノードを構築（フォーマット情報付き）
        line_nodes = []
        current_bold_text = ""

        for char in line_chars:
            char_text = char["text"]

            # 特殊文字の処理
            # EOT文字(0x03)を除去
            char_text = char_text.replace("\x03", "")

            # タブ文字を空白に変換
            char_text = char_text.replace("\t", " ")

            # CR改行コードをLFに統一
            char_text = char_text.replace("\r", "\n")

            # フォント情報から太字を判定
            font_name = char.get("fontname", "").lower()
            is_bold = "bold" in font_name or "black" in font_name

            if is_bold:
                current_bold_text += char_text
            else:
                # 太字テキストが蓄積されている場合はboldノードとして追加
                if current_bold_text:
                    line_nodes.append({"node": "bold", "content": current_bold_text})
                    current_bold_text = ""

                # 通常テキストを追加
                if char_text:
                    line_nodes.append({"node": "text", "content": char_text})

        # 最後の太字テキストを追加
        if current_bold_text:
            line_nodes.append({"node": "bold", "content": current_bold_text})

        # 空行でない場合は段落に追加
        if line_nodes:
            # •だけの行は次の行と結合するために特別処理
            if (
                line_nodes
                and len(line_nodes) == 1
                and line_nodes[0].get("content", "") == "•"
            ):
                # •だけの行は現在の段落に追加
                current_paragraph.extend(line_nodes)
            # •で始まる行は個別の段落として処理
            elif line_nodes and line_nodes[0].get("content", "").startswith("•"):
                # 現在の段落を終了
                if current_paragraph:
                    paragraphs.append({"node": "p", "children": current_paragraph})
                    current_paragraph = []
                # •で始まる行を個別に追加
                paragraphs.append({"node": "p", "children": line_nodes})
            else:
                # 行内に•が含まれている場合は分割
                has_bullet = any("•" in node.get("content", "") for node in line_nodes)
                if has_bullet:
                    # 現在の段落を終了
                    if current_paragraph:
                        paragraphs.append({"node": "p", "children": current_paragraph})
                        current_paragraph = []

                    # •で分割して処理
                    split_nodes = []
                    for node in line_nodes:
                        content = node.get("content", "")
                        if "•" in content:
                            # •で分割
                            parts = content.split("•")
                            for i, part in enumerate(parts):
                                if i > 0:  # •の後の部分
                                    split_nodes.append(
                                        {
                                            "node": "p",
                                            "children": [
                                                {"node": "text", "content": "•" + part}
                                            ],
                                        }
                                    )
                                elif part:  # •の前の部分
                                    split_nodes.append(
                                        {"node": "text", "content": part}
                                    )
                        else:
                            split_nodes.append(node)

                    # 分割されたノードを段落に追加
                    for node in split_nodes:
                        if node.get("node") == "p":
                            paragraphs.append(node)
                        else:
                            current_paragraph.append(node)
                else:
                    # 通常の行は段落に追加
                    current_paragraph.extend(line_nodes)
        else:
            # 空行の場合は段落を終了
            if current_paragraph:
                paragraphs.append({"node": "p", "children": current_paragraph})
                current_paragraph = []

    # 最後の段落を追加
    if current_paragraph:
        paragraphs.append({"node": "p", "children": current_paragraph})

    return paragraphs


def remove_page_numbers(paragraphs: List[str]) -> List[str]:
    """Phase 1: ページ番号の削除"""
    if not paragraphs:
        return []

    processed_paragraphs = paragraphs.copy()

    # 最後の要素が数字のみの場合を削除
    if processed_paragraphs and processed_paragraphs[-1].strip().isdigit():
        processed_paragraphs = processed_paragraphs[:-1]

    # 各段落内のページ番号も削除
    import re

    cleaned_paragraphs = []
    for paragraph in processed_paragraphs:
        # 段落の最後にある数字（1-3桁）を削除
        cleaned = re.sub(r"\s+\d{1,3}$", "", paragraph)
        # boldテキスト内のページ番号も削除
        cleaned = re.sub(r"\*\*\d{1,3}\*\*$", "", cleaned)
        cleaned = re.sub(r"\*\*\d{1,3}\*\*", "", cleaned)
        if cleaned.strip():  # 空でない場合のみ追加
            cleaned_paragraphs.append(cleaned)

    return cleaned_paragraphs


def build_link_nodes(paragraphs: List[str]) -> List[str]:
    """Phase 2: リンクノードの組み立て（現在は段落をそのまま返す）"""
    return paragraphs


def merge_consecutive_nodes(nodes: List[Dict]) -> List[Dict]:
    """Phase 3: 連続するboldノードとtextノードの結合（再帰的処理）"""
    if not nodes:
        return []

    result = []
    i = 0

    while i < len(nodes):
        current_node = nodes[i]

        if current_node.get("node") == "bold":
            # 連続するboldノードを結合
            bold_content = current_node.get("content", "")
            j = i + 1

            while j < len(nodes) and nodes[j].get("node") == "bold":
                bold_content += nodes[j].get("content", "")
                j += 1

            result.append({"node": "bold", "content": bold_content})
            i = j
        elif current_node.get("node") == "text":
            # 連続するtextノードを結合
            text_content = current_node.get("content", "")
            j = i + 1

            while j < len(nodes) and nodes[j].get("node") == "text":
                text_content += nodes[j].get("content", "")
                j += 1

            result.append({"node": "text", "content": text_content})
            i = j
        elif current_node.get("node") in ["p", "ul"] and current_node.get("children"):
            # 子ノードも再帰的に処理
            processed_children = merge_consecutive_nodes(current_node["children"])
            result.append(
                {"node": current_node["node"], "children": processed_children}
            )
            i += 1
        elif current_node.get("node") == "li":
            # liノードの子ノードも再帰的に処理
            if current_node.get("children"):
                processed_children = merge_consecutive_nodes(current_node["children"])
                result.append({"node": "li", "children": processed_children})
            else:
                result.append(current_node)
            i += 1
        else:
            result.append(current_node)
            i += 1

    return result


def is_page_number_advanced(
    content: str, context: str = "", page_num: int = 0, removed_page_numbers: set = None
) -> bool:
    """
    より精密なページ番号判定

    Args:
        content: 判定対象のテキスト
        context: 周囲のコンテキスト（段落全体など）
        page_num: 現在のページ番号
        removed_page_numbers: これまでに削除したページ番号のセット

    Returns:
        ページ番号の場合True
    """
    import re

    content = content.strip()
    if not content:
        return False

    # 数字のみの場合の判定
    if re.match(r"^\d{1,3}$", content):
        try:
            num_value = int(content)
        except ValueError:
            return False

        # 最初のページ（P1）では、1だけの独立した段落ノードも削除
        if page_num == 1 and num_value == 1:
            # 段落全体が1だけの場合
            if context.strip() == "1":
                return True

        # コンテキストが空でない場合、ページ番号の可能性をチェック
        if context:
            context_lower = context.lower()

            # ページ番号を示すキーワードが含まれている場合は除外
            page_keywords = ["page", "ページ", "p.", "p-", "slide", "スライド"]
            if any(keyword in context_lower for keyword in page_keywords):
                return True

            # リスト番号のパターンを除外（数字. や 数字) など）
            if re.search(r"\b" + re.escape(content) + r"[.)]\s", context):
                return False

            # 年号のパターンを除外（数字年）
            if re.search(r"\b" + re.escape(content) + r"年", context):
                return False

            # 回数のパターンを除外（第数字回）
            if re.search(r"第" + re.escape(content) + r"回", context):
                return False

            # 文中の数字を除外（前後に文字がある場合）
            # ただし、段落の最後にある場合は除外しない
            content_pos = context.find(content)
            if content_pos > 0 and content_pos + len(content) < len(context):
                # 前後に文字がある場合
                before_char = context[content_pos - 1]
                after_char = context[content_pos + len(content)]

                # 前後の文字が英数字や日本語の場合、文中の数字と判定
                # ただし、段落の最後にある場合は除外しない
                if (
                    (before_char.isalnum() or ord(before_char) > 127)
                    and (after_char.isalnum() or ord(after_char) > 127)
                    and not context.endswith(content)
                ):
                    return False

            # 段落の最後にある場合（ページ番号の可能性が高い）
            if context.endswith(content):
                # 前回削除したページ番号の数字を下回らない場合のみ削除
                if removed_page_numbers:
                    max_removed = (
                        max(removed_page_numbers) if removed_page_numbers else 0
                    )
                    if num_value > max_removed:
                        return True
                    else:
                        return False  # 前回削除した数字より小さい場合は削除しない
                else:
                    return True

            # 段落の最初にある場合（ページ番号の可能性が高い）
            # ただし、リスト番号のパターンの場合は除外
            if context.startswith(content):
                # リスト番号のパターンをチェック
                if len(context) > len(content):
                    after_char = context[len(content)]
                    # 数字の後に . や ) がある場合はリスト番号
                    if after_char in ". )":
                        return False

                # 前回削除したページ番号の数字を下回らない場合のみ削除
                if removed_page_numbers:
                    max_removed = (
                        max(removed_page_numbers) if removed_page_numbers else 0
                    )
                    if num_value > max_removed:
                        return True
                    else:
                        return False  # 前回削除した数字より小さい場合は削除しない
                else:
                    return True

        # 単独で存在する場合（ページ番号の可能性が高い）
        # 前回削除したページ番号の数字を下回らない場合のみ削除
        if removed_page_numbers:
            max_removed = max(removed_page_numbers) if removed_page_numbers else 0
            if num_value >= max_removed:
                return True
            else:
                return False  # 前回削除した数字より小さい場合は削除しない
        else:
            return True

    return False


def remove_page_numbers_from_nodes(
    nodes: List[Dict], page_num: int = 0, removed_page_numbers: set = None
) -> List[Dict]:
    """Phase 1: 構造化されたノードからページ番号を削除（改良版）"""
    if not nodes:
        return []

    if removed_page_numbers is None:
        removed_page_numbers = set()

    result = []
    for node in nodes:
        if node.get("node") == "p" and node.get("children"):
            # 段落全体のテキストを取得（コンテキスト用）
            paragraph_text = ""
            for child in node["children"]:
                if child.get("content"):
                    paragraph_text += child.get("content", "")

            # 子ノードを処理
            processed_children = []
            for child in node["children"]:
                if child.get("node") in ["text", "bold"]:
                    content = child.get("content", "")

                    # より精密なページ番号判定
                    if is_page_number_advanced(
                        content, paragraph_text, page_num, removed_page_numbers
                    ):
                        # ページ番号なので削除し、履歴に追加
                        try:
                            num_value = int(content.strip())
                            removed_page_numbers.add(num_value)
                        except ValueError:
                            pass
                        continue
                    else:
                        processed_children.append(child)
                else:
                    processed_children.append(child)

            # 空でない段落のみ追加
            if processed_children:
                result.append({"node": "p", "children": processed_children})
        elif node.get("node") == "ul" and node.get("children"):
            # ulノードの子ノードも再帰的に処理
            processed_children = remove_page_numbers_from_nodes(
                node["children"], page_num, removed_page_numbers
            )
            if processed_children:
                result.append({"node": "ul", "children": processed_children})
        elif node.get("node") == "li":
            # liノードの子ノードも再帰的に処理
            if node.get("children"):
                processed_children = remove_page_numbers_from_nodes(
                    node["children"], page_num, removed_page_numbers
                )
                result.append({"node": "li", "children": processed_children})
            else:
                # contentのみのliノード
                content = node.get("content", "")
                if not is_page_number_advanced(
                    content, "", page_num, removed_page_numbers
                ):
                    result.append(node)
        else:
            result.append(node)

    return result


def convert_bullet_points_to_lists(nodes: List[Dict]) -> List[Dict]:
    """Phase 2: •で始まる段落をリストに変換（bold/textノードも対応）"""
    if not nodes:
        return []

    result = []
    i = 0

    while i < len(nodes):
        current_node = nodes[i]

        # •で始まるノードかチェック
        if is_bullet_point_node(current_node):
            # リストアイテムを作成
            list_items = []

            # 現在のノードをリストアイテムに変換
            list_item = convert_node_to_list_item(current_node)
            if list_item:
                list_items.append(list_item)

            # 連続する•で始まるノードを探す
            j = i + 1
            while j < len(nodes):
                next_node = nodes[j]
                if is_bullet_point_node(next_node):
                    list_item = convert_node_to_list_item(next_node)
                    if list_item:
                        list_items.append(list_item)
                    j += 1
                else:
                    break

            # リストを作成
            if list_items:
                result.append({"node": "ul", "children": list_items})

            i = j
        else:
            # pノードのchildrenの中に•で始まるノードがあるかチェック
            if current_node.get("node") == "p" and current_node.get("children"):
                processed_children = []
                list_items = []

                for child in current_node["children"]:
                    if is_bullet_point_node(child):
                        # •で始まるノードをリストアイテムに変換
                        child_content = child.get("content", "")
                        child_type = child.get("node", "text")

                        # 複数の•で区切られたコンテンツを分割
                        if "•" in child_content:
                            split_items = convert_bullet_content_to_list_items(
                                child_content, child_type
                            )
                            list_items.extend(split_items)
                        else:
                            list_item = convert_node_to_list_item(child)
                            if list_item:
                                list_items.append(list_item)
                    else:
                        processed_children.append(child)

                # リストアイテムがある場合は、ulノードを作成
                if list_items:
                    result.append({"node": "ul", "children": list_items})

                # 残りのchildrenがある場合は、pノードを作成
                if processed_children:
                    result.append({"node": "p", "children": processed_children})
            else:
                result.append(current_node)
            i += 1

    return result


def is_bullet_point_node(node: Dict) -> bool:
    """ノードが•で始まるかチェック"""
    if not node:
        return False

    node_type = node.get("node")

    # pノードの場合
    if node_type == "p" and node.get("children"):
        children = node["children"]
        if children and children[0].get("content", "").startswith("•"):
            return True

    # textノードの場合
    elif node_type == "text":
        content = node.get("content", "")
        if content.startswith("•"):
            return True

    # boldノードの場合
    elif node_type == "bold":
        content = node.get("content", "")
        if content.startswith("•"):
            return True

    return False


def convert_node_to_list_item(node: Dict) -> Dict:
    """ノードをリストアイテムに変換（複数の•で始まる項目を分割）"""
    if not node:
        return None

    node_type = node.get("node")

    # pノードの場合
    if node_type == "p" and node.get("children"):
        children = node["children"]
        if children and children[0].get("content", "").startswith("•"):
            item_content = children[0].get("content", "")[1:]  # •を削除
            if item_content.strip():
                return {
                    "node": "li",
                    "children": [{"node": "text", "content": item_content.strip()}],
                }

    # textノードの場合
    elif node_type == "text":
        content = node.get("content", "")
        if content.startswith("•"):
            item_content = content[1:]  # •を削除
            if item_content.strip():
                return {
                    "node": "li",
                    "children": [{"node": "text", "content": item_content.strip()}],
                }

    # boldノードの場合
    elif node_type == "bold":
        content = node.get("content", "")
        if content.startswith("•"):
            item_content = content[1:]  # •を削除
            if item_content.strip():
                return {
                    "node": "li",
                    "children": [{"node": "bold", "content": item_content.strip()}],
                }

    return None


def split_bullet_content(content: str) -> List[str]:
    """•で区切られたコンテンツを分割"""
    if not content:
        return []

    # •で分割
    parts = content.split("•")
    result = []

    for part in parts:
        part = part.strip()
        if part:
            result.append(part)

    return result


def convert_bullet_content_to_list_items(content: str, node_type: str) -> List[Dict]:
    """•で区切られたコンテンツを複数のliノードに変換"""
    parts = split_bullet_content(content)
    list_items = []

    for part in parts:
        if part.strip():
            list_items.append(
                {
                    "node": "li",
                    "children": [{"node": node_type, "content": part.strip()}],
                }
            )

    return list_items


def process_page_content(
    structured_nodes: List[Dict],
    page_num: int,
    previous_pages: Dict[int, List[str]],
    removed_page_numbers: set = None,
) -> List[Dict]:
    """
    ページのコンテンツを処理する（構造化されたノードを直接処理）

    Args:
        structured_nodes: 構造化されたノードのリスト
        page_num: 現在のページ番号
        previous_pages: 前のページのコンテンツ
        removed_page_numbers: これまでに削除したページ番号のセット

    Returns:
        処理された構造化されたノードのリスト
    """
    if not structured_nodes:
        return []

    if removed_page_numbers is None:
        removed_page_numbers = set()

    # Phase 1: 連続するboldノードとtextノードの結合（再帰的処理）
    # 年号などの数字をまとめてからページ番号削除を行う
    nodes = merge_consecutive_nodes(structured_nodes)

    # Phase 2: ページ番号の削除（改良版）
    nodes = remove_page_numbers_from_nodes(nodes, page_num, removed_page_numbers)

    # Phase 3: •で始まる段落をリストに変換
    nodes = convert_bullet_points_to_lists(nodes)

    return nodes


def merge_list_markers(paragraphs: List[str]) -> List[str]:
    """
    リストマーカー（•だけのノード）を次のノードと結合する

    Args:
        paragraphs: 段落リスト

    Returns:
        結合された段落リスト
    """
    if not paragraphs:
        return []

    merged = []
    i = 0

    while i < len(paragraphs):
        current = paragraphs[i]

        # •だけのノードの場合、次のノードと結合
        if current.strip() == "•" and i + 1 < len(paragraphs):
            next_item = paragraphs[i + 1]
            merged.append(f"• {next_item}")
            i += 2  # 次のノードもスキップ
        else:
            merged.append(current)
            i += 1

    return merged


def merge_short_paragraphs(paragraphs: List[str]) -> List[str]:
    """
    短い段落を結合する（改行で分かれたテキストをまとめる）

    Args:
        paragraphs: 段落リスト

    Returns:
        結合された段落リスト
    """
    if not paragraphs:
        return []

    # 再帰的に結合を繰り返す
    prev_merged = paragraphs
    merged = []

    while True:
        merged = []
        i = 0

        while i < len(prev_merged):
            current = prev_merged[i]

            # 現在の段落が短い場合（20文字以下）で、次の段落も短い場合
            if (
                len(current.strip()) <= 20
                and i + 1 < len(prev_merged)
                and len(prev_merged[i + 1].strip()) <= 20
                and not prev_merged[i + 1]
                .strip()
                .startswith("•")  # リストマーカーは除外
                and not prev_merged[i + 1].strip().isdigit()
            ):  # 数字のみは除外
                # 次の段落と結合
                next_item = prev_merged[i + 1]
                merged.append(f"{current} {next_item}")
                i += 2  # 次のノードもスキップ
            else:
                merged.append(current)
                i += 1

        # 結合が発生しなかった場合は終了
        if merged == prev_merged:
            break
        prev_merged = merged

    return merged


def parse_text_to_nodes(paragraphs: List[str]) -> List[Dict]:
    """
    テキスト段落を構造化されたノードに変換する

    Args:
        paragraphs: 段落リスト

    Returns:
        構造化されたノードのリスト
    """
    nodes = []
    current_list_items = []

    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        # リストアイテムの場合（•で始まる）
        if paragraph.startswith("• "):
            list_content = paragraph[2:].strip()  # •を除去
            # リストアイテムの内容も解析してノードに変換
            parsed_nodes = parse_paragraph_content(list_content)
            if parsed_nodes:
                current_list_items.append({"node": "li", "children": parsed_nodes})
            else:
                current_list_items.append({"node": "li", "content": list_content})
        # **•で始まる場合（boldテキスト内のリストアイテム）
        elif paragraph.startswith("**•"):
            list_content = paragraph[3:].strip()  # **•を除去
            # リストアイテムの内容も解析してノードに変換
            parsed_nodes = parse_paragraph_content(list_content)
            if parsed_nodes:
                current_list_items.append({"node": "li", "children": parsed_nodes})
            else:
                current_list_items.append({"node": "li", "content": list_content})
        else:
            # 既存のリストアイテムがある場合は、ulノードとして追加
            if current_list_items:
                nodes.append({"node": "ul", "children": current_list_items})
                current_list_items = []

            # 通常の段落を解析
            parsed_nodes = parse_paragraph_content(paragraph)
            if parsed_nodes:
                nodes.append({"node": "p", "children": parsed_nodes})

    # 最後にリストアイテムが残っている場合
    if current_list_items:
        nodes.append({"node": "ul", "children": current_list_items})

    return nodes


def clean_bold_markers(paragraphs: List[str]) -> List[str]:
    """
    残存する**マーカーを処理する（単独の**のみ削除）

    Args:
        paragraphs: 段落リスト

    Returns:
        クリーンアップされた段落リスト
    """
    import re

    cleaned_paragraphs = []

    for paragraph in paragraphs:
        # 単独の**を削除（**text**は保持）
        cleaned = re.sub(r"\*\*(?![^*]+\*\*)", "", paragraph)
        cleaned = re.sub(r"(?<!\*\*)\*\*(?![^*]+\*\*)", "", cleaned)
        # 空の段落は除外
        if cleaned.strip():
            cleaned_paragraphs.append(cleaned)

    return cleaned_paragraphs


def merge_consecutive_bold_nodes(nodes: List[Dict]) -> List[Dict]:
    """
    連続したboldノードを結合する

    Args:
        nodes: ノードのリスト

    Returns:
        結合されたノードのリスト
    """
    if not nodes:
        return nodes

    merged_nodes = []
    current_bold_text = ""

    for node in nodes:
        if node["node"] == "bold":
            # boldノードの場合はテキストを蓄積
            current_bold_text += node["content"]
        else:
            # bold以外のノードの場合
            if current_bold_text:
                # 蓄積されたboldテキストを追加
                merged_nodes.append({"node": "bold", "content": current_bold_text})
                current_bold_text = ""

            # 現在のノードを追加
            merged_nodes.append(node)

    # 最後にboldテキストが残っている場合
    if current_bold_text:
        merged_nodes.append({"node": "bold", "content": current_bold_text})

    return merged_nodes


def parse_paragraph_content(text: str) -> List[Dict]:
    """
    段落の内容を解析してノードに分割する

    Args:
        text: 解析するテキスト

    Returns:
        ノードのリスト
    """
    import re

    nodes = []

    # 太字パターン（**text**）
    bold_pattern = r"\*\*(.*?)\*\*"

    # より包括的なURLパターン
    url_patterns = [
        r'https?://[^\s<>"{}|\\^`\[\]]+',  # HTTP/HTTPS
        r'ftp://[^\s<>"{}|\\^`\[\]]+',  # FTP
        r'mailto:[^\s<>"{}|\\^`\[\]]+',  # Email
        r'www\.[^\s<>"{}|\\^`\[\]]+',  # www.で始まるURL
    ]

    # 太字を処理
    processed_text = text
    bold_matches = list(re.finditer(bold_pattern, text))

    # 太字を一時的なマーカーに置換
    for i, match in enumerate(bold_matches):
        placeholder = f"__BOLD_{i}__"
        processed_text = processed_text.replace(match.group(0), placeholder)

    # すべてのパターンを結合
    combined_pattern = "|".join(f"({pattern})" for pattern in url_patterns)

    # テキストを分割
    parts = re.split(combined_pattern, processed_text)

    for part in parts:
        if not part:
            continue

        # URLの場合
        is_url = False
        for pattern in url_patterns:
            if re.match(pattern, part):
                # URLを正規化
                href = normalize_url(part)
                # リンクテキストを改善
                link_text = improve_link_text(part)

                nodes.append({"node": "link", "href": href, "content": link_text})
                is_url = True
                break

        if not is_url:
            # 通常のテキスト（自動リンク化は無効）
            nodes.extend(parse_text_with_bold(part, bold_matches))

    return nodes


def parse_text_with_bold(text: str, bold_matches: List) -> List[Dict]:
    """
    テキスト内の太字マーカーを処理する

    Args:
        text: 処理するテキスト
        bold_matches: 太字マッチのリスト

    Returns:
        ノードのリスト
    """
    import re

    nodes = []

    # 太字マーカーを検索
    bold_placeholder_pattern = r"__BOLD_(\d+)__"
    matches = list(re.finditer(bold_placeholder_pattern, text))

    if not matches:
        # 太字マーカーがない場合は通常のテキスト
        if text.strip():
            nodes.append({"node": "text", "content": text})
        return nodes

    # テキストを分割して処理
    last_end = 0
    for match in matches:
        # マーカーの前のテキスト
        before_text = text[last_end : match.start()]
        if before_text.strip():
            nodes.append({"node": "text", "content": before_text})

        # 太字テキスト
        bold_index = int(match.group(1))
        if bold_index < len(bold_matches):
            bold_text = bold_matches[bold_index].group(1)
            nodes.append({"node": "bold", "content": bold_text})

        last_end = match.end()

    # 最後のテキスト
    after_text = text[last_end:]
    if after_text.strip():
        nodes.append({"node": "text", "content": after_text})

    return nodes


def normalize_url(url: str) -> str:
    """
    URLを正規化する

    Args:
        url: 元のURL

    Returns:
        正規化されたURL
    """
    url = url.strip()

    # www.で始まる場合はhttps://を追加
    if url.startswith("www."):
        return f"https://{url}"

    # プロトコルがない場合はhttps://を追加
    if not url.startswith(("http://", "https://", "ftp://", "mailto:")):
        return f"https://{url}"

    return url


def improve_link_text(url: str) -> str:
    """
    リンクテキストを改善する

    Args:
        url: 元のURL

    Returns:
        改善されたリンクテキスト
    """
    # 長いURLを短縮
    if len(url) > 50:
        # ドメイン部分を抽出
        import re

        domain_match = re.search(r"(?:https?://)?(?:www\.)?([^/]+)", url)
        if domain_match:
            domain = domain_match.group(1)
            return f"{domain}..."

    return url


def extract_differences(
    previous_content: List[str], current_content: List[str]
) -> List[str]:
    """
    前のページのコンテンツとの差分を抽出する

    Args:
        previous_content: 前のページのコンテンツ
        current_content: 現在のページのコンテンツ

    Returns:
        追加されたコンテンツのみのリスト
    """
    if not previous_content:
        return current_content

    # 前のページのコンテンツの長さを取得
    prev_len = len(previous_content)

    # 現在のページのコンテンツが前のページより短い場合は、そのまま返す
    if len(current_content) <= prev_len:
        return current_content

    # 前のページのコンテンツと現在のページの先頭部分が一致するかチェック
    if current_content[:prev_len] == previous_content:
        # 一致する場合は、追加された部分のみを返す
        return current_content[prev_len:]
    else:
        # 一致しない場合は、現在のページのコンテンツをそのまま返す
        return current_content


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

                                    # タイトルを取得（スキップオプションに応じて）
                                    if skip_crawling:
                                        title = url  # URLをそのまま使用
                                    else:
                                        # キャッシュを使用
                                        pass

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
        import pdfplumber

        with pdfplumber.open(pdf_file) as pdf:
            if len(pdf.pages) > 0:
                # 最初のページのサイズを取得
                page = pdf.pages[0]
                width = int(page.width)
                height = int(page.height)
                return {"max_width": width, "max_height": height}
            else:
                return {"max_width": 1024, "max_height": 768}  # デフォルト値
    except Exception as e:
        logger.warning(f"PDFサイズの取得に失敗: {e}")
        return {"max_width": 1024, "max_height": 768}  # デフォルト値


def update_meta_file(
    pdf_file: str,
    links_by_page: Dict[int, List[Dict[str, str]]],
    text_by_page: Dict[int, List[str]] = None,
    meta_file: str = None,
    preserve_existing_links: bool = False,
):
    """
    PDFメタデータファイルを更新する

    Args:
        pdf_file: PDFファイルのパス
        links_by_page: ページごとのリンク情報
        text_by_page: ページごとのテキスト情報（オプション）
        meta_file: メタデータファイルのパス（指定されない場合は自動生成）
        preserve_existing_links: 既存のリンク情報を保持するかどうか
    """
    try:
        # メタファイルが指定されていない場合は自動生成
        if meta_file is None:
            # パスからファイル名を抽出
            import os

            filename = os.path.basename(pdf_file)
            file_key = filename.replace(".pdf", "")
            meta_file = f"../pdf/{file_key}.yaml"

        # PDFからサイズを取得
        pdf_size = get_pdf_size(pdf_file)

        # 既存のメタデータファイルを読み込む（preserve_existing_linksがTrueの場合）
        existing_links = {}
        if preserve_existing_links:
            import os

            if os.path.exists(meta_file):
                try:
                    with open(meta_file, "r", encoding="utf-8") as f:
                        existing_data = yaml.safe_load(f)
                        if existing_data and "links" in existing_data:
                            existing_links = existing_data["links"]
                except Exception as e:
                    logger.warning(f"既存のメタデータファイルの読み込みに失敗: {e}")

        # メタデータを構築
        meta_data = {"size": pdf_size, "links": existing_links}

        # テキスト情報を追加
        if text_by_page:
            meta_data["text"] = {}
            for page_num, paragraphs in text_by_page.items():
                page_key = f"p{page_num}"
                meta_data["text"][page_key] = paragraphs

        for page_num, links in links_by_page.items():
            page_key = f"p{page_num}"
            meta_data["links"][page_key] = links

        # ファイルに保存
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
    parser.add_argument(
        "--extract-text",
        "-t",
        action="store_true",
        help="テキストも抽出してメタデータに含める",
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

    # テキストを抽出（オプション）
    text_by_page = None
    if args.extract_text:
        logger.info("テキストを抽出中...")
        text_by_page = extract_text_from_pdf(args.pdf_file)
        if text_by_page:
            total_paragraphs = sum(
                len(paragraphs) for paragraphs in text_by_page.values()
            )
            logger.info(
                f"テキスト抽出完了: {len(text_by_page)}ページから{total_paragraphs}個の段落を抽出しました"
            )

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
        update_meta_file(args.pdf_file, links_by_page, text_by_page, args.meta_file)

    # 画面に出力
    print(yaml_output)


if __name__ == "__main__":
    main()
