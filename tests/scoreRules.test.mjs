import test from "node:test";
import assert from "node:assert/strict";
import { parseNum, isValidNumberInput, checkCell } from "../scoreRules.js";

const multiDE = { mode: "DE", start: 10, judges: 3, combine: "avg", bonus: false };
const multiSingle = { mode: "single", start: 20, judges: 2, combine: "avg", bonus: true };

test("accepte les décimales francophones, le zéro et le champ effacé", () => {
  assert.equal(parseNum("8,75"), 8.75);
  assert.equal(parseNum("0"), 0);
  assert.equal(parseNum(""), null);
  assert.equal(isValidNumberInput(""), true);
});

test("rejette les chaînes ambiguës (parseFloat les acceptait)", () => {
  for (const input of ["8abc", "12.1.1", "1e9999", "NaN", "Infinity", "1,2,3", " "]) {
    if (input.trim()) assert.equal(isValidNumberInput(input), false, input);
    assert.equal(parseNum(input), null, input);
  }
});

test("ne valide pas une division D+E sans tous les juges", () => {
  assert.match(checkCell({ d: 4, e: { 1: 8, 2: 7.9 } }, multiDE), /juge 3/i);
  assert.equal(checkCell({ d: 4, e: { 1: 8, 2: 7.9, 3: 8.2 } }, multiDE), null);
});

test("refuse les notes supérieures au maximum ou non numériques", () => {
  assert.match(checkCell({ d: 3, e: { 1: 8, 2: "huit", 3: 7 } }, multiDE), /juge 2/i);
  assert.match(checkCell({ d: 3, e: { 1: 8, 2: 10.5, 3: 7 } }, multiDE), /hors/i);
  assert.match(checkCell({ notes: { 1: 20, 2: 20.01 } }, multiSingle), /hors/i);
});

test("refuse les notes uniques incomplètes et les pénalités suspectes", () => {
  assert.match(checkCell({ notes: { 1: 17 } }, multiSingle), /juge 2/i);
  assert.match(checkCell({ notes: { 1: 17, 2: 17.5 }, pen: -1 }, multiSingle), /Pénalité/i);
  assert.equal(checkCell({ notes: { 1: 17, 2: 17.5 }, pen: 0.5, bonus: 0.2 }, multiSingle), null);
});

test("refuse un bonus impossible et les divisions absentes", () => {
  assert.match(checkCell({ notes: { 1: 12, 2: 12 }, bonus: 99 }, multiSingle), /Bonus/i);
  assert.match(checkCell({}, undefined), /inconnue/i);
});
