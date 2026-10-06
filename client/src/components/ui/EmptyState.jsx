export default function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="empty">
      <div className="empty-icon-disc">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  );
}
