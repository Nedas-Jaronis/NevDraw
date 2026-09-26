import { expect, test } from "bun:test"
import { durationDisplay, statValue } from "./values.ts"

test("durations read from the label", () => {
  expect(durationDisplay("25 min timer")).toBe("25:00")
  expect(durationDisplay("25 minute focus timer")).toBe("25:00")
  expect(durationDisplay("1 hour 30 min")).toBe("1:30:00")
  expect(durationDisplay("90 sec break")).toBe("01:30")
  expect(durationDisplay("pomodoro timer")).toBeNull()
  expect(durationDisplay("25-minute timer")).toBe("25:00")
})

test("stat values read from the label", () => {
  expect(statValue("Revenue $12400")).toBe("$12,400")
  expect(statValue("Conversion 4.5%")).toBe("4.5%")
  expect(statValue("Active users")).toBeNull()
})

import { amount, clock, durationSeconds, onColor, progressOf, route } from "./values.ts"

test("more values read from labels", () => {
  expect(durationSeconds("15 min")).toBe(900)
  expect(clock(900)).toBe("15:00")
  expect(clock(3725)).toBe("1:02:05")
  expect(amount("spent $450 on uber")).toBe("$450")
  expect(amount("12.5 dollars lunch")).toBe("$12.50")
  expect(progressOf("read 12 books, 4 done")).toEqual({ value: 4 / 12, text: "4 of 12" })
  expect(progressOf("3/4 steps")).toEqual({ value: 0.75, text: "3 of 4" })
  expect(onColor("#fcc419")).toBe("#1c1917")
  expect(onColor("#1c7ed6")).toBe("#ffffff")
  expect(route("flight to goa next weekend")).toEqual({ from: null, to: "Goa" })
  expect(route("sfo to jfk")).toEqual({ from: "SFO", to: "JFK" })
})
