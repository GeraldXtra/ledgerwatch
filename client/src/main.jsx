import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./index.css";
// The interface layer. Loaded after index.css, which keeps the design tokens and
// the older rules the 122 components still rely on. Everything about the current
// look lives in ledger.css so it reads in one sitting and reverts in one move.
import "./styles/ledger.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
