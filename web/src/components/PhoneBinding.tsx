import { useEffect, useId, useRef, useState } from "react";
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
  const hintID = useId();
  const errorID = useId();
  const [value, setValue] = useState(phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (invalid) input.current?.focus();
  }, [invalid]);
  return (
    <form
      className="phone-binding"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        setInvalid(false);
        setNotice("");
        try {
          const result = await request<AuthSession>(
            "/auth/phone",
            { phone: value },
            "PUT",
          );
          setValue(result.user.phone || "");
          onBound(result);
          setNotice("手机号已绑定，后续报名将自动读取。");
        } catch (cause) {
          setError((cause as Error).message);
          const status = (cause as { status?: number }).status;
          setInvalid(status === 400 || status === 409);
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
          aria-invalid={invalid || undefined}
          aria-describedby={error ? `${hintID} ${errorID}` : hintID}
          autoComplete="tel"
          maxLength={20}
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
            setError("");
            setNotice("");
          }}
          placeholder="11位手机号"
        />
      </label>
      <p className="phone-binding-hint" id={hintID}>
        一个手机号只能绑定一个账号。
      </p>
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
    </form>
  );
}
