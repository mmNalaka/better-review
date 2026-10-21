import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * PR descriptions and comments are GitHub-flavoured markdown, written by
 * whoever has access to the repository — not this app's own content. `marked`
 * renders it; `DOMPurify` sanitises the result before it ever reaches
 * `dangerouslySetInnerHTML`, the same way a stored value from any other user
 * would be treated.
 */

marked.use({ gfm: true, breaks: false });

// A link in a PR description should not navigate the review away — open it
// in a new tab instead, the way GitHub's own conversation view does.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}
