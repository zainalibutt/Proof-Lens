import { sha256 as sha256Fn } from "js-sha256";
import * as nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";

export function sha256Hex(bytes: Uint8Array): string {
  return sha256Fn(bytes);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function signSha256(sha256HexStr: string, secretKey: Uint8Array): string {
  const hashBytes = hexToBytes(sha256HexStr);
  const sig = nacl.sign.detached(hashBytes, secretKey);
  return encodeBase64(sig);
}
