// A simple, static key for obfuscation.
// IMPORTANT: This is NOT for high-security scenarios, but meets the requirement to not store keys in plain text.
const KEY = 'srt-translator-super-secret-key-for-github-storage';

/**
 * Applies a simple XOR cipher to a Uint8Array using a key string.
 * @param data The Uint8Array to cipher.
 * @param key The key string for the cipher.
 * @returns The ciphered Uint8Array.
 */
const xorCipherBytes = (data: Uint8Array, key: string): Uint8Array => {
    // Pre-encode the key to bytes for efficiency in the loop.
    const keyBytes = new TextEncoder().encode(key);
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ keyBytes[i % keyBytes.length];
    }
    return result;
};

/**
 * Encrypts a string by converting it to UTF-8 bytes, applying an XOR cipher,
 * and then encoding the result in Base64. This version is safe for Unicode characters.
 * @param text The plain text string to encrypt.
 * @returns The Base64 encoded, encrypted string.
 */
export const encrypt = (text: string): string => {
  if (!text) return '';
  try {
    const encoder = new TextEncoder();
    // 1. Convert the Unicode string to UTF-8 bytes.
    const data = encoder.encode(text);
    // 2. Apply the XOR cipher on the byte array.
    const cipheredData = xorCipherBytes(data, KEY);
    // 3. Convert the resulting byte array to a "binary string" (each character code is a byte value).
    let binaryString = '';
    for (let i = 0; i < cipheredData.length; i++) {
        binaryString += String.fromCharCode(cipheredData[i]);
    }
    // 4. Base64 encode the binary string.
    return btoa(binaryString);
  } catch (error) {
    console.error("Encryption failed:", error);
    // Return the original text if encryption fails, to prevent data loss.
    return text;
  }
};

/**
 * Decrypts a string by decoding it from Base64, applying an XOR cipher,
 * and then decoding the resulting UTF-8 bytes back to a string. This version is safe for Unicode.
 * @param encryptedText The Base64 encoded string to decrypt.
 * @returns The decrypted, plain text string.
 */
export const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return '';
  try {
    // 1. Decode the Base64 string to a "binary string".
    const binaryString = atob(encryptedText);
    // 2. Convert the binary string to a byte array.
    const data = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
    }
    // 3. Apply the XOR cipher to reverse the encryption.
    const decipheredData = xorCipherBytes(data, KEY);
    // 4. Decode the UTF-8 bytes back to a Unicode string.
    const decoder = new TextDecoder();
    return decoder.decode(decipheredData);
  } catch (error) {
    console.error("Decryption failed, returning original text:", error);
    // If decryption fails (e.g., not valid Base64), return the original text.
    return encryptedText;
  }
};