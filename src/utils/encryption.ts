import CryptoJS from 'crypto-js';

// HMAC is used for local license tamper-detection (see services/license.ts).
// NOTE: field-level AES encryption was removed — it was never applied on write,
// so sensitive fields were always stored as plain numbers.
const HMAC_KEY = 'pos-app-hmac-key-v1';

export const generateHMAC = (data: string): string => {
  return CryptoJS.HmacSHA256(data, HMAC_KEY).toString();
};

export const verifyHMAC = (data: string, signature: string): boolean => {
  const expectedSignature = generateHMAC(data);
  return expectedSignature === signature;
};
