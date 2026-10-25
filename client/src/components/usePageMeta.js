import { useEffect } from "react";

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  const created = !el;
  if (created) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const previous = el.getAttribute("content");
  el.setAttribute("content", content);
  return () => {
    if (created) el.remove();
    else if (previous != null) el.setAttribute("content", previous);
  };
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  const created = !el;
  if (created) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  const previous = el.getAttribute("href");
  el.setAttribute("href", href);
  return () => {
    if (created) el.remove();
    else if (previous != null) el.setAttribute("href", previous);
  };
}

export function plainText(markdown, max = 200) {
  const text = String(markdown || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max)}...`;
}

export default function usePageMeta({ title, description, path, noindex = false } = {}) {
  useEffect(() => {
    const undo = [];
    const previousTitle = document.title;
    if (title) {
      document.title = title;
      undo.push(setMeta("property", "og:title", title));
      undo.push(setMeta("name", "twitter:title", title));
    }
    if (description) {
      undo.push(setMeta("name", "description", description));
      undo.push(setMeta("property", "og:description", description));
      undo.push(setMeta("name", "twitter:description", description));
    }
    if (path != null) {
      const href = `${window.location.origin}${path}`;
      undo.push(setCanonical(href));
      undo.push(setMeta("property", "og:url", href));
    }
    if (noindex) undo.push(setMeta("name", "robots", "noindex, nofollow"));
    return () => {
      document.title = previousTitle;
      undo.reverse().forEach((restore) => restore());
    };
  }, [title, description, path, noindex]);
}
