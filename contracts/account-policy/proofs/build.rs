//! Pins the contract source and builds the generated module: the contract verbatim, plus the proof modules as its children.
use std::fs;
use std::path::Path;
use std::process::Command;

/// contracts/account-policy/src/lib.rs of release 9 (frozen at tag r9-frozen-3, after re-freeze 2: the red team's RT3); release 8 was lib e951e00a…b23a (wasm 1f7d6334…f863); release 7 was lib c3bdaee8…b75a (wasm 013ee2b5…b978), release 6, the repo at 35e84f4 (lib c68ec080…2bad).
const PINNED_LIB_SHA256: &str = "e83ec614796ce334b1f8ce6515c9aaf80b8d70531d7a642d651762f2fc8eec5e";
const PINNED_TESTS_SHA256: &str = "fffb90b4924ee673873618d5c1631d4feb2c4fafa9d4bc5880c4c24ecb5a7956";

fn sha256(path: &Path) -> String {
    let out = Command::new("shasum").args(["-a", "256"]).arg(path).output().expect("shasum");
    String::from_utf8(out.stdout).unwrap().split_whitespace().next().unwrap().to_string()
}

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let lib = root.join("../src/lib.rs");
    let tests = root.join("../src/tests.rs");
    for f in ["../src/lib.rs", "../src/tests.rs", "../src/quote.rs", "src/kani_proofs.rs", "src/checker.rs", "src/model.rs", "src/fuzz_api.rs", "build.rs"] {
        println!("cargo:rerun-if-changed={}", root.join(f).display());
    }
    if std::env::var("PROOFS_SKIP_PIN").is_err() {
        assert_eq!(sha256(&lib), PINNED_LIB_SHA256, "lib.rs is not the pinned release-9 source");
        assert_eq!(sha256(&tests), PINNED_TESTS_SHA256, "tests.rs is not the pinned release-9 source");
    }
    let gen = root.join("generated");
    let sub = gen.clone();
    fs::create_dir_all(&sub).unwrap();
    println!("cargo::rustc-check-cfg=cfg(kani)");
    let mut src = fs::read_to_string(&lib).unwrap();
    src.push_str("\n// ── appended by proofs/build.rs: proof modules as children of the contract module ──\n");
    src.push_str("#[cfg(kani)]\nmod kani_proofs;\n#[cfg(test)]\nmod model;\n#[cfg(test)]\nmod checker;\n#[cfg(feature = \"fuzzing\")]\npub mod fuzz_api;\n");
    fs::write(gen.join("contract.rs"), src).unwrap();
    fs::copy(&tests, sub.join("tests.rs")).unwrap();
    // B4: the contract's quote module, without its unit tests (they read fixtures by a path from src/; the contract's own
    // crate runs them).
    let quote = fs::read_to_string(root.join("../src/quote.rs")).unwrap();
    assert!(quote.contains("#[cfg(test)]\nmod tests;\n"), "quote.rs's test module moved");
    fs::write(sub.join("quote.rs"), quote.replace("#[cfg(test)]\nmod tests;\n", "")).unwrap();
    for f in ["kani_proofs.rs", "checker.rs", "model.rs", "fuzz_api.rs"] {
        fs::copy(root.join("src").join(f), sub.join(f)).unwrap();
    }
}
