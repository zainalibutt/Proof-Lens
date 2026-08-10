import { useMemo } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  QrCode,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getExpoLink } from "../lib/mobileLink";

const isDev = import.meta.env.DEV;
const ANDROID_INSTALL_URL = String(import.meta.env.VITE_MOBILE_ANDROID_INSTALL_URL || "").trim();
const IOS_INSTALL_URL = String(import.meta.env.VITE_MOBILE_IOS_INSTALL_URL || "").trim();
const INSTALLED_APP_URL = String(
  import.meta.env.VITE_MOBILE_DEEP_LINK || import.meta.env.VITE_EXPO_PROD_DEEP_LINK || "prooflens://",
).trim();

type MobilePlatform = "ios" | "android" | "other";

type Props = {
  emailHint?: string | null;
};

export default function MobileConnectPanel({ emailHint }: Props) {
  const linkInfo = useMemo(() => getExpoLink(), []);
  const platform: MobilePlatform = useMemo(() => {
    if (typeof navigator === "undefined") return "other";
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    return "other";
  }, []);

  const platformLabel = platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "desktop";
  const preferredInstallUrl = platform === "ios"
    ? IOS_INSTALL_URL
    : platform === "android"
      ? ANDROID_INSTALL_URL
      : ANDROID_INSTALL_URL || IOS_INSTALL_URL;
  const preferredInstallLabel = platform === "ios"
    ? "Join the iOS preview"
    : platform === "android"
      ? "Download Android APK"
      : ANDROID_INSTALL_URL
        ? "Download Android APK"
        : "Join the iOS preview";

  function renderDevQR() {
    return (
      <div className="mobile-connect-panel__body">
        <div className="mobile-connect-panel__qr-wrap">
          {linkInfo.link ? (
            <>
              <div className="mobile-connect-panel__qr-box">
                <QRCodeSVG value={linkInfo.link} size={176} bgColor="transparent" fgColor="#d7dcff" includeMargin />
              </div>
              <div className="mobile-connect-panel__link mono">{linkInfo.link}</div>
              <p className="mobile-connect-panel__helper muted">
                <QrCode size={13} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Open Expo Go and scan the QR code.
              </p>
            </>
          ) : (
            <div className="mobile-connect-panel__fallback">
              <p className="muted">Set VITE_EXPO_DEV_HOST (LAN IP) to enable QR.</p>
              <p className="muted">Or set VITE_EXPO_DEV_URL / VITE_EXPO_TUNNEL_URL.</p>
            </div>
          )}
        </div>

        <aside className="demo-steps-panel" aria-label="Demo steps">
          <h4>Demo Steps</h4>
          <ol>
            <li><ArrowRight size={13} strokeWidth={2} /> Scan QR with your phone</li>
            <li><ArrowRight size={13} strokeWidth={2} /> Capture and sign media</li>
            <li><ArrowRight size={13} strokeWidth={2} /> Return here and press Refresh</li>
          </ol>
          <ul>
            {linkInfo.instructions.map((line) => (
              <li key={line}><CheckCircle2 size={13} strokeWidth={2} /> {line}</li>
            ))}
          </ul>
          {emailHint && (
            <p className="demo-steps-panel__hint muted">Mobile sign-in hint: {emailHint}</p>
          )}
          <p className="demo-steps-panel__hint muted">Make sure Expo Go is installed on the phone.</p>
        </aside>
      </div>
    );
  }

  function renderProductionInstructions() {
    const releaseAvailable = Boolean(preferredInstallUrl);

    return (
      <div className="mobile-connect-panel__body mobile-connect-panel__body--prod">
        <div className="mobile-connect-panel__prod-card">
          <div className="mobile-connect-panel__release-grid">
            <div className="mobile-connect-panel__release-copy">
              <span className="mobile-connect-panel__release-label">
                <ShieldCheck size={13} strokeWidth={2.2} /> Private preview
              </span>
              <h4>Install once. Capture in seconds.</h4>
              <p className="muted">
                ProofLens signs each capture on your device, uploads it securely and anchors the evidence automatically.
              </p>

              <div className="mobile-connect-panel__actions">
                {releaseAvailable ? (
                  <a
                    className="mobile-connect-panel__open-btn"
                    href={preferredInstallUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download size={16} strokeWidth={2} />
                    {preferredInstallLabel}
                    <ExternalLink size={14} strokeWidth={2} />
                  </a>
                ) : (
                  <span className="mobile-connect-panel__availability">Mobile preview is being prepared.</span>
                )}

                <a className="mobile-connect-panel__secondary-btn" href={INSTALLED_APP_URL}>
                  <Smartphone size={15} strokeWidth={2} /> Already installed? Open ProofLens
                </a>
              </div>

              <p className="mobile-connect-panel__hint muted">
                Detected: {platformLabel}{emailHint ? ` · Sign in as ${emailHint}` : ""}
              </p>
              {ANDROID_INSTALL_URL && platform !== "ios" && (
                <p className="mobile-connect-panel__build-meta muted">
                  Signed preview · v1.0.0 · 133 MB · Android 8 or newer
                </p>
              )}
            </div>

            {releaseAvailable && (
              <div className="mobile-connect-panel__qr-wrap mobile-connect-panel__install-qr">
                <div className="mobile-connect-panel__qr-box">
                  <QRCodeSVG value={preferredInstallUrl} size={176} bgColor="transparent" fgColor="#d7dcff" includeMargin />
                </div>
                <p className="mobile-connect-panel__helper muted">
                  <QrCode size={13} strokeWidth={2} /> Scan with your phone to install
                </p>
              </div>
            )}
          </div>

          <div className="mobile-connect-panel__steps">
            <h4>From install to verified evidence</h4>
            <ol>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Download the APK, then open it from Downloads</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Approve installation from your browser when Android asks</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Sign in with this account</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Capture — signing, upload and anchoring happen automatically</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Return to Evidence and refresh to inspect the result</li>
            </ol>
          </div>

          {ANDROID_INSTALL_URL && platform !== "ios" && (
            <details className="mobile-connect-panel__install-help" open={platform === "android"}>
              <summary>Samsung downloaded the APK but will not install it?</summary>
              <div className="mobile-connect-panel__install-help-body">
                <p>
                  New Samsung phones can block apps downloaded outside Google Play before the installer opens.
                  ProofLens is a signed research preview, so the phone owner must approve this one installation.
                </p>
                <ol>
                  <li>Open <strong>Settings → Security and privacy → Auto Blocker</strong> and turn it off temporarily.</li>
                  <li>
                    Open <strong>Settings → Security and privacy → More security settings → Install unknown apps</strong>.
                  </li>
                  <li>Choose the browser or <strong>My Files</strong>, then enable <strong>Allow from this source</strong>.</li>
                  <li>Open <strong>Downloads → ProofLens-Android-v1.0.0.apk</strong>, then tap Install and Open.</li>
                  <li>After installation, turn Auto Blocker back on and remove the temporary source permission.</li>
                </ol>
                <a
                  href="https://www.samsung.com/us/support/answer/ANS10003636/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Samsung's Auto Blocker guidance <ExternalLink size={12} strokeWidth={2} />
                </a>
              </div>
            </details>
          )}

          {platform === "ios" && !IOS_INSTALL_URL && ANDROID_INSTALL_URL && (
            <p className="mobile-connect-panel__platform-note">
              The Android preview is ready first. iPhone distribution needs the separate Apple/TestFlight signing checkpoint.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="mobile-connect-panel" aria-label="Continue on mobile">
      <div className="mobile-connect-panel__header">
        <div className="mobile-connect-panel__title-wrap">
          <div className="mobile-connect-panel__icon-ring">
            <Smartphone size={18} strokeWidth={2} />
          </div>
          <div>
            <h3>Continue on Mobile</h3>
            <p className="muted">Capture and sign evidence using your mobile device.</p>
          </div>
        </div>
        {isDev && <span className="mobile-connect-panel__mode">{linkInfo.mode.toUpperCase()}</span>}
      </div>

      {isDev ? renderDevQR() : renderProductionInstructions()}
    </section>
  );
}
