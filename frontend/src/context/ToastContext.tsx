import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  leaving: boolean;
}

interface ToastContextValue {
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4500,
  info: 4500,
  warning: 5500,
  error: 6500,
};

let idCounter = 0;

/** Déclenche un toast depuis du code hors React (ex. l'intercepteur axios dans api/client.ts). */
type Emit = (type: ToastType, message: string, duration?: number) => void;
let externalEmit: Emit | null = null;

export function emitToast(type: ToastType, message: string, duration?: number) {
  externalEmit?.(type, message, duration);
}

const ICON_PATHS: Record<ToastType, string> = {
  success: "M4.5 12.75l6 6 9-13.5",
  error:
    "M12 9v3.75m0 3.75h.008M10.29 3.86L1.82 18a1.5 1.5 0 001.29 2.25h17.78a1.5 1.5 0 001.29-2.25L13.71 3.86a1.5 1.5 0 00-2.42 0z",
  warning:
    "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 4.5c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
  info: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z",
};

const TONE: Record<ToastType, string> = {
  success: "border-emerald-100 bg-emerald-50/95 text-emerald-800",
  error: "border-rose-100 bg-rose-50/95 text-rose-800",
  warning: "border-amber-100 bg-amber-50/95 text-amber-800",
  info: "border-brand-100 bg-brand-50/95 text-brand-800",
};

const ICON_TONE: Record<ToastType, string> = {
  success: "bg-emerald-500 text-white",
  error: "bg-rose-500 text-white",
  warning: "bg-amber-500 text-white",
  info: "bg-brand-500 text-white",
};

const BAR_TONE: Record<ToastType, string> = {
  success: "bg-emerald-400",
  error: "bg-rose-400",
  warning: "bg-amber-400",
  info: "bg-brand-400",
};

function ToastIcon({ type }: { type: ToastType }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[type]} />
    </svg>
  );
}

function ToastItemView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [entered, setEntered] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration);
  const startRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Bascule la classe d'entrée après le montage pour que la transition CSS parte bien
  // de l'état "hors écran" plutôt que de s'appliquer instantanément.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (paused || toast.leaving) return;
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startRef.current;
    };
  }, [paused, toast.leaving, toast.id, onDismiss]);

  return (
    <div
      role="alert"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`toast-item pointer-events-auto relative w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-sm px-4 py-3.5 flex items-start gap-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none ${TONE[toast.type]} ${
        entered && !toast.leaving
          ? "opacity-100 translate-x-0 scale-100"
          : "opacity-0 translate-x-8 scale-95"
      }`}
    >
      <span className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center mt-0.5 ${ICON_TONE[toast.type]}`}>
        <ToastIcon type={toast.type} />
      </span>
      <p className="flex-1 text-sm font-semibold leading-snug pt-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Fermer"
        className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-current/60 hover:bg-black/5 hover:text-current transition"
      >
        ×
      </button>
      <div
        className={`absolute left-0 bottom-0 h-1 rounded-full ${BAR_TONE[toast.type]}`}
        style={{
          width: "100%",
          animation: `toast-progress ${toast.duration}ms linear forwards`,
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}

const MAX_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 300);
  }, []);

  const push = useCallback((type: ToastType, message: string, duration?: number) => {
    const id = ++idCounter;
    setToasts((list) => [
      ...list.slice(-(MAX_TOASTS - 1)),
      { id, type, message, duration: duration ?? DEFAULT_DURATION[type], leaving: false },
    ]);
  }, []);

  useEffect(() => {
    externalEmit = push;
    return () => {
      externalEmit = null;
    };
  }, [push]);

  const value: ToastContextValue = {
    success: (message, duration) => push("success", message, duration),
    error: (message, duration) => push("error", message, duration),
    info: (message, duration) => push("info", message, duration),
    warning: (message, duration) => push("warning", message, duration),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex flex-col items-center gap-2.5 p-4 sm:items-end">
        {toasts.map((t) => (
          <ToastItemView key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() doit être utilisé à l'intérieur de <ToastProvider>.");
  return ctx;
}
