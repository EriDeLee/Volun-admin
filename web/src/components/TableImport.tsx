import { useState } from "react";
import ScrollRegion from "./ScrollRegion.tsx";
import ValidatedForm from "./ValidatedForm.tsx";

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  type?: "text" | "number";
  min?: number;
  max?: number;
  step?: number;
  validate?: (value: string, rows: Record<string, string>[]) => boolean;
}

export default function TableImport({
  label,
  columns,
  busy,
  onImport,
}: {
  label: string;
  columns: ImportColumn[];
  busy: boolean;
  onImport: (rows: Record<string, string>[]) => Promise<boolean | undefined>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [extraColumns, setExtraColumns] = useState(false);
  const [checked, setChecked] = useState(false);
  const okay = (column: ImportColumn, value: string) =>
    (!column.required || !!value.trim()) &&
    (!value ||
      column.type !== "number" ||
      (Number.isFinite(Number(value)) &&
        Number.isInteger(Number(value)) &&
        Number(value) >= (column.min ?? 0) &&
        Number(value) <= (column.max ?? Infinity))) &&
    (!column.validate || column.validate(value, rows));
  return (
    <ValidatedForm
      className="workflow-form"
      validateField={(field) => {
        if (field instanceof HTMLTextAreaElement) return !extraColumns;
        const column = columns.find(
          (item) => item.key === field.dataset.column,
        );
        return !column || okay(column, field.value);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        setChecked(true);
        if (!rows.length || extraColumns || busy) return;
        if (
          rows.some((row) =>
            columns.some((column) => !okay(column, row[column.key])),
          )
        ) {
          event.currentTarget
            .querySelector<HTMLInputElement>('[aria-invalid="true"]')
            ?.focus();
          return;
        }
        if (await onImport(rows)) {
          setRows([]);
          setText("");
          setChecked(false);
        }
      }}
    >
      <label>
        {label}
        <textarea
          value={text}
          disabled={busy}
          aria-invalid={extraColumns || undefined}
          placeholder={columns.map((column) => column.label).join(" · ")}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            const lines = value
              .replace(/[\r\n]+$/, "")
              .split(/\r?\n/)
              .filter((line) => line.trim());
            const cells = lines.map((line) => line.split("\t"));
            setExtraColumns(cells.some((row) => row.length > columns.length));
            setRows(
              cells.map((row) =>
                Object.fromEntries(
                  columns.map((column, index) => [
                    column.key,
                    row[index]?.trim() || "",
                  ]),
                ),
              ),
            );
            setChecked(true);
          }}
        />
      </label>
      {extraColumns && (
        <p className="error" role="alert">
          列数不匹配，请按下方列名粘贴。
        </p>
      )}
      {!!rows.length && (
        <ScrollRegion label={`${label}预览`} className="workflow-table">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                {columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <input
                        data-column={column.key}
                        aria-label={`${column.label}，第 ${index + 1} 行`}
                        type={column.type || "text"}
                        required={column.required}
                        min={column.min}
                        max={column.max}
                        step={column.step}
                        aria-invalid={
                          (checked && !okay(column, row[column.key])) ||
                          undefined
                        }
                        value={row[column.key]}
                        disabled={busy}
                        onChange={(event) =>
                          setRows((previous) =>
                            previous.map((item, position) =>
                              position === index
                                ? { ...item, [column.key]: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <button className="button secondary" disabled={busy || !rows.length}>
        {busy ? "正在导入…" : "导入"}
      </button>
    </ValidatedForm>
  );
}
