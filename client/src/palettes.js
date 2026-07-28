/**
 * Three candidate palettes for the visual rebuild.
 *
 * Each entry is a COMPLETE override of the design-system token set defined in
 * index.css `:root`. Because every component reads those tokens, dropping a
 * palette's `tokens` object onto a wrapper element as inline custom properties
 * recolours the real components inside it — which is exactly how /style-preview
 * renders three truthful previews at once, and how the winner gets promoted into
 * `:root` afterwards.
 *
 * `chart` holds the values recharts needs as literal hex props (it cannot read
 * CSS variables), so charts stay in step with the palette from one source.
 *
 * Contrast notes are measured against white for text-bearing values.
 */

// ---------------------------------------------------------------------------
// A · GRAPHITE & CYAN — cool, technical, precise. The saturated accent.
// Cyan (~193°) collides with neither semantic green (~155°) nor red (~5°), and
// sits well clear of the banned framework blue.
// ---------------------------------------------------------------------------
const graphiteCyan = {
  id: "A",
  name: "Graphite & Cyan",
  tagline: "Cool, technical, precise — one saturated accent against strict cool greys.",
  note: "Most saturated of the three. Its one weak point is that cyan and the paid-green are the closest pair here — judge that on the table row below.",
  tokens: {
    "--ink": "#0B0D10",
    "--body": "#39414D",
    "--muted": "#647084",
    "--faint": "#93A0B4",

    "--canvas": "#F4F6F8",
    "--canvas-2": "#E9EDF2",
    "--canvas-deep": "#DFE4EB",
    "--card": "#FFFFFF",
    "--well": "#F2F5F8",
    "--hero-tint": "#F7FBFC",
    "--border": "#DFE5EC",
    "--border-hi": "#C3CCD8",

    "--accent-800": "#063C47",
    "--accent-700": "#08657A",
    "--accent-600": "#08758E", // PRIMARY — white on this = 5.3:1 (AA)
    "--accent-500": "#06B6D4", // brand tone: charts, logo, indicators (non-text)
    "--accent-400": "#22D3EE",
    "--accent-100": "#C9F0F7",
    "--accent-50": "#ECFAFD",
    "--ring": "rgba(8, 117, 142, 0.30)",

    "--pos-text": "#0A7D4F",
    "--pos-bg": "#D6F2E4",
    "--neg-text": "#C02222",
    "--neg-bg": "#FBE0DE",
    "--warn-text": "#8A5A11",
    "--warn-bg": "#FBEEDA",
    "--neutral-text": "#5A6675",
    "--neutral-bg": "#EDF0F4",

    // Elevation: layered, low-spread, tinted with the palette's own ink.
    "--sh-sm": "0 1px 2px rgba(11,13,16,.06), 0 1px 3px rgba(11,13,16,.05)",
    "--sh-md": "0 2px 4px rgba(11,13,16,.06), 0 8px 20px rgba(11,13,16,.08)",
    "--sh-lg": "0 4px 8px rgba(11,13,16,.07), 0 20px 40px rgba(11,13,16,.11)",
    "--sh-hero": "0 24px 60px rgba(11,13,16,.17), 0 8px 20px rgba(11,13,16,.09)",

    // Legacy aliases: a few rules still name the old families directly (e.g. the
    // `.card.hero` top rule). Remapping them keeps the preview truthful; Step 2
    // rewrites those rules onto --accent-* and deletes these two lines.
    "--navy-700": "#08758E",
    "--gold-500": "#06B6D4",
  },
  logo: { tile: "#0B0D10", dot: "#06B6D4" },
  chart: {
    // Single-hue intensity ramp (current → 90d+). No second hue, and the light
    // end is still dark enough to read against white.
    ramp: ["#9FDCEC", "#5FC7E0", "#22A8C7", "#0B7F99", "#06556A"],
    grid: "#E9EDF2",
    cursor: "rgba(11,13,16,0.05)",
    axis: "#647084",
  },
  swatches: [
    ["ink", "#0B0D10"],
    ["canvas", "#F4F6F8"],
    ["card", "#FFFFFF"],
    ["border", "#DFE5EC"],
    ["primary 600", "#08758E"],
    ["brand 500", "#06B6D4"],
    ["paid", "#0A7D4F"],
    ["overdue", "#C02222"],
    ["pending", "#5A6675"],
  ],
};

