import { useState, useCallback, useRef } from "react";

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((msg, type = "info") => {
    clearTimeout(timer.current);
    setToast({ msg, type });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return { toast, show };
}

export function Toast({ toast }) {
  if (!toast) return null;
  const icon  = toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ";
  const color = toast.type === "success" ? "var(--green)" : toast.type === "error" ? "var(--red)" : "var(--muted)";
  return (
    <div className="toast">
      <span style={{ color, fontWeight: 700 }}>{icon}</span>
      {toast.msg}
    </div>
  );
}
