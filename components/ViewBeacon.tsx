"use client";
import { useEffect } from "react";

export function ViewBeacon({ docId }: { docId: string }) {
  useEffect(() => {
    const start = Date.now();
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      const duration = Date.now() - start;
      const payload = JSON.stringify({ docId, duration_ms: duration });
      try {
        navigator.sendBeacon(
          "/api/track/view",
          new Blob([payload], { type: "application/json" }),
        );
      } catch (err) {
        // navigator.sendBeacon throws only on invalid Blob type or unsupported browser.
        // Log for diagnostics but treat as best-effort — a failed beacon must never
        // break the reading experience.
        console.warn("[view-beacon] sendBeacon failed:", err);
      }
    };

    // Fire an "opened" event immediately so we capture the view even if the
    // user navigates away before the close beacon fires.
    void fetch("/api/track/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, opened: true }),
      keepalive: true,
    });

    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", send);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", send);
      send();
    };
  }, [docId]);

  return null;
}
