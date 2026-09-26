import { expect, test } from "bun:test"
import { durationDisplay, statValue } from "./values.ts"

test("durations read from the label", () => {
  expect(durationDisplay("25 min timer")).toBe("25:00")
  expect(durationDisplay("25 minute focus timer")).toBe("25:00")
  expect(durationDisplay("1 hour 30 min")).toBe("1:30:00")
  expect(durationDisplay("90 sec break")).toBe("01:30")
  expect(durationDisplay("pomodoro timer")).toBeNull()
})

test("stat values read from the label", () => {
  expect(statValue("Revenue $12400")).toBe("$12,400")
  expect(statValue("Conversion 4.5%")).toBe("4.5%")
  expect(statValue("Active users")).toBeNull()
})
