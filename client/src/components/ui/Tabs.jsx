import { useRef } from "react";

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className={value === o.id ? "seg-btn active" : "seg-btn"}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label, idPrefix = "tab" }) {
  const listRef = useRef(null);

  function onKeyDown(e) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.id === value);
    let next = at;
    if (e.key === "ArrowRight") next = (at + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (at - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    onChange(tabs[next].id);
    const btn = listRef.current && listRef.current.querySelectorAll('[role="tab"]')[next];
    if (btn) btn.focus();
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-${t.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-${t.id}-panel`}
            tabIndex={on ? 0 : -1}
            className="tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
