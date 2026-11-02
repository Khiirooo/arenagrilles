import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, csvFromRows } from "../csvUtils.js";

test("échappe les guillemets et les séparateurs", () => {
  assert.equal(csvCell('Club "Arc", Nord'), '"Club ""Arc"", Nord"');
  assert.equal(csvFromRows([["Nom", "Club"], ["Zoé", "Club; Jette"]]),
    '"Nom";"Club"\r\n"Zoé";"Club; Jette"');
});

test("neutralise les formules tableur dans les noms", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", " =HYPERLINK()"]) {
    assert.equal(csvCell(value).startsWith('"\''), true, value);
  }
  assert.equal(csvCell("Tempogym"), '"Tempogym"');
});
