import test from "ava";
import parseIntInput from "../src/parseIntInput";

test("TODO", (t) => t.pass());

test("parseIntInput requires the full value to be an integer", (t) => {
  t.is(parseIntInput("300seconds", 30, 1, 300), 30);
  t.is(parseIntInput("3.9", 30, 1, 300), 30);
  t.is(parseIntInput("300", 30, 1, 300), 300);
});
