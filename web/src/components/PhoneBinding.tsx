import ValidatedForm from "./ValidatedForm.tsx";
import { useId, useRef, useState } from "react";
import "./PhoneBinding.css";
import type { AuthSession } from "../types.ts";
import { request } from "../lib/workflow.ts";

export default function PhoneBinding({
  phone,
  onBound,
}: {
  phone?: string;
  onBound: (session: AuthSession) => void;
}) {
  const errorID = useId();
  const [value, setValue] = useState(phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <ValidatedForm
      className="phone-binding"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const result = await request<AuthSession>(
            "/auth/phone",
            { phone: value },
            "PUT",
          );
          setValue(result.user.phone || "");
          onBound(result);
          setNotice("手机号已绑定。");
        } catch (cause) {
          setError((cause as Error).message);
          const status = (cause as { status?: number }).status;
          if (status === 400 || status === 409) {
            input.current?.setAttribute("aria-invalid", "true");
            input.current?.focus();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        绑定手机号
        <input
          ref={input}
          required
          type="tel"
          inputMode="tel"
          name="phone"
          placeholder="请输入本人手机号"
          data-validate="phone"
          aria-describedby={error ? errorID : undefined}
          autoComplete="tel"
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
            setNotice("");
          }}
        />
      </label>
      {error && (
        <p className="error" role="alert" id={errorID}>
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <button className="button secondary" disabled={busy}>
        {busy ? "正在保存…" : phone ? "更新绑定手机号" : "绑定手机号"}
      </button>
    </ValidatedForm>
  );
}
