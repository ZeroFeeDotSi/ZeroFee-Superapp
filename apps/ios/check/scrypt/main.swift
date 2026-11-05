// The native scrypt (CoreContext.swift's Scrypt) against RFC 7914 §12's test vectors and @noble/hashes (cases.json from
// cases.ts), each timed. Run by ../scrypt.sh.   args: <cases.json>
import Foundation

func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined() }
func bytes(_ h: String) -> [UInt8] {
  var out: [UInt8] = []
  var i = h.startIndex
  while i < h.endIndex {
    let j = h.index(i, offsetBy: 2)
    out.append(UInt8(h[i..<j], radix: 16)!)
    i = j
  }
  return out
}

var failed = 0
func check(_ label: String, _ password: [UInt8], _ salt: [UInt8], _ n: Int, _ r: Int, _ p: Int, _ dkLen: Int, _ want: String, maxMemory: Int = Scrypt.maxMemory) {
  let started = Date()
  let got = Scrypt.derive(password: password, salt: salt, N: n, r: r, p: p, dkLen: dkLen, maxMemory: maxMemory).map(hex)
  let ms = Int(Date().timeIntervalSince(started) * 1000)
  let ok = got == want
  print(ok ? "✔" : "✖", label, "N=\(n) r=\(r) p=\(p) dkLen=\(dkLen)", "(\(ms) ms)", ok ? "" : "got \(got ?? "nil"), want \(want)")
  if !ok { failed += 1 }
}

// RFC 7914 §12.
let rfc: [(String, String, Int, Int, Int, String)] = [
  ("", "", 16, 1, 1, "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906"),
  ("password", "NaCl", 1024, 8, 16, "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"),
  ("pleaseletmein", "SodiumChloride", 16384, 8, 1, "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887"),
  ("pleaseletmein", "SodiumChloride", 1048576, 8, 1, "2101cb9b6a511aaeaddbbe09cf70f881ec568d574a2ffd4dabe5ee9820adaa478e56fd8f4ba5d09ffa1c6d927c40f4c337304049e8a952fbcbf45c6fa77a41a4"),
]
for (i, v) in rfc.enumerated() {
  // The fourth needs 1 GiB (128·8·2^20), past what the core may ask for: allowed here only.
  check("RFC 7914 vector \(i + 1)", Array(v.0.utf8), Array(v.1.utf8), v.2, v.3, v.4, 64, v.5, maxMemory: 1 << 30)
}

// The same bytes as @noble/hashes, the core's scrypt everywhere else.
struct Case: Decodable { let N: Int; let r: Int; let p: Int; let dkLen: Int; let password: String; let salt: String; let key: String }
let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
for (i, c) in cases.enumerated() {
  check(i == 0 ? "the link's parameters, vs @noble/hashes" : "vs @noble/hashes", bytes(c.password), bytes(c.salt), c.N, c.r, c.p, c.dkLen, c.key)
}

// The controls: a changed byte gives another key, and what isn't scrypt (N not a power of two, past the memory cap, r=0) is refused.
let base = Scrypt.derive(password: Array("a".utf8), salt: Array("b".utf8), N: 16, r: 1, p: 1, dkLen: 32)
let other = Scrypt.derive(password: Array("c".utf8), salt: Array("b".utf8), N: 16, r: 1, p: 1, dkLen: 32)
let refused = [Scrypt.derive(password: [], salt: [], N: 1000, r: 1, p: 1, dkLen: 32), Scrypt.derive(password: [], salt: [], N: 1 << 20, r: 8, p: 1, dkLen: 32), Scrypt.derive(password: [], salt: [], N: 16, r: 0, p: 1, dkLen: 32)]
let controls = base != nil && base != other && refused.allSatisfy { $0 == nil }
print(controls ? "✔" : "✖", "controls: another password gives another key; N=1000, 1 GiB and r=0 are refused")
if !controls { failed += 1 }

print(failed == 0 ? "all passed" : "\(failed) failed")
exit(failed == 0 ? 0 : 1)
