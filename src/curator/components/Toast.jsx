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
  const icon = toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ";
  const cls  = toast.type === "success" ? "toast toast-success"
             : toast.type === "error"   ? "toast toast-error"
             :                            "toast toast-info";
  return (
    <div className={cls}>
      <span>{icon}</span>
      {toast.msg}
    </div>
  );
}
