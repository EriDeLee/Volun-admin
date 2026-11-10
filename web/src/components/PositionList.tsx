import { useState } from "react";
import type { Position } from "../lib/workflow.ts";
import "./PositionList.css";

export default function PositionList({
  positions,
  onChange,
}: {
  positions: Position[];
  onChange: (positions: Position[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const update = (id: string, change: Partial<Position>) =>
    onChange(
      positions.map((position) =>
        position.id === id ? { ...position, ...change } : position,
      ),
    );

  return (
    <div className="position-list">
      <div className="position-list-heading">
        <h4>
          岗位列表 <span>共 {positions.length} 个岗位</span>
        </h4>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const id = crypto.randomUUID();
            onChange([
              ...positions,
              { id, name: "", capacity: 1, hours: null, description: "" },
            ]);
            setEditing(id);
          }}
        >
          增加岗位
        </button>
      </div>
      {positions.length ? (
        <div className="activity-table-wrap">
          <table className="activity-table position-list-table">
            <thead>
              <tr>
                <th scope="col">岗位名称</th>
                <th scope="col">招募人数</th>
                <th scope="col">拟计整数小时</th>
                <th scope="col">岗位说明</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => {
                const editable =
                  editing === position.id || !position.name.trim();
                return (
                  <tr
                    key={position.id}
                    onFocus={() => {
                      if (editable) setEditing(position.id);
                    }}
                  >
                    <td>
                      {editable ? (
                        <input
                          aria-label={`岗位${index + 1}名称`}
                          required
                          value={position.name}
                          onChange={(event) =>
                            update(position.id, { name: event.target.value })
                          }
                        />
                      ) : (
                        position.name
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          aria-label={`岗位${index + 1}招募人数`}
                          type="number"
                          required
                          min={1}
                          step={1}
                          value={position.capacity}
                          onChange={(event) =>
                            update(position.id, {
                              capacity: Number(event.target.value),
                            })
                          }
                        />
                      ) : (
                        `${position.capacity} 人`
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          aria-label={`岗位${index + 1}拟计整数小时`}
                          type="number"
                          min={0}
                          step={1}
                          value={position.hours ?? ""}
                          onChange={(event) =>
                            update(position.id, {
                              hours:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      ) : position.hours === null ? (
                        "未填写"
                      ) : (
                        `${position.hours} 小时`
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <textarea
                          aria-label={`岗位${index + 1}说明`}
                          rows={2}
                          value={position.description}
                          onChange={(event) =>
                            update(position.id, {
                              description: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <span className="position-list-description">
                          {position.description || "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="activity-text-button"
                          onClick={(event) => {
                            if (editable) {
                              const row = event.currentTarget.closest("tr");
                              for (const input of row?.querySelectorAll(
                                "input",
                              ) || []) {
                                if (!input.reportValidity()) return;
                              }
                            }
                            setEditing(editable ? null : position.id);
                          }}
                        >
                          {editable ? "完成" : "编辑"}
                        </button>
                        <button
                          type="button"
                          className="activity-text-button"
                          aria-label={`删除岗位${index + 1}`}
                          onClick={() => {
                            onChange(
                              positions.filter(
                                (item) => item.id !== position.id,
                              ),
                            );
                            if (editing === position.id) setEditing(null);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="position-list-empty">暂无岗位，点击“增加岗位”填写。</p>
      )}
    </div>
  );
}
