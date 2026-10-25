function clientBase() {
  const first = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return (first || "http://localhost:5173").replace(/\/+$/, "");
}

function serverBase() {
  return String(process.env.SERVER_URL || "")
    .trim()
    .replace(/\/+$/, "");
}

function clientUrl(path = "/") {
  return `${clientBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

function serverUrl(path = "/") {
  const base = serverBase();
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : null;
}

module.exports = { clientBase, serverBase, clientUrl, serverUrl };
