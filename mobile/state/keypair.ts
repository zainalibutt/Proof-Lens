// mobile/state/keypair.ts
import * as Crypto from "expo-crypto";
import nacl from "tweetnacl";
import * as SecureStore from "expo-secure-store";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

const KEYPAIR_KEY = "prooflens_keypair_v1";

type StoredKeypair = {
  publicKeyB64: string;
  secretKeyB64: string;
};

export type KeypairB64 = {
  publicKeyB64: string;
  secretKey: Uint8Array;
};

export async function getOrCreateKeypairB64(): Promise<KeypairB64> {
  const existing = await SecureStore.getItemAsync(KEYPAIR_KEY);

  if (existing) {
    try {
      const parsed = JSON.parse(existing) as Partial<StoredKeypair> & {
        secretKey?: any;
      };

      if (parsed.publicKeyB64) {
        if (parsed.secretKeyB64) {
          const sk = decodeBase64(parsed.secretKeyB64);
          return {
            publicKeyB64: parsed.publicKeyB64,
            secretKey: sk,
          };
        }

        if (parsed.secretKey) {
          const arr = Array.isArray(parsed.secretKey)
            ? parsed.secretKey
            : Object.values(parsed.secretKey);
          const sk = new Uint8Array(arr as number[]);
          const upgraded: StoredKeypair = {
            publicKeyB64: parsed.publicKeyB64,
            secretKeyB64: encodeBase64(sk),
          };
          await SecureStore.setItemAsync(
            KEYPAIR_KEY,
            JSON.stringify(upgraded)
          );
          return {
            publicKeyB64: upgraded.publicKeyB64,
            secretKey: sk,
          };
        }
      }
    } catch {
    }
  }

  const rnd = await Crypto.getRandomBytesAsync(32);
  const seed = new Uint8Array(rnd);
  const kp = nacl.sign.keyPair.fromSeed(seed);

  const stored: StoredKeypair = {
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey),
  };

  await SecureStore.setItemAsync(KEYPAIR_KEY, JSON.stringify(stored));

  return {
    publicKeyB64: stored.publicKeyB64,
    secretKey: kp.secretKey,
  };
}

export async function deleteKeypair(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYPAIR_KEY);
}
