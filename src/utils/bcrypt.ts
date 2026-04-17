import bcrypt from 'bcryptjs';

// Provide a fallback random source for environments without WebCrypto/crypto
// This is sufficient for non-production hashing in dev/testing.
try {
  // @ts-ignore - setRandomFallback exists at runtime on bcryptjs
  if (typeof (bcrypt as any).setRandomFallback === 'function') {
    // @ts-ignore
    (bcrypt as any).setRandomFallback((len: number): Uint8Array => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = Math.floor(Math.random() * 256);
      }
      return out;
    });
  }
} catch {}

export default bcrypt;