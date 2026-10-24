const LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function isPlainAddress(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s || s.length > 254 || s.includes("..")) return false;
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  const labels = s.slice(at + 1).split(".");
  if (local.startsWith(".") || local.endsWith(".")) return false;
  return LOCAL_RE.test(local) && labels.length >= 2 && labels.every((l) => LABEL_RE.test(l));
}

module.exports = { isPlainAddress };
