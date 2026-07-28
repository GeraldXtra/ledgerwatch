/**
 * Segmented control (auth login/register toggle). `options`: [{ id, label }].
 */
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
