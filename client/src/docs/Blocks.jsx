import { Fragment } from "react";
import { Link } from "react-router-dom";

/**
 * The renderer for written pages: the guide, the privacy policy, the terms.
 *
 * Content is data, not JSX, so a page reads like a document while it is being
 * written and cannot smuggle markup in. The only inline formatting is a small
 * fixed set: **bold**, `code`, and [a link](/path). Anything else is text.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

export function rich(text) {
  if (typeof text !== "string") return text;
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/")) {
        return (
          <Link key={i} to={href}>
            {label}
          </Link>
        );
      }
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Block({ block }) {
  switch (block.type) {
    case "h2":
      return <h2 id={slugify(block.text)}>{block.text}</h2>;
    case "h3":
      return <h3 id={slugify(block.text)}>{block.text}</h3>;
    case "p":
      return <p>{rich(block.text)}</p>;
    case "ul":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{rich(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className={block.steps ? "docs-steps" : undefined}>
          {block.items.map((item, i) => (
            <li key={i}>{rich(item)}</li>
          ))}
        </ol>
      );
    case "callout":
      return (
        <div className={`docs-callout${block.tone ? ` ${block.tone}` : ""}`}>
          {block.title && <strong className="docs-callout-title">{block.title}</strong>}
          {rich(block.text)}
        </div>
      );
    case "table":
      return (
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{rich(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "img":
      return (
        <figure className={block.phone ? "docs-figure phone" : "docs-figure"}>
          <img src={`/docs/${block.src}`} alt={block.alt || block.caption || ""} loading="lazy" />
          {block.caption && <figcaption>{rich(block.caption)}</figcaption>}
        </figure>
      );
    default:
      return null;
  }
}

export function Blocks({ blocks }) {
  return blocks.map((block, i) => <Block key={i} block={block} />);
}
