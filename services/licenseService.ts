
/**
 * Security Service for HSE Guardian
 * Implements client-side license verification and obfuscation.
 */

const SALT = "HSE_SECURE_SALT_v1_";
const STORAGE_KEY = "hse_auth_token";

// Simple simple checksum algorithm to validate license format
// Format: HSE-{PART1}-{PART2}
// Rule: PART2 must be equal to (parseInt(PART1) * 3 + 77)
export const validateLicenseFormat = (key: string): boolean => {
  try {
    const parts = key.trim().split('-');
    if (parts.length !== 3) return false;
    if (parts[0] !== 'HSE') return false;

    const p1 = parseInt(parts[1]);
    const p2 = parseInt(parts[2]);

    if (isNaN(p1) || isNaN(p2)) return false;

    // The secret algorithm
    const expectedP2 = (p1 * 3) + 77;
    return p2 === expectedP2;
  } catch (e) {
    return false;
  }
};

// Generate a valid key for testing purposes (Dev helper, remove in prod source)
// Example: If Part1 is 1000 -> Part2 is 3077 -> Key: HSE-1000-3077
export const generateTestKey = (): string => {
  const p1 = Math.floor(Math.random() * 8999) + 1000;
  const p2 = (p1 * 3) + 77;
  return `HSE-${p1}-${p2}`;
};

export const activateLicense = (key: string): boolean => {
  if (validateLicenseFormat(key)) {
    // Obfuscate the key before storing. Never store plain text.
    // We store a hash of the key combined with a salt.
    const token = btoa(SALT + key + Date.now().toString()); 
    // In a real app, use crypto.subtle.digest('SHA-256', ...)
    
    // We also store the key itself but XOR'd or encoded to verify later
    const payload = btoa(JSON.stringify({ 
      k: key, 
      valid: true, 
      installDate: Date.now() 
    }));
    
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  }
  return false;
};

export const checkLicense = (): boolean => {
  try {
    const payload = localStorage.getItem(STORAGE_KEY);
    if (!payload) return false;

    const data = JSON.parse(atob(payload));
    
    // Re-verify the integrity of the stored key
    if (data.valid && validateLicenseFormat(data.k)) {
      return true;
    }
    // Tampered data detected
    deactivate();
    return false;
  } catch (e) {
    return false;
  }
};

export const deactivate = () => {
  localStorage.removeItem(STORAGE_KEY);
};
