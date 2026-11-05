//! `create_account({ new_account_id, new_public_key })` as mainnet's `near` registrar answers it: a new top-level account
//! with the attached deposit and that ed25519 key as its full-access key. For the local sandbox rehearsal only
//! (tools/mainnet/flows-rehearse.sh); never deployed anywhere else.
use near_sys as sys;

fn input() -> Vec<u8> {
    unsafe {
        sys::input(0);
        let len = sys::register_len(0);
        let mut buf = vec![0u8; len as usize];
        sys::read_register(0, buf.as_mut_ptr() as u64);
        buf
    }
}

fn fail(msg: &str) -> ! {
    unsafe { sys::panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
}

/// The string value of `"key":"…"` in a flat JSON object (the registrar's two arguments have no escapes).
fn field<'a>(json: &'a str, key: &str) -> &'a str {
    let tag = format!("\"{}\"", key);
    let at = json.find(&tag).unwrap_or_else(|| fail("missing argument"));
    let rest = &json[at + tag.len()..];
    let open = rest.find('"').unwrap_or_else(|| fail("bad argument"));
    let rest = &rest[open + 1..];
    let close = rest.find('"').unwrap_or_else(|| fail("bad argument"));
    &rest[..close]
}

fn base58(s: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut out: Vec<u8> = vec![];
    for c in s.bytes() {
        let mut carry = ALPHABET.iter().position(|&a| a == c).unwrap_or_else(|| fail("bad base58")) as u32;
        for b in out.iter_mut().rev() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            out.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|&c| c == b'1').count();
    let mut full = vec![0u8; zeros];
    full.extend(out);
    full
}

#[no_mangle]
pub extern "C" fn create_account() {
    let raw = input();
    let json = core::str::from_utf8(&raw).unwrap_or_else(|_| fail("bad input"));
    let id = field(json, "new_account_id");
    let key = field(json, "new_public_key");
    let b58 = key.strip_prefix("ed25519:").unwrap_or_else(|| fail("ed25519 keys only"));
    let bytes = base58(b58);
    if bytes.len() != 32 {
        fail("a key is 32 bytes");
    }
    let mut pk = vec![0u8];
    pk.extend(bytes);
    let mut deposit = [0u8; 16];
    unsafe {
        sys::attached_deposit(deposit.as_mut_ptr() as u64);
        let p = sys::promise_batch_create(id.len() as u64, id.as_ptr() as u64);
        sys::promise_batch_action_create_account(p);
        sys::promise_batch_action_transfer(p, deposit.as_ptr() as u64);
        sys::promise_batch_action_add_key_with_full_access(p, pk.len() as u64, pk.as_ptr() as u64, 0);
        sys::promise_return(p);
    }
}
