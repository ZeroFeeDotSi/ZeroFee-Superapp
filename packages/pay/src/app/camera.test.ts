import { test } from "node:test";
import assert from "node:assert/strict";
import { readPhoto, watchCamera, type CameraEnv, type CameraState } from "./camera.ts";

/** A pretend camera: counts every request for it and every track it stops. */
function fakeCamera(opts: { refuse?: boolean; code?: string } = {}) {
  const calls: MediaStreamConstraints[] = [];
  const stopped: number[] = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push(1) }] } as unknown as MediaStream;
  const env: CameraEnv = {
    getUserMedia: async (c) => {
      calls.push(c);
      if (opts.refuse) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return stream;
    },
    Detector: class {
      async detect() {
        return opts.code ? [{ rawValue: opts.code }] : [];
      }
    },
  };
  return { env, calls, stopped };
}
const video = () => ({ srcObject: null, play: async () => {} }) as unknown as HTMLVideoElement;
const tick = () => new Promise((r) => setTimeout(r, 5));

test("Scan off screen (active=false) never asks for the camera", async () => {
  const cam = fakeCamera();
  const states: CameraState[] = [];
  const stop = watchCamera({ active: false, env: cam.env, video, onState: (s) => states.push(s), onCode: () => assert.fail("no code off screen") });
  await tick();
  assert.equal(cam.calls.length, 0, "getUserMedia was never called");
  assert.deepEqual(states, ["off"]);
  stop();
});

test("on screen it asks once for the back camera, reads a code, and stops every track when it goes", async () => {
  const cam = fakeCamera({ code: "solana:abc" });
  const codes: string[] = [];
  const stop = watchCamera({ active: true, env: cam.env, video, onState: () => {}, onCode: (c) => codes.push(c) });
  await tick();
  assert.equal(cam.calls.length, 1);
  assert.deepEqual(cam.calls[0], { video: { facingMode: "environment" } });
  assert.deepEqual(codes, ["solana:abc"]);
  stop();
  assert.equal(cam.stopped.length, 1, "the track is stopped the moment Scan stops being on screen");
});

test("leaving before the camera opens still stops it, and nothing is read", async () => {
  const cam = fakeCamera({ code: "solana:abc" });
  const stop = watchCamera({ active: true, env: cam.env, video, onState: () => {}, onCode: () => assert.fail("read after leaving") });
  stop();
  await tick();
  assert.equal(cam.stopped.length, 1);
});

test("a refused camera is named, so Paste becomes the way in", async () => {
  const cam = fakeCamera({ refuse: true });
  const states: CameraState[] = [];
  watchCamera({ active: true, env: cam.env, video, onState: (s) => states.push(s), onCode: () => {} });
  await tick();
  assert.deepEqual(states, ["starting", "refused"]);
  const none = watchCamera({ active: true, env: {}, video, onState: (s) => states.push(s), onCode: () => {} });
  none();
  assert.equal(states.at(-1), "unsupported");
});

// "From a photo": the same reader as the camera, on one still picture from the person's Photos.
const still = async () => ({}) as ImageBitmap;
const reader = (found: { rawValue: string }[] | Error) =>
  class {
    async detect() {
      if (found instanceof Error) throw found;
      return found;
    }
  } as unknown as CameraEnv["Detector"];

test("a code in a photo is read once and goes the same way as a scanned one", async () => {
  assert.deepEqual(await readPhoto(new Blob(), { Detector: reader([{ rawValue: "solana:abc?amount=1" }]) }, still), { code: "solana:abc?amount=1" });
});

test("a photo with no code, or one the reader can't open, is 'no code', never a crash", async () => {
  assert.deepEqual(await readPhoto(new Blob(), { Detector: reader([]) }, still), { none: true });
  assert.deepEqual(await readPhoto(new Blob(), { Detector: reader(new Error("bad image")) }, still), { none: true });
  assert.deepEqual(await readPhoto(new Blob(), { Detector: reader([]) }, async () => { throw new Error("not an image"); }), { none: true });
});

test("where there's no code reader at all, the photo path says so (and Paste stays)", async () => {
  assert.deepEqual(await readPhoto(new Blob(), {}, still), { unsupported: true });
});
