// One way Home copies text. A clipboard can answer oddly: a web view's writeText may return nothing or throw at once, and
// a page's own hook may too (QA's crawl, 4 Nov: the Add row's tap copied, then threw before it said "Copied").
// This never throws and always gives a promise: true when the clipboard said yes.
export function copyText(text: string): Promise<boolean> {
  try {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip?.writeText) return Promise.resolve(false);
    return Promise.resolve(clip.writeText(text)).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}
