const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Bitcoin-style base58, which is how Solana spells a public key. Written out
 * rather than pulled in: it is twenty lines, and a dependency that decodes
 * addresses is a dependency that can start decoding them differently.
 */
export function decodeBase58(text: string): Uint8Array {
  if (text.length === 0) {
    throw new Error("Empty base58 string");
  }

  // Starts empty, not [0]. A seeded zero is an extra byte that survives the
  // whole conversion, and leading zeroes are added back explicitly below.
  const bytes: number[] = [];
  for (const character of text) {
    const value = ALPHABET.indexOf(character);
    if (value === -1) {
      throw new Error(`Not base58: ${character}`);
    }

    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += (bytes[i] as number) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Each leading '1' is a leading zero byte, which the arithmetic above drops.
  for (const character of text) {
    if (character !== ALPHABET[0]) {
      break;
    }
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  // Same reason as the decoder: a seeded digit becomes a spurious '1'.
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += (digits[i] as number) << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let leading = "";
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    leading += ALPHABET[0];
  }

  return leading + digits.reverse().map((d) => ALPHABET[d]).join("");
}
