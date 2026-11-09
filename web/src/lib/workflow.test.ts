import { expect, test } from "vitest";
import { sessionRangeError, type Basics } from "./workflow.ts";

const basics: Basics = {
  name: "test",
  department: "123",
  starts_on: "2026-11-14",
  ends_on: "2026-11-14",
  location: "123",
  description: "",
  sessions: [
    {
      id: "s",
      name: "test",
      start: "2026-11-13T14:40:00.000Z",
      end: "2026-11-13T18:40:00.000Z",
      positions: [],
    },
  ],
};

test("explains the reported out-of-range session before submission", () => {
  expect(sessionRangeError(basics)).toContain("场次“test”的时间超出项目日期");
  expect(sessionRangeError(basics)).toContain("按北京时间");
});

test("accepts UTC timestamps falling on the Beijing project date", () => {
  expect(
    sessionRangeError({
      ...basics,
      sessions: [{ ...basics.sessions[0], start: "2026-11-13T16:00:00Z" }],
    }),
  ).toBe("");
});

test("rejects a session ending on the next Beijing day", () => {
  expect(
    sessionRangeError({
      ...basics,
      sessions: [
        {
          ...basics.sessions[0],
          start: "2026-11-14T14:00:00Z",
          end: "2026-11-14T16:00:00Z",
        },
      ],
    }),
  ).toContain("超出项目日期");
});

test("includes the complete start and end calendar days", () => {
  const fullDays = {
    ...basics,
    starts_on: "2026-11-13",
    sessions: [
      {
        ...basics.sessions[0],
        start: "2026-11-13T00:00:00+08:00",
        end: "2026-11-14T23:59:59.999+08:00",
      },
    ],
  };
  expect(sessionRangeError(fullDays)).toBe("");
  expect(sessionRangeError({ ...fullDays, sessions: basics.sessions })).toBe(
    "",
  );
  expect(
    sessionRangeError({
      ...fullDays,
      sessions: [{ ...fullDays.sessions[0], end: "2026-11-15T00:00:00+08:00" }],
    }),
  ).toContain("超出项目日期");
});
