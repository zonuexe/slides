#!/usr/bin/env bash
set -euo pipefail

# Generate PNG thumbnails for each PDF in the specified directory.
# Usage: ./generate_pdf_thumbnails.sh [pdf_directory]

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_PDF_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/pdf"
PDF_DIR="${1:-${DEFAULT_PDF_DIR}}"

if [[ ! -d "${PDF_DIR}" ]]; then
  echo "error: PDF directory not found: ${PDF_DIR}" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  CONVERT_CMD=(magick convert)
elif command -v convert >/dev/null 2>&1; then
  CONVERT_CMD=(convert)
else
  echo "error: ImageMagick 'convert' (or 'magick') is required." >&2
  exit 1
fi

shopt -s nullglob
pdf_files=("${PDF_DIR}"/*.pdf)
shopt -u nullglob

if [[ ${#pdf_files[@]} -eq 0 ]]; then
  echo "warning: no PDF files found in ${PDF_DIR}" >&2
  exit 0
fi

for pdf_path in "${pdf_files[@]}"; do
  base_name="$(basename "${pdf_path}" .pdf)"
  output_path="${PDF_DIR}/${base_name}.png"

  tmp_output="$(mktemp "${output_path}.XXXXXX.png")"
  trap 'rm -f "${tmp_output}"' EXIT

  "${CONVERT_CMD[@]}" -quiet -density 200 "${pdf_path}[0]" \
    -thumbnail "1200x630>" -strip -background white -alpha remove -alpha off \
    png32:"${tmp_output}"

  mv -f "${tmp_output}" "${output_path}"
  trap - EXIT
  echo "generated ${output_path}"
done
