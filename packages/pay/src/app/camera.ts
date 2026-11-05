// The camera loop behind Scan, kept apart from the screen so it is tested without a browser.
//
// It starts only while Pay is the app on screen (useShell().active). The shell keeps neighbouring apps rendered for
// instant swipes, so a camera started off-screen would be running unseen, and the phone would ask for permission
// out of nowhere. When `active` turns false, or Scan goes away, the stop function ends every track at once.

export type CameraState = "off" | "starting" | "on" | "refused" | "unsupported";
export interface Detector {
  /** A camera frame, or one still image (a photo the person picked). */
  detect(source: HTMLVideoElement | ImageBitmap | HTMLImageElement): Promise<{ rawValue: string }[]>;
}
export type DetectorCtor = new (options: { formats: string[] }) => Detector;

export interface CameraEnv {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** The browser's own QR reader, where it has one; no QR library ships for it. */
  Detector?: DetectorCtor;
}

/** The real browser's camera and QR reader. */
export function browserCamera(): CameraEnv {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  return {
    getUserMedia: media?.getUserMedia ? (c) => media.getUserMedia(c) : undefined,
    Detector: (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector,
  };
}

export interface WatchOptions {
  /** True only while Pay is the app on screen. False never touches the camera. */
  active: boolean;
  env: CameraEnv;
  video: () => HTMLVideoElement | null;
  onState: (state: CameraState) => void;
  onCode: (text: string) => void;
  everyMs?: number;
}

/** Starts the camera when allowed to and reads codes from it. Returns the function that stops it. */
export function watchCamera(o: WatchOptions): () => void {
  if (!o.active) {
    o.onState("off");
    return () => {};
  }
  const { getUserMedia, Detector } = o.env;
  if (!getUserMedia || !Detector) {
    o.onState("unsupported");
    return () => {};
  }
  let stream: MediaStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const detector = new Detector({ formats: ["qr_code"] });
  o.onState("starting");
  getUserMedia({ video: { facingMode: "environment" } })
    .then((s) => {
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      stream = s;
      const v = o.video();
      if (v) {
        v.srcObject = s;
        // play() rejects if the screen goes away before the first frame; that's not an error.
        v.play().catch(() => {});
      }
      o.onState("on");
      const look = async () => {
        if (stopped) return;
        const frame = o.video();
        if (frame) {
          try {
            const found = await detector.detect(frame);
            if (found[0]?.rawValue && !stopped) return o.onCode(found[0].rawValue);
          } catch {
            // A frame that couldn't be read: try the next one.
          }
        }
        timer = setTimeout(look, o.everyMs ?? 250);
      };
      void look();
    })
    .catch((e: unknown) => {
      if (!stopped) o.onState((e as { name?: string })?.name === "NotAllowedError" ? "refused" : "unsupported");
    });
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
}

/** A photo the person picked, as one still image the reader can look at. */
async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type PhotoRead = { code: string } | { none: true } | { unsupported: true };

/**
 * Scan's "From a photo": the code in a picture from the person's Photos (a screenshot of a bill, a photo of a sticker),
 * read by the same reader as the camera, once. On the phone the host answers BarcodeDetector; in a browser, its own.
 */
export async function readPhoto(file: Blob, env: Pick<CameraEnv, "Detector">, load: (file: Blob) => Promise<ImageBitmap | HTMLImageElement> = loadImage): Promise<PhotoRead> {
  if (!env.Detector) return { unsupported: true };
  try {
    const found = await new env.Detector({ formats: ["qr_code"] }).detect(await load(file));
    return found[0]?.rawValue ? { code: found[0].rawValue } : { none: true };
  } catch {
    // Not an image the reader can open, or nothing in it it can read.
    return { none: true };
  }
}
