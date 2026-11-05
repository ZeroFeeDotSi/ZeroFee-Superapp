// The hash the iPhone host pins provider.js to (Security's section C): it injects the file only if its sha256 is this.
// Changing provider.js means changing this line in the same commit, and Security reviews both (provider.test.ts fails
// until they match).
export const PROVIDER_SHA256 = "6e083ac3b350bd769ed5825c5f4e8daf69f9d9559f4d03e55946a34f637158a9";
