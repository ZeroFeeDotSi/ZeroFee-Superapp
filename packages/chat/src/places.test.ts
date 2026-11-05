// Places by name (grade 02g, G5): a typed city becomes its place on the phone, from the bundled list; nothing is looked up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cityOf, findCities, placeAt, placeName } from "./places.ts";
import { CHECK_PLACE } from "./relays.ts";
import { isPlace } from "./geohash.ts";

test("Zurich is #u0qj, however it is typed", () => {
  for (const typed of ["Zurich", "zurich", " ZÜRICH ", "Zür"]) assert.equal(findCities(typed)[0]?.place, CHECK_PLACE, typed);
  assert.equal(placeName(CHECK_PLACE), "Zurich");
  assert.equal(placeName("u0qk"), "#u0qk", "a place not on the list keeps BitChat's letters");
  assert.equal(cityOf("zzzz"), null);
});

test("a word inside a name finds it; one letter finds nothing; at most five", () => {
  assert.equal(findCities("francisco")[0]?.name, "San Francisco");
  assert.deepEqual(findCities("z"), []);
  assert.ok(findCities("sa").length <= 5);
  assert.ok(findCities("Switzerland").some((c) => c.name === "Geneva"), "a country lists its cities");
});

test("every city is a real place, and no two cities share one (a place's name is never the wrong city)", () => {
  const seen = new Map<string, string>();
  for (const q of "abcdefghijklmnopqrstuvwxyz".split("").flatMap((a) => "abcdefghijklmnopqrstuvwxyz".split("").map((b) => a + b))) {
    for (const c of findCities(q, 999)) {
      assert.ok(isPlace(c.place), c.name);
      const other = seen.get(c.place);
      assert.ok(!other || other === c.name, `${c.name} and ${other} share #${c.place}`);
      seen.set(c.place, c.name);
    }
  }
  assert.ok(seen.size > 100);
});

test("Nearby: a point becomes its place here, the same as the city's", () => {
  assert.equal(placeAt(47.37, 8.54), CHECK_PLACE);
  assert.equal(placeAt(1.35, 103.82), findCities("Singapore")[0]?.place);
});