// ---------------------------------------------------------------------------
// B · OXBLOOD & BONE — warm, editorial, private-bank. The memorable one.
// Wine vs semantic red is resolved by ROLE and VALUE, not hue: wine only ever
// appears as a solid saturated fill or dark text; overdue only ever appears as a
// light-tint pill carrying the word "Overdue".
// ---------------------------------------------------------------------------
const oxbloodBone = {
  id: "B",
  name: "Oxblood & Bone",
  tagline: "Warm, editorial, private-bank — deep wine on bone neutrals.",
  note: "The most distinctive and the least likely to look generated. Wine never shares a treatment with the overdue pill, so the two read apart by value and role.",
  tokens: {
    "--ink": "#16110F",
    "--body": "#4A403B",
    "--muted": "#7C6E67",
    "--faint": "#A99B93",

    "--canvas": "#FAF8F5",
    "--canvas-2": "#F2EDE7",
    "--canvas-deep": "#EAE3DA",
    "--card": "#FFFFFF",
    "--well": "#F6F2ED",
    "--hero-tint": "#FDF7F8",
    "--border": "#E7DFD7",
    "--border-hi": "#D3C7BC",

    "--accent-800": "#4E0D22",
    "--accent-700": "#7A1538",
    "--accent-600": "#9E1B47", // PRIMARY — white on this = 7.8:1 (AAA)
    "--accent-500": "#C42B5F", // brand tone: charts, logo, indicators
    "--accent-400": "#DB5480",
    "--accent-100": "#F7D6E1",
    "--accent-50": "#FDF0F4",
    "--ring": "rgba(158, 27, 71, 0.28)",

    "--pos-text": "#0F7A4A",
    "--pos-bg": "#D9F2E5",
    "--neg-text": "#D0342C",
    "--neg-bg": "#FBE3E0",
    "--warn-text": "#8A5A11",
    "--warn-bg": "#F9EEDB",
    "--neutral-text": "#6B615B",
    "--neutral-bg": "#F0EBE5",

    "--sh-sm": "0 1px 2px rgba(22,17,15,.06), 0 1px 3px rgba(22,17,15,.05)",
    "--sh-md": "0 2px 4px rgba(22,17,15,.06), 0 8px 20px rgba(22,17,15,.08)",
    "--sh-lg": "0 4px 8px rgba(22,17,15,.07), 0 20px 40px rgba(22,17,15,.11)",
    "--sh-hero": "0 24px 60px rgba(22,17,15,.17), 0 8px 20px rgba(22,17,15,.09)",

    "--navy-700": "#9E1B47",
    "--gold-500": "#C42B5F",
  },
  logo: { tile: "#16110F", dot: "#C42B5F" },
  chart: {
    ramp: ["#EAB3C6", "#D9769B", "#C03A6B", "#9C1F4C", "#6B1132"],
    grid: "#F2EDE7",
    cursor: "rgba(22,17,15,0.05)",
    axis: "#7C6E67",
  },
  swatches: [
    ["ink", "#16110F"],
    ["canvas", "#FAF8F5"],
    ["card", "#FFFFFF"],
    ["border", "#E7DFD7"],
    ["primary 600", "#9E1B47"],
    ["brand 500", "#C42B5F"],
    ["paid", "#0F7A4A"],
    ["overdue", "#D0342C"],
    ["pending", "#6B615B"],
  ],
};

// ---------------------------------------------------------------------------
// C · OBSIDIAN — pure neutral monochrome. Near-black primary, and the only
// chromatic pixels in the product are the ones that carry meaning. Satisfies
// accent-vs-semantic separation absolutely, because there is no decorative accent.
// ---------------------------------------------------------------------------
const obsidian = {
  id: "C",
  name: "Obsidian",
  tagline: "Monochrome chrome, near-black primary — colour only where it means something.",
  note: "Maximum contrast (19:1 primary) and zero palette-ageing risk. The most austere of the three: strongest to judges, coolest to a non-technical viewer.",
  tokens: {
    "--ink": "#0A0A0B",
    "--body": "#3D3D42",
    "--muted": "#6B6B73",
    "--faint": "#9A9AA3",

    "--canvas": "#F5F5F6",
    "--canvas-2": "#EBEBED",
    "--canvas-deep": "#E2E2E4",
    "--card": "#FFFFFF",
    "--well": "#F3F3F4",
    "--hero-tint": "#FAFAFB",
    "--border": "#E2E2E5",
    "--border-hi": "#C9C9CE",

    "--accent-800": "#000000",
    "--accent-700": "#232327",
    "--accent-600": "#101013", // PRIMARY — white on this = 19.0:1
    "--accent-500": "#2E2E34",
    "--accent-400": "#52525A",
    "--accent-100": "#E4E4E7",
    "--accent-50": "#F4F4F5",
    "--ring": "rgba(10, 10, 11, 0.32)",

    "--pos-text": "#067647",
    "--pos-bg": "#D3F3E2",
    "--neg-text": "#C7261C",
    "--neg-bg": "#FBE1DF",
    "--warn-text": "#8A5A11",
    "--warn-bg": "#F8EEDC",
    "--neutral-text": "#64646D",
    "--neutral-bg": "#EFEFF1",

    "--sh-sm": "0 1px 2px rgba(10,10,11,.07), 0 1px 3px rgba(10,10,11,.05)",
    "--sh-md": "0 2px 4px rgba(10,10,11,.07), 0 8px 20px rgba(10,10,11,.09)",
    "--sh-lg": "0 4px 8px rgba(10,10,11,.08), 0 20px 40px rgba(10,10,11,.12)",
    "--sh-hero": "0 24px 60px rgba(10,10,11,.18), 0 8px 20px rgba(10,10,11,.10)",

    // Obsidian's hero rule is a graphite fade rather than a two-hue gradient.
    "--navy-700": "#101013",
    "--gold-500": "#52525A",
  },
  // The one place Obsidian permits a chromatic pixel in the chrome: the mark's
  // dot reads as the "live" signal. Everything else is black and white.
  logo: { tile: "#0A0A0B", dot: "#067647" },
  chart: {
    // Graphite intensity ramp — severity reads as darkness, and even the light
    // end holds against white.
    ramp: ["#B4B4BB", "#8A8A93", "#5F5F68", "#3A3A41", "#18181B"],
    grid: "#EBEBED",
    cursor: "rgba(10,10,11,0.05)",
    axis: "#6B6B73",
  },
  swatches: [
    ["ink", "#0A0A0B"],
    ["canvas", "#F5F5F6"],
    ["card", "#FFFFFF"],
    ["border", "#E2E2E5"],
    ["primary 600", "#101013"],
    ["tone 500", "#2E2E34"],
    ["paid", "#067647"],
    ["overdue", "#C7261C"],
    ["pending", "#64646D"],
  ],
};

export const PALETTES = [graphiteCyan, oxbloodBone, obsidian];

export default PALETTES;
