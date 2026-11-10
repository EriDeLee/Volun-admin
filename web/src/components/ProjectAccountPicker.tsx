import { useState } from "react";
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
  return (
    <fieldset className="recruit-full">
      <legend>从平台账号选择志愿者</legend>
      <label>
        姓名、学号或账号
        <input
          maxLength={160}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setItems([]);
            setSearched(false);
          }}
        />
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy || !query.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await request<{ items: VolunteerAccount[] }>(
              `${base}/members/candidates?q=${encodeURIComponent(query.trim())}`,
            );
            setItems(result.items);
            setSearched(true);
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在查询…" : "查询志愿者账号"}
      </button>
      {error && <p role="alert">{error}</p>}
      {searched && !items.length && <p>未找到可添加的账号，可继续手动填写。</p>}
      {items.map((account) => (
        <button
          type="button"
          className="button secondary"
          key={account.username}
          onClick={() => {
            onSelect(account);
            setItems([]);
            setSearched(false);
          }}
        >
          选择 {account.name} · {account.number} · {account.username}
        </button>
      ))}
      <small>
        最多显示20个匹配账号。选中后自动填写姓名、学号和绑定手机号，再选择场次与岗位保存。
      </small>
    </fieldset>
  );
}
