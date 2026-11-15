import { useEffect, type RefObject } from "react";

// Keep React's mounted state in step with the native top-layer dialog lifecycle.
// Focus containment and restoration remain the browser's responsibility.
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  open = true,
) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close?.();
    };
  }, [ref, open]);
}
