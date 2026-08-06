import axios from "axios";

const TOKEN_KEY = "ledgerwatch_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Single axios instance for every request. baseURL = VITE_API_URL.
const http = axios.create({
  // 8000 matches the server's PORT and client/.env.example. This fallback said
  // 5000 while api/push.js said 8000, so on any machine WITHOUT client/.env —
  // which is gitignored, so a fresh clone has none — the API and wallet pointed
  // at a dead port while push worked, making most of the app fail while one
  // corner looked healthy.
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

// Attach the Bearer token from localStorage on every request.
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear the token and broadcast a logout so the app shows login.
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event("ledgerwatch:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export default http;
