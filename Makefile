# Makefile for slides project

.PHONY: help script-format script-lint script-check fetch-static

# Default target
help:
	@echo "Available targets:"
	@echo "  script-format  - Format Python files in script/ directory"
	@echo "  script-lint     - Lint Python files in script/ directory"
	@echo "  script-check    - Run both format and lint checks"
	@echo "  fetch-static    - Fetch slide pages from localhost into static files"

# Format Python files using ruff
script-format:
	@echo "Formatting Python files in script/ directory..."
	cd script && uvx ruff format *.py

# Lint Python files using ruff
script-lint:
	@echo "Linting Python files in script/ directory..."
	cd script && uvx ruff check *.py

# Run both format and lint checks
script-check: script-format script-lint
	@echo "All script checks completed"

fetch-static:
	@echo "Fetching static slide pages..."
	UV_CACHE_DIR=.uv-cache uv run python script/fetch_static_slides.py
