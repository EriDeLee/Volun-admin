import { useEffect, useRef, useState } from "react";
import { request } from "../lib/workflow.ts";

export interface VolunteerAccount {
  username: string;
  name: string;
  number: string;
  phone: string;
}

export default function ProjectAccountPicker({
  base,
  onSelect,
}: {
  base: string;
  onSelect: (account: VolunteerAccount) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<VolunteerAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const requestID = useRef(0);
  useEffect(
    () => () => {
      requestID.current++;
    },
    [],
  );
  return (
    <fieldset className="recruit-full" aria-busy={busy}>
      <legend>从平台账号选择志愿者</legend>
      <label>
        姓名、学号或账号
        <input
          maxLength={160}
          value={query}
          onChange={(e) => {
            requestID.current++;
            setQuery(e.target.value);
            setItems([]);
            setSearched(false);
            setBusy(false);
            setError("");
          }}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy || !query.trim()}
        onClick={async () => {
          const id = ++requestID.current;
          setBusy(true);
          setError("");
          try {
            const result = await request<{ items: VolunteerAccount[] }>(
              `${base}/members/candidates?q=${encodeURIComponent(query.trim())}`,
            );
            if (id === requestID.current) {
              setItems(result.items);
              setSearched(true);
            }
          } catch (cause) {
            if (id === requestID.current) setError((cause as Error).message);
          } finally {
            if (id === requestID.current) setBusy(false);
          }
        }}
      >
        {busy ? "正在查询…" : "查询志愿者账号"}
      </button>
      {error && <p role="alert">{error}</p>}
      {searched && (
        <p role="status">
          {items.length
            ? `找到 ${items.length} 个账号。`
            : "未找到可添加的账号，可继续手动填写。"}
        </p>
      )}
      {items.map((account) => (
        <button
          type="button"
          className="button secondary"
          key={account.username}
          onClick={() => {
            requestID.current++;
            setBusy(false);
            onSelect(account);
            setItems([]);
            setSearched(false);
          }}
        >
          选择 {account.name} · {account.number} · {account.username}
        </button>
      ))}
    </fieldset>
  );
}
