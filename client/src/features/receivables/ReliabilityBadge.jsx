import { bandTone } from "./format";

export default function ReliabilityBadge({ score, band, size = "md" }) {
  const tone = bandTone(band);
  const cls = `rel-badge tone-${tone} ${size === "sm" ? "rel-sm" : ""}`.trim();
  return (
    <span className={cls} title={`${band}${score != null ? `, ${score} out of 100` : ""}`}>
      <span className="rel-score num">{score != null ? score : "New"}</span>
      <span className="rel-band">{band}</span>
    </span>
  );
}
