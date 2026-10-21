import { useMemo } from "react";

import { renderMarkdown } from "./renderMarkdown";

interface MarkdownProps {
  readonly text: string;
  readonly className?: string;
}

/** Sanitised GitHub-flavoured markdown — see `markdown.ts` for the rendering and sanitising. */
export function Markdown({ text, className }: MarkdownProps) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
