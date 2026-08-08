import { useMemo } from "react";
import { QrCode, Smartphone, ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getExpoLink } from "../lib/mobileLink";

const isDev = import.meta.env.DEV;
const EXPO_GO_URL = "https://expo.dev/go";
const EXPO_GO_IOS_URL = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID_URL = "https://play.google.com/store/apps/details?id=host.exp.exponent";

type MobilePlatform = "ios" | "android" | "other";

type Props = {
  emailHint?: string | null;
};

export default function MobileConnectPanel({ emailHint }: Props) {
  const linkInfo = useMemo(() => getExpoLink(), []);
  const productionDeepLink = !isDev ? linkInfo.link : null;
  const platform: MobilePlatform = useMemo(() => {
    if (typeof navigator === "undefined") return "other";
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    if (/android/.test(ua)) return "android";
    return "other";
  }, []);

  const platformStoreUrl = useMemo(() => {
    if (platform === "ios") return EXPO_GO_IOS_URL;
    if (platform === "android") return EXPO_GO_ANDROID_URL;
    return EXPO_GO_URL;
  }, [platform]);

  const platformLabel = platform === "ios" ? "iOS" : platform === "android" ? "Android" : "Desktop";

  function openOnMobile() {
    if (productionDeepLink) {
      window.location.href = productionDeepLink;
      return;
    }

    window.location.href = platformStoreUrl;
  }

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
    return (
      <div className="mobile-connect-panel__body mobile-connect-panel__body--prod">
        <div className="mobile-connect-panel__prod-card">
          {productionDeepLink && (
            <div className="mobile-connect-panel__qr-wrap" style={{ marginBottom: 16 }}>
              <div className="mobile-connect-panel__qr-box">
                <QRCodeSVG value={productionDeepLink} size={176} bgColor="transparent" fgColor="#d7dcff" includeMargin />
              </div>
              <div className="mobile-connect-panel__link mono">{productionDeepLink}</div>
              <p className="mobile-connect-panel__helper muted">
                <QrCode size={13} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Scan this QR with your phone to open in Expo Go.
              </p>
            </div>
          )}

          <button
            className="mobile-connect-panel__open-btn"
            onClick={openOnMobile}
          >
            <Smartphone size={16} strokeWidth={2} />
            {productionDeepLink ? "Open on Mobile" : `Get Expo Go for ${platformLabel}`}
            <ExternalLink size={14} strokeWidth={2} />
          </button>

          <p className="mobile-connect-panel__hint muted">Detected device: {platformLabel}</p>

          <div className="mobile-connect-panel__steps">
            <h4>Getting Started</h4>
            <ol>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Install Expo Go on your phone</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Run the mobile app locally (for demo)</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Sign in with the same account</li>
              <li><CheckCircle2 size={13} strokeWidth={2} /> Capture media and return here</li>
            </ol>
          </div>

          {emailHint && (
            <p className="mobile-connect-panel__hint muted">Sign in as: {emailHint}</p>
          )}

          <div className="mobile-connect-panel__deep-link">
            {productionDeepLink ? (
              <>
                <p className="muted">Already installed? Open directly:</p>
                <a href={productionDeepLink} className="mobile-connect-panel__deep-link-url mono">
                  {productionDeepLink}
                </a>
              </>
            ) : (
              <>
                <p className="muted">Already installed? Set VITE_EXPO_PROD_DEEP_LINK for one-tap opening.</p>
                <div className="mobile-connect-panel__store-links">
                  <a href={EXPO_GO_IOS_URL} className="mobile-connect-panel__deep-link-url" target="_blank" rel="noreferrer">
                    iOS App Store
                  </a>
                  <a href={EXPO_GO_ANDROID_URL} className="mobile-connect-panel__deep-link-url" target="_blank" rel="noreferrer">
                    Android Play Store
                  </a>
                </div>
              </>
            )}
          </div>
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
