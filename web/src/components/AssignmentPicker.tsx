import type { Assignment, ServiceSession } from "../lib/workflow.ts";
import { localTime } from "../lib/workflow.ts";

export default function AssignmentPicker({
  sessions,
  value,
  onChange,
  disabled = false,
}: {
  sessions: ServiceSession[];
  value: Assignment[];
  onChange: (value: Assignment[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="assignment-picker" disabled={disabled}>
      <legend>参加场次和岗位（可多选）</legend>
      <p>勾选要参加的岗位，可以选择多个场次或同场次的多个岗位。</p>
      {!sessions.length && <p>暂无可选场次，请联系项目管理员。</p>}
      {sessions.map((session) => (
        <section className="assignment-session" key={session.id}>
          <div>
            <strong>{session.name}</strong>
            <small>
              {localTime(session.start).replace("T", " ")} 至{" "}
              {localTime(session.end).replace("T", " ")}
            </small>
          </div>
          <div className="assignment-positions">
            {session.positions.map((position) => {
              const selected = value.some(
                (a) =>
                  a.session_id === session.id && a.position_id === position.id,
              );
              return (
                <label key={position.id} className={selected ? "selected" : ""}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      onChange(
                        selected
                          ? value.filter(
                              (a) =>
                                !(
                                  a.session_id === session.id &&
                                  a.position_id === position.id
                                ),
                            )
                          : [
                              ...value,
                              {
                                session_id: session.id,
                                position_id: position.id,
                              },
                            ],
                      )
                    }
                  />
                  <span>
                    {position.name}
                    <small>
                      招募 {position.capacity} 人
                      {position.description && ` · ${position.description}`}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </fieldset>
  );
}
