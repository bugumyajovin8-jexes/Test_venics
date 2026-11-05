import CryptoJS from 'crypto-js';

// In a real app, this key should be derived from a user's session or a secure storage
// For this implementation, we use a consistent key that could be improved by being session-based
const ENCRYPTION_KEY = 'pos-app-secure-key-v1';
const HMAC_KEY = 'pos-app-hmac-key-v1';

export const encrypt = (text: string | number): string => {
  return CryptoJS.AES.encrypt(text.toString(), ENCRYPTION_KEY).toString();
};

export const decrypt = (ciphertext: string): string => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

export const generateHMAC = (data: string): string => {
  return CryptoJS.HmacSHA256(data, HMAC_KEY).toString();
};

export const verifyHMAC = (data: string, signature: string): boolean => {
  const expectedSignature = generateHMAC(data);
  return expectedSignature === signature;
};
