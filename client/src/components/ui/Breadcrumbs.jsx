import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export default function Breadcrumbs({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <nav className="crumbs" aria-label="Breadcrumbs">
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
              {last ? (
                <span aria-current="page">{item.label}</span>
              ) : item.to ? (
                <Link to={item.to}>{item.label}</Link>
              ) : (
                <button type="button" onClick={item.onClick}>
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
