import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="center-screen">
        <div className="card auth-card stack" style={{ textAlign: "center" }}>
          <div className="wordmark" style={{ fontSize: 18 }}>
            Ledger<span className="tick">Watch</span>
          </div>
          <h2 className="section-title">Something went wrong</h2>
          <p className="muted small">
            The page hit an unexpected error. Reloading usually fixes it, and your data is safe.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
