// prooflens-api/src/types.ts

declare global {
  namespace Express {
    interface Request {
      /** Verified Supabase subject, populated by attachAuthUser. */
      authUserId?: string;
      /** Distinguishes "checked and anonymous" from "not checked yet". */
      authChecked?: boolean;
      user?: {
        id?: string;
        [key: string]: unknown;
      };
    }
  }
}

export type CredentialPayload = {
  credential?: {
    sha256: string;
    capture_device_id?: string | null;
    public_key: string; // base64
    timestamp?: string | number | null;
    gps?: unknown;
    exif?: unknown;
  };
  signatureB64?: string;
  media_key?: string;
};

export type DeviceRegisterBody = {
  publicKeyB64?: string;
  signatureB64?: string;
  signedAt?: string;
};

export type AudioRecordPayload = {
  credential?: {
    type?: string;
    sha256: string;
    capture_device_id?: string | null;
    public_key: string;
    timestamp?: string | number | null;
    gps?: unknown;
    duration_ms?: number | null;
    title?: string | null;
    audio_id?: string | null;
  };
  signatureB64?: string;
  media_key?: string;
  title?: string;
  duration_ms?: number | null;
  sha256?: string;
};
