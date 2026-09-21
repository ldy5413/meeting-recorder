import test from "node:test";
import assert from "node:assert/strict";
import { orderedWork } from "../electron/ordered-work";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("parallel work is bounded and saves the original order from the resume index", async () => {
  let active = 0,
    peak = 0;
  const saved: number[] = [];
  await orderedWork(
    2,
    7,
    3,
    async (index) => {
      peak = Math.max(peak, ++active);
      await delay(index === 2 ? 25 : 5);
      active--;
      return index;
    },
    (result) => saved.push(result),
  );
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(saved, [2, 3, 4, 5, 6]);
});

test("a failed group leaves a resumable prefix and drains in-flight requests", async () => {
  const started: number[] = [],
    finished: number[] = [],
    saved: number[] = [];
  await assert.rejects(
    orderedWork(
      0,
      8,
      3,
      async (index) => {
        started.push(index);
        await delay(index === 1 ? 5 : 20);
        finished.push(index);
        if (index === 1) throw new Error("model unavailable");
        return index;
      },
      (result) => saved.push(result),
    ),
    /model unavailable/,
  );
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(finished.length, 3);
  assert.deepEqual(saved, [0]);
});
