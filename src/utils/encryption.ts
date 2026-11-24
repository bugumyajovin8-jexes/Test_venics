// Only the parts used, not all of crypto-js: it is read at start-up.
import HmacSHA256 from 'crypto-js/hmac-sha256';
import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';

// In a real app, this key should be derived from a user's session or a secure storage
// For this implementation, we use a consistent key that could be improved by being session-based
const ENCRYPTION_KEY = 'pos-app-secure-key-v1';
const HMAC_KEY = 'pos-app-hmac-key-v1';

export const encrypt = (text: string | number): string => {
  return AES.encrypt(text.toString(), ENCRYPTION_KEY).toString();
};

export const decrypt = (ciphertext: string): string => {
  const bytes = AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(Utf8);
};

export const generateHMAC = (data: string): string => {
  return HmacSHA256(data, HMAC_KEY).toString();
};

export const verifyHMAC = (data: string, signature: string): boolean => {
  const expectedSignature = generateHMAC(data);
  return expectedSignature === signature;
};
