(() => {
  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const SNIPPET_LENGTH = 160;

  function getQueryParam(name) {
    if (typeof URLSearchParams === "undefined") return "";
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get(name) || "";
    } catch (error) {
      return "";
    }
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildSnippet(content, query) {
    const text = String(content || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (!query) {
      return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
    }
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) {
      return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
    }
    const start = Math.max(0, index - Math.floor(SNIPPET_LENGTH / 4));
    const end = Math.min(text.length, start + SNIPPET_LENGTH);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = `…${snippet}`;
    if (end < text.length) snippet = `${snippet}…`;
    return snippet;
  }

  function highlightSnippet(snippet, query) {
    if (!query) {
      return escapeHtml(snippet);
    }
    const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
    const parts = snippet.split(pattern);
    return parts
      .map((part, index) => {
        if (index % 2 === 1) {
          return `<mark>${escapeHtml(part)}</mark>`;
        }
        return escapeHtml(part);
      })
      .join("");
  }

  function createCard(slide, query) {
    const title = escapeHtml(slide.title || "");
    const slug = escapeHtml(slide.slug || "");
    const date = escapeHtml(slide.date || "");
    const events = Array.isArray(slide.events)
      ? slide.events.flatMap((event) => {
          if (!event || typeof event !== "object") return [];
          const name = typeof event.name === "string" ? event.name.trim() : "";
          if (!name) return [];
          const locations = [];
          if (typeof event.location === "string" && event.location.trim()) {
            locations.push(event.location.trim());
          }
          if (typeof event.place === "string" && event.place.trim()) {
            locations.push(event.place.trim());
          }
          return [
            {
              name,
              presented_at: typeof event.presented_at === "string" ? event.presented_at : "",
              location: locations.join(" / "),
            },
          ];
        })
      : [];
    const eventsHtml = events.length
      ? `<div class="slide-card-events">${events
          .map(
            (event) =>
              `<p class="slide-card-event h-event"><i class="fa-solid fa-microphone-lines" aria-hidden="true"></i> <span class="p-name">${escapeHtml(
                event.name
              )}</span>${
                event.presented_at
                  ? ` <time class="dt-start visually-hidden" datetime="${escapeHtml(
                      event.presented_at
                    )}">${escapeHtml(event.presented_at)}</time>`
                  : ""
              }${
                event.location
                  ? ` <span class="p-location visually-hidden">${escapeHtml(event.location)}</span>`
                  : ""
              }</p>`
          )
          .join("")}</div>`
      : "";
    const tagNames = Array.isArray(slide.tags)
      ? slide.tags.flatMap((tag) => {
          if (typeof tag !== "string") return [];
          const value = tag.trim();
          return value ? [value] : [];
        })
      : [];
    const tagsHtml = tagNames.length
      ? `<ul class="slide-card-tags">${tagNames
          .map(
            (tag) =>
              `<li class="p-category"><i class="fa-solid fa-tag" aria-hidden="true"></i> ${escapeHtml(tag)}</li>`
          )
          .join("")}</ul>`
      : "";
    const baseSnippet = typeof slide.snippet === "string" ? slide.snippet : "";
    const snippetText = query ? buildSnippet(slide.content || baseSnippet || "", query) : baseSnippet;
    const snippetHtml = snippetText
      ? `<p class="slide-card-snippet p-summary${query ? "" : " visually-hidden"}">${
          query ? highlightSnippet(snippetText, query) : escapeHtml(snippetText)
        }</p>`
      : "";
    return `
      <div class="slide-card h-entry">
        <h3><a class="slide-link p-name u-url" href="/slides/${slug}/">${title}</a></h3>
        <p class="slide-card-meta">${slug}</p>
        <p>公開日: <time class="dt-published" datetime="${date}">${date}</time></p>
        ${eventsHtml}
        ${tagsHtml}
        ${snippetHtml}
        <span class="p-author h-card visually-hidden"><a href="https://twitter.com/tadsan" class="p-name u-url">USAMI Kenta</a></span>
      </div>
    `;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const slides = Array.isArray(window.slidesData) ? window.slidesData : [];
    const searchInput = document.getElementById("search-input");
    const resultMeta = document.getElementById("search-result-count");
    const slideGrid = document.querySelector(".slide-grid");

    if (!searchInput || !slideGrid) {
      return;
    }

    const FuseConstructor = typeof window.Fuse === "function" ? window.Fuse : null;

    const fuse =
      slides.length && FuseConstructor
        ? new FuseConstructor(slides, {
            keys: ["title", "slug", "date", "content"],
            threshold: 0.3,
            ignoreLocation: true,
          })
        : null;

    function render(list, query) {
      if (!list.length) {
        slideGrid.innerHTML = `<p class="no-results">"${escapeHtml(
          query
        )}" に一致するスライドは見つかりませんでした。</p>`;
      } else {
        slideGrid.innerHTML = list.map((slide) => createCard(slide, query)).join("");
      }
      const total = slides.length;
      const countText = query
        ? `${list.length}件 / 全${total}件`
        : `全${total}件`;
      if (resultMeta) {
        resultMeta.textContent = countText;
      }
    }

    function handleSearch(initial) {
      const query = searchInput.value.trim();
      if (!query) {
        render(slides, "");
        if (!initial) {
          if (typeof history !== "undefined" && history.replaceState) {
            const url = new URL(window.location.href);
            url.searchParams.delete("q");
            history.replaceState(null, "", url.toString());
          }
        }
        return;
      }
      if (!fuse) {
        render([], query);
        return;
      }
      const matches = fuse.search(query).map((result) => result.item);
      render(matches, query);
      if (!initial && typeof history !== "undefined" && history.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.set("q", query);
        history.replaceState(null, "", url.toString());
      }
    }

    searchInput.addEventListener("input", () => handleSearch(false));

    const initialQuery = getQueryParam("q");
    if (initialQuery) {
      searchInput.value = initialQuery;
      handleSearch(true);
    } else {
      render(slides, "");
    }
  });
})();
