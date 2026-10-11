import { useEffect, useRef, useState } from "react";
export function HoldButton({
  duration = 3,
  disabled,
  onComplete,
}: {
  duration?: number;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    done = useRef(false),
    callback = useRef(onComplete);
  callback.current = onComplete;
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    done.current = false;
    setHolding(false);
  };
  const begin = () => {
    if (disabled || timer.current || done.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      done.current = true;
      setHolding(false);
      callback.current();
    }, duration * 1000);
  };
  useEffect(() => {
    const cancelOnHide = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", cancelOnHide);
    window.addEventListener("blur", cancel);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", cancelOnHide);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled]);
  useEffect(cancel, [duration]);
  return (
    <button
      type="button"
      className={`hold-button primary ${holding ? "holding" : ""}`}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerMove={(e) => {
        if (!holding) return;
        const b = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < b.left ||
          e.clientX > b.right ||
          e.clientY < b.top ||
          e.clientY > b.bottom
        )
          cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={cancel}
      onContextMenu={(e) => e.preventDefault()}
      style={
        { "--hold-duration": `${duration}s` } as import("react").CSSProperties
      }
      aria-label={`Hold ${duration}s to report`}
    >
      <span className="hold-fill" aria-hidden="true" />
      <span>{holding ? "Keep holding…" : `Hold ${duration}s to report`}</span>
    </button>
  );
}
