import React, { Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import {
  verifyShare,
  verifyAudioShare,
  fetchShareByToken,
  downloadEvidenceBundleZipFromShare,
  downloadAudioEvidenceBundleZipFromShare,
} from "./lib/api";
import { supabase } from "./lib/supabase";

import HeroHeader from "./components/HeroHeader";
import SectionCard from "./components/SectionCard";
import NavBar from "./components/NavBar";
import StatusBadge from "./components/StatusBadge";
import TutorialOverlay from "./components/TutorialOverlay";
import { webTutorialSteps } from "./lib/tutorialSteps";
import logoImage from "./logo.png";

import DashboardPage from "./pages/DashboardPage";
import CapturePage from "./pages/CapturePage";
import VerifyPage from "./pages/VerifyPage";
import EvidencePage from "./pages/EvidencePage";

import {
  Shield,
  ExternalLink,
  LogOut,
  Lock,
  Mail,
  KeyRound,
  Image as ImageIcon,
  Music,
  Hash,
  Anchor,
  FileKey,
} from "lucide-react";

/* Lazy-loaded components */
const VerificationDropZone = React.lazy(() => import("./components/VerificationDropZone"));
const EvidencePanel = React.lazy(() => import("./components/EvidencePanel"));

function LazyFallback() {
  return <div style={{ display: "flex", justifyContent: "center", padding: 24 }}><div className="spinner" /></div>;
}

/* Public audio share verification page */
function AudioSharePage() {
  const [audioUploadFile, setAudioUploadFile] = useState<File | null>(null);
  const [audioVerifyBusy, setAudioVerifyBusy] = useState(false);
  const [audioVerifyError, setAudioVerifyError] = useState<string | null>(null);
  const [audioShareResult, setAudioShareResult] = useState<any>(null);
  const [audioBundleBusy, setAudioBundleBusy] = useState(false);
  const [audioBundleError, setAudioBundleError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const audioShareToken = params.get("token") || params.get("share") || null;
  const audioShareId = params.get("audio") || null;

  const onVerifyAudioShare = async () => {
    setAudioVerifyError(null); setAudioShareResult(null); setAudioBundleError(null);
    if (!audioUploadFile) { setAudioVerifyError("Select an audio file first."); return; }
    if (!audioShareToken || !audioShareId) { setAudioVerifyError("Invalid or expired share link."); return; }
    try {
      setAudioVerifyBusy(true);
      setAudioShareResult(await verifyAudioShare(audioUploadFile, audioShareToken, audioShareId));
    } catch (e: any) { setAudioVerifyError(e?.message || "Share verification failed"); } finally { setAudioVerifyBusy(false); }
  };

  const mediaUrl = audioShareResult?.mediaUrl ?? null;

  return (
    <Suspense fallback={<LazyFallback />}>
      <div className="page">
        <HeroHeader subtitle="Audio Share Verification" />
        <SectionCard glow>
          <div className="share-portal">
            <div className="share-portal__header">
              <div className="share-portal__icon-ring"><Music size={24} strokeWidth={1.5} /></div>
              <h2>Verify Shared Audio</h2>
              <p className="muted">Upload the original audio file to verify against its cryptographic proof.</p>
            </div>
            {!audioShareToken || !audioShareId ? (
              <div className="alert error">
                <Shield size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                Invalid or expired share link.
              </div>
            ) : (
              <div className="stack">
                <div className="share-portal__token-row">
                  <StatusBadge status="pending" label="Share Token" />
                  <span className="mono small" style={{ background: "none", border: "none", padding: 0 }}>
                    {audioShareToken.slice(0, 16)}&hellip;
                  </span>
                </div>
                <VerificationDropZone accept="audio/*" file={audioUploadFile} onFile={setAudioUploadFile} label="Drag & drop the audio file to verify" busy={audioVerifyBusy} />
                <div className="row">
                  <button onClick={onVerifyAudioShare} disabled={audioVerifyBusy}>
                    <Shield size={14} strokeWidth={2} />
                    {audioVerifyBusy ? "Verifying\u2026" : "Verify Audio"}
                  </button>
                </div>
                {audioVerifyError && <div className="alert error">{audioVerifyError}</div>}
                {audioShareResult && (
                  <EvidencePanel
                    result={audioShareResult}
                    isShare
                    bundleToken={audioShareResult.bundleToken}
                    onDownloadBundle={audioShareResult.verified && audioShareResult.bundleToken ? async () => {
                      try {
                        setAudioBundleError(null); setAudioBundleBusy(true);
                        await downloadAudioEvidenceBundleZipFromShare(audioShareId!, audioShareResult.bundleToken);
                      } catch (e: any) { setAudioBundleError(e?.message || "Download failed"); } finally { setAudioBundleBusy(false); }
                    } : undefined}
                    bundleBusy={audioBundleBusy}
                    bundleError={audioBundleError}
                  />
                )}
                {audioShareResult?.verified && mediaUrl && (
                  <div className="audio-preview fade-in">
                    <audio controls src={mediaUrl} style={{ width: "100%", borderRadius: 12 }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>
        <footer className="footer">
          <img src={logoImage} alt="ProofLens" className="footer-logo" />
          <span className="muted footer-text">
            <Lock size={11} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
            Secure cryptographic verification
          </span>
        </footer>
      </div>
    </Suspense>
  );
}

/* Public image share verification page */
function ImageSharePage() {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  const shareToken = params.get("token") || params.get("share") || (path.startsWith("/verify/s/") ? path.split("/verify/s/")[1]?.split("/")[0] : null) || null;
  const [shareCaptureId, setShareCaptureId] = useState<string | null>(params.get("capture") || null);

  useEffect(() => {
    if (!shareToken || shareCaptureId) return;
    (async () => {
      try {
        const res = await fetchShareByToken(shareToken);
        const id = res.captureId || res.credential?.id || null;
        if (id) setShareCaptureId(id);
      } catch { /* ignore */ }
    })();
  }, [shareToken, shareCaptureId]);

  const onVerify = async () => {
    setVerifyError(null); setVerifyResult(null); setBundleError(null);
    if (!uploadFile) { setVerifyError("Select a file first."); return; }
    if (!shareToken || !shareCaptureId) { setVerifyError("Invalid or expired share link."); return; }
    try {
      setVerifyBusy(true);
      setVerifyResult(await verifyShare(uploadFile, shareToken, shareCaptureId));
    } catch (e: any) { setVerifyError(e?.message || "Verify failed"); } finally { setVerifyBusy(false); }
  };

  return (
    <Suspense fallback={<LazyFallback />}>
      <div className="page">
        <HeroHeader subtitle="Share Verification Portal" />
        <SectionCard glow>
          <div className="share-portal">
            <div className="share-portal__header">
              <div className="share-portal__icon-ring"><Shield size={24} strokeWidth={1.5} /></div>
              <h2>Verify Shared Capture</h2>
              <p className="muted">Upload the original photo to verify against its cryptographic proof.</p>
            </div>
            {!shareToken || !shareCaptureId ? (
              <div className="alert error">
                <Shield size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                Invalid or expired verification link.
              </div>
            ) : (
              <div className="stack">
                <div className="share-portal__token-row">
                  <StatusBadge status="pending" label="Share Token" />
                  <span className="mono small" style={{ background: "none", border: "none", padding: 0 }}>
                    {shareToken.slice(0, 16)}&hellip;
                  </span>
                </div>
                <VerificationDropZone accept="image/*" file={uploadFile} onFile={setUploadFile} label="Drag & drop the photo to verify, or click to browse" busy={verifyBusy} />
                <div className="row">
                  <button onClick={onVerify} disabled={verifyBusy}>
                    <Shield size={14} strokeWidth={2} />
                    {verifyBusy ? "Verifying\u2026" : "Verify Capture"}
                  </button>
                </div>
                {verifyError && <div className="alert error">{verifyError}</div>}
                {verifyResult && (
                  <EvidencePanel
                    result={verifyResult}
                    isShare
                    bundleToken={verifyResult.bundleToken}
                    onDownloadBundle={verifyResult.verified && verifyResult.bundleToken ? async () => {
                      try {
                        setBundleError(null); setBundleBusy(true);
                        await downloadEvidenceBundleZipFromShare(shareCaptureId!, verifyResult.bundleToken);
                      } catch (e: any) { setBundleError(e?.message || "Download failed"); } finally { setBundleBusy(false); }
                    } : undefined}
                    bundleBusy={bundleBusy}
                    bundleError={bundleError}
                  />
                )}
              </div>
            )}
          </div>
        </SectionCard>
        <footer className="footer">
          <img src={logoImage} alt="ProofLens" className="footer-logo" />
          <span className="muted footer-text">
            <Lock size={11} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
            Secure cryptographic verification
          </span>
        </footer>
      </div>
    </Suspense>
  );
}

/* Auth page */
function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [credsError, setCredsError] = useState<string | null>(null);

  const systemOverview = (
    <div className="system-overview fade-in">
      <h2 className="system-overview__title">Cryptographic Media Verification System</h2>
      <p className="system-overview__desc">
        ProofLens hashes and signs captured media, then requests RFC 3161 timestamp anchoring &mdash; creating tamper-evident records that can be checked in the app or from an offline evidence bundle.
      </p>
      <div className="system-overview__features">
        <div className="system-overview__feature"><Shield size={16} strokeWidth={2} /> Tamper-evident records</div>
        <div className="system-overview__feature"><Lock size={16} strokeWidth={2} /> Cryptographic integrity (hash + signature)</div>
        <div className="system-overview__feature"><Anchor size={16} strokeWidth={2} /> RFC 3161 timestamp anchoring</div>
        <div className="system-overview__feature"><ExternalLink size={16} strokeWidth={2} /> Verifiable anywhere</div>
      </div>
      <div className="pipeline-flow">
        {[
          { Icon: ImageIcon, label: "Capture" },
          { Icon: Hash, label: "Hash" },
          { Icon: FileKey, label: "Sign" },
          { Icon: Anchor, label: "Anchor" },
          { Icon: Shield, label: "Verify" },
        ].map(({ Icon, label }, i, arr) => (
          <React.Fragment key={label}>
            <div className="pipeline-step">
              <div className="pipeline-step__icon"><Icon size={20} strokeWidth={1.5} /></div>
              <span className="pipeline-step__label">{label}</span>
            </div>
            {i < arr.length - 1 && <div className="pipeline-connector" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );

  const onSignIn = async () => {
    setCredsError(null); setAuthInfo(null);
    if (!supabase) { setCredsError("Supabase env is missing."); return; }
    if (!email || !password) { setCredsError("Enter both email and password."); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setCredsError(error.message);
  };

  const onSignUp = async () => {
    setCredsError(null); setAuthInfo(null);
    if (!supabase) { setCredsError("Supabase env is missing."); return; }
    if (!email || !password) { setCredsError("Enter both email and password."); return; }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { setCredsError(error.message); return; }
    setAuthInfo("Account created. Check your email to confirm, then sign in.");
    setAuthMode("signin");
  };

  const onResetPassword = async () => {
    setCredsError(null); setAuthInfo(null);
    if (!supabase) { setCredsError("Supabase env is missing."); return; }
    if (!email) { setCredsError("Enter your email first."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) { setCredsError(error.message); return; }
    setAuthInfo("Password reset email sent. Check your inbox.");
  };

  const onMagicLink = async () => {
    setCredsError(null); setAuthInfo(null);
    if (!supabase) { setCredsError("Supabase env is missing."); return; }
    if (!email) { setCredsError("Enter your email first."); return; }
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    if (error) { setCredsError(error.message); return; }
    setAuthInfo("Magic link sent. Check your inbox to sign in.");
  };

  return (
    <div className="page">
      <HeroHeader subtitle="Cryptographic Media Verification System" />
      {systemOverview}
      <SectionCard glow>
        <div className="auth-form auth-form--wide">
          <div className="auth-form__header auth-form__header--center">
            <div className="auth-form__icon-ring"><Lock size={24} strokeWidth={1.5} /></div>
            <h2>{authMode === "signin" ? "Sign In" : "Create Account"}</h2>
            <p className="muted">Access your verified captures and manage evidence.</p>
          </div>
          {!supabase && (
            <div className="alert error">
              <Shield size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
              Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            </div>
          )}
          <div className="auth-form__field">
            <label className="auth-form__label auth-form__label--mobile" htmlFor="email">
              <Mail size={12} strokeWidth={2} /> Email
            </label>
            <input id="email" className="input" placeholder="you@example.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="auth-form__field">
            <label className="auth-form__label auth-form__label--mobile" htmlFor="password">
              <KeyRound size={12} strokeWidth={2} /> Password
            </label>
            <input id="password" className="input" placeholder={authMode === "signin" ? "Your password" : "Create a password"} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === "signin" ? "current-password" : "new-password"} onKeyDown={(e) => e.key === "Enter" && (authMode === "signin" ? onSignIn() : onSignUp())} />
          </div>
          <button className={authMode === "signin" ? "auth-form__primary" : "auth-form__primary auth-form__primary--signup"} onClick={authMode === "signin" ? onSignIn : onSignUp}>
            <Lock size={14} strokeWidth={2} />
            {authMode === "signin" ? "Sign in" : "Create account"}
          </button>
          {authMode === "signin" && (
            <>
              <button className="auth-form__link" onClick={onResetPassword} type="button">Forgot password?</button>
              <button className="auth-form__link auth-form__link--icon" onClick={onMagicLink} type="button">
                <Mail size={13} strokeWidth={2} /> Or send me a magic link
              </button>
            </>
          )}
          {authMode === "signin" ? (
            <div className="auth-form__switch-row">
              <span>New here?</span>
              <button className="auth-form__inline-link" onClick={() => { setAuthMode("signup"); setCredsError(null); setAuthInfo(null); }} type="button">Create an account</button>
            </div>
          ) : (
            <div className="auth-form__switch-row">
              <span>Already have an account?</span>
              <button className="auth-form__inline-link" onClick={() => { setAuthMode("signin"); setCredsError(null); setAuthInfo(null); }} type="button">Sign in instead</button>
            </div>
          )}
          {authInfo && <div className="alert success">{authInfo}</div>}
          {credsError && <div className="alert error">{credsError}</div>}
        </div>
      </SectionCard>
    </div>
  );
}

/* Authenticated shell layout */
function AuthenticatedShell({ session, onSignOut }: { session: any; onSignOut: () => void }) {
  const [showTutorial, setShowTutorial] = useState(false);

  return (
    <div className="page">
      <HeroHeader
        rightContent={
          <div className="session-actions">
            <button className="secondary session-actions__guide" onClick={() => setShowTutorial(true)}>Guide</button>
            <span className="muted session-actions__identity">
              <Mail size={12} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
              {session.user.email}
            </span>
            <button className="secondary session-actions__sign-out" onClick={onSignOut} aria-label="Sign out">
              <LogOut size={14} strokeWidth={2} /> Sign out
            </button>
          </div>
        }
      />

      <NavBar />

      <div style={{ flex: 1 }}>
        <Outlet />
      </div>

      <footer className="footer">
        <img src={logoImage} alt="ProofLens" className="footer-logo" />
        <span className="muted footer-text">
          <Lock size={11} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
          Secure cryptographic verification
        </span>
      </footer>

      <TutorialOverlay visible={showTutorial} steps={webTutorialSteps} onClose={() => setShowTutorial(false)} />
    </div>
  );
}

/* App router */
export default function App() {
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  if (!ready) return <LazyFallback />;

  const hasSession = !!session?.access_token;
  const accessToken = session?.access_token ?? "";
  const emailHint = session?.user?.email ?? null;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public share routes */}
        <Route path="/audio-share" element={<AudioSharePage />} />
        <Route path="/share" element={<ImageSharePage />} />
        <Route path="/verify/s/*" element={<ImageSharePage />} />

        {/* Authenticated routes */}
        {hasSession ? (
          <Route element={<AuthenticatedShell session={session} onSignOut={onSignOut} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/capture" element={<CapturePage emailHint={emailHint} />} />
            <Route path="/verify" element={<VerifyPage accessToken={accessToken} />} />
            <Route path="/evidence" element={<EvidencePage accessToken={accessToken} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        ) : (
          <>
            <Route path="*" element={<AuthPage />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
