import type { ModalProps } from "../types.ts";
import { useEffect, useRef } from "react";
import Icon from "./Icon.tsx";

export default function Modal({
  title,
  children,
  onClose,
  locked = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="activity-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      aria-labelledby="workspace-dialog-title"
    >
      <div className="activity-dialog-head">
        <h2 id="workspace-dialog-title">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={locked}
          className="activity-icon-button"
          aria-label="关闭弹窗"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
