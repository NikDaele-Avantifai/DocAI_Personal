import { useState } from "react"
import "./popup.css"

function Popup() {
  const [status, setStatus] = useState<"idle" | "scanning">("idle")

  return (
    <div className="popup-container">
      <header className="popup-header">
        <h1>DocAI</h1>
        <span className="version">v0.1.0</span>
      </header>

      <main className="popup-main">
        <p className="status-text">
          {status === "idle"
            ? "Ready to analyze your Confluence space."
            : "Scanning documentation..."}
        </p>

        <button
          className="btn-primary"
          onClick={() => setStatus(status === "idle" ? "scanning" : "idle")}>
          {status === "idle" ? "Start Analysis" : "Stop"}
        </button>
      </main>

      <footer className="popup-footer">
        <a href="http://localhost:3000" target="_blank" rel="noreferrer">
          Open Dashboard →
        </a>
      </footer>
    </div>
  )
}

export default Popup
