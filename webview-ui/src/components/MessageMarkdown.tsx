import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Model text is Markdown, never executable HTML. Code remains literal. */
export function MessageMarkdown({ children }: { children: string }) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt ?? 'Imagen'}</span>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
