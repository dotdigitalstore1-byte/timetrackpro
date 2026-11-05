"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f1f5f9" }}>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 16, padding: 24, textAlign: "center", boxShadow: "0 10px 30px rgba(15,23,42,.08)" }}>
            <h1 style={{ fontSize: 18, color: "#0f172a", margin: "0 0 8px" }}>TimeTrack could not start</h1>
            <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 16px" }}>
              {error.message || "An unexpected error occurred. Please reload the page."}
            </p>
            <button
              onClick={reset}
              style={{ background: "#4f46e5", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}