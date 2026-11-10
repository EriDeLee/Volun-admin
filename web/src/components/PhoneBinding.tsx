import { useId, useState } from "react";
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
  const [value, setValue] = useState(phone || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <form
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
          setNotice("手机号已绑定，后续报名将自动读取。");
        } catch (cause) {
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        绑定手机号
        <input
          required
          type="tel"
          inputMode="tel"
          aria-describedby={hintID}
          autoComplete="tel"
          maxLength={20}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          placeholder="11位手机号"
        />
      </label>
      <p className="phone-binding-hint" id={hintID}>
        一个手机号只能绑定一个账号。
      </p>
      {error && (
        <p className="error" role="alert">
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
