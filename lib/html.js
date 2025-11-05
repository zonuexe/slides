export function escapeHtml(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderNode(node) {
  if (!node || !node.node) return "";

  switch (node.node) {
    case "p":
      return `<p>${node.children ? node.children.map((child) => renderNode(child)).join("") : ""}</p>`;
    case "text":
      return escapeHtml(node.content || "");
    case "bold":
      return `<strong>${escapeHtml(node.content || "")}</strong>`;
    case "link": {
      const url = node.href || "";
      const faviconUrl = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(
        url
      )}&size=32`;
      const faviconImg = `<img width="16" src="${faviconUrl}" alt="">`;
      return `${faviconImg}<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(node.content || "")}</a>`;
    }
    case "img":
      return "[img]";
    case "br":
      return "<br>";
    case "ul":
      return `<ul>${node.children ? node.children.map((child) => renderNode(child)).join("") : ""}</ul>`;
    case "li":
      if (node.children) {
        return `<li>${node.children.map((child) => renderNode(child)).join("")}</li>`;
      }
      return `<li>${escapeHtml(node.content || "")}</li>`;
    default:
      return escapeHtml(node.content || "");
  }
}
