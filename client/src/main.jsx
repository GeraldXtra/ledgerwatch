import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import ConfigMissing from "./components/ConfigMissing.jsx";
import { API_MISSING } from "./api/base";
import { installErrorReporting } from "./api/reportError";
import "./index.css";
import "./styles/app.css";

installErrorReporting();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {API_MISSING ? (
        <ConfigMissing />
      ) : (
        <BrowserRouter>
          <App />
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
