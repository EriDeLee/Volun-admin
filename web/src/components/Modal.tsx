import type { ModalProps } from "../types.ts";
import { useId, useRef } from "react";
import { useModalDialog } from "../lib/useModalDialog.ts";
import Icon from "./Icon.tsx";

export default function Modal({
  title,
  children,
  onClose,
  locked = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleID = useId();
  useModalDialog(ref);
  return (
    <dialog
      ref={ref}
      className="activity-dialog"
      {...{ closedby: locked ? "none" : "closerequest" }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
      aria-labelledby={titleID}
    >
      <div className="activity-dialog-head">
        <h2 id={titleID}>{title}</h2>
        <button
          type="button"
          autoFocus
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
