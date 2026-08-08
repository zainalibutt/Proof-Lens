import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCredentials,
  fetchBursts,
  fetchBurstWithFrames,
  fetchAudioRecords,
  mediaUrlForKey,
  tsrUrlForKey,
  createShare,
  downloadEvidenceBundleZip,
  createAudioShare,
  downloadAudioEvidenceBundleZip,
} from "../lib/api";
import SectionCard from "../components/SectionCard";
import CaptureCard from "../components/CaptureCard";
import StatusBadge from "../components/StatusBadge";
import EmptyState from "../components/EmptyState";
import {
  RefreshCw,
  Share2,
  Download,
  ExternalLink,
  FileText,
  Copy,
  ChevronDown,
  Layers,
  Image as ImageIcon,
  Music,
  Clock,
  Smartphone,
  Hash,
  Anchor,
  Shield,
  Code2,
  FileKey,
} from "lucide-react";

const EvidencePanel = React.lazy(() => import("../components/EvidencePanel"));
const BurstFrameStrip = React.lazy(() => import("../components/BurstFrameStrip"));

function LazyFallback() {
  return <div style={{ display:"flex", justifyContent:"center", padding:24 }}><div className="spinner" /></div>;
}

/* Types */
type CredentialRow = Record<string, any> & {
  id?: string; sha256?: string; media_key?: string | null;
  timestamp?: string | null; status?: string;
};

type AudioRecord = Record<string, any> & {
  id?: string; title?: string; duration?: number; sha256?: string;
  signature?: string; device_id?: string; s3_key?: string | null;
  tsa_status?: string | null; anchor_timestamp?: string | null;
  created_at?: string | null;
};

type Burst = {
  id: string; user_id: string; capture_device_id: string;
  mode: number; trigger: string; frame_total: number;
  frame_count: number; status: string;
  cover_credential_id: string | null;
  created_at: string; updated_at: string;
};

type BurstWithFrames = {
  burst: Burst;
  frames: { anchored: CredentialRow[]; pending: any[] };
};

interface Props {
  accessToken: string;
}

export default function EvidencePage({ accessToken }: Props) {
  /* State */
  const [creds, setCreds] = useState<CredentialRow[]>([]);
  const [credsBusy, setCredsBusy] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [selectedCredId, setSelectedCredId] = useState<string | null>(null);

  const [audioRecords, setAudioRecords] = useState<AudioRecord[]>([]);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);

  const [bursts, setBursts] = useState<Burst[]>([]);
  const [burstsBusy, setBurstsBusy] = useState(false);
  const [burstsError, setBurstsError] = useState<string | null>(null);
  const [expandedBurst, setExpandedBurst] = useState<BurstWithFrames | null>(null);
  const [expandBusy, setExpandBusy] = useState(false);

  const [viewMode, setViewMode] = useState<"bursts" | "captures" | "audio">("bursts");

  // Capture share and bundle state
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  // Audio share and bundle state
  const [audioShareUrl, setAudioShareUrl] = useState<string | null>(null);
  const [audioShareExpiresAt, setAudioShareExpiresAt] = useState<string | null>(null);
  const [audioShareBusy, setAudioShareBusy] = useState(false);
  const [audioShareError, setAudioShareError] = useState<string | null>(null);
  const [audioBundleBusy, setAudioBundleBusy] = useState(false);
  const [audioBundleError, setAudioBundleError] = useState<string | null>(null);

  const captureDetailRef = useRef<HTMLDivElement | null>(null);
  const captureShareResultRef = useRef<HTMLDivElement | null>(null);
  const audioDetailRef = useRef<HTMLDivElement | null>(null);
  const audioShareResultRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToCaptureDetailRef = useRef(false);
  const shouldScrollToAudioDetailRef = useRef(false);

  /* Loaders */
  const loadCreds = useCallback(async () => {
    setCredsError(null); setCredsBusy(true);
    try {
      const list = (await fetchCredentials(accessToken)) as CredentialRow[];
      setCreds(list);
      if (list.length) setSelectedCredId((p) => p ?? list[0]?.id ?? null); else setSelectedCredId(null);
    } catch (e: any) { setCredsError(e?.message || "Failed to load credentials"); } finally { setCredsBusy(false); }
  }, [accessToken]);

  const loadBursts = useCallback(async () => {
    setBurstsError(null); setBurstsBusy(true);
    try {
      const items = await fetchBursts(accessToken);
      const anchored = items.filter((b: any) => b.status === "anchored");
      setBursts(anchored);
      if (anchored.length) setSelectedCredId(null); else setSelectedCredId(null);
    } catch (e: any) { setBurstsError(e?.message || "Failed to load bursts"); } finally { setBurstsBusy(false); }
  }, [accessToken]);

  const loadAudio = useCallback(async () => {
    setAudioError(null); setAudioBusy(true);
    try {
      const items = await fetchAudioRecords(accessToken);
      setAudioRecords(items as AudioRecord[]);
      if (items.length) setSelectedAudioId((p) => p ?? (items[0].id ?? null)); else setSelectedAudioId(null);
    } catch (e: any) { setAudioError(e?.message || "Failed to load audio records"); } finally { setAudioBusy(false); }
  }, [accessToken]);

  useEffect(() => { loadCreds(); loadBursts(); loadAudio(); }, [loadCreds, loadBursts, loadAudio]);

  /* Handlers */
  const onExpandBurst = async (burstId: string) => {
    setExpandBusy(true);
    try {
      const data = await fetchBurstWithFrames(accessToken, burstId);
      if (data) setExpandedBurst(data);
    } catch (e: any) { setBurstsError(e?.message || "Failed to load burst frames"); } finally { setExpandBusy(false); }
  };

  const selectedCred = creds.find((c) => c.id === selectedCredId) ?? null;
  const selectedMediaUrl = selectedCred?.media_url ?? (selectedCred ? mediaUrlForKey(selectedCred.media_key ?? null) : null);
  const selectedTsrUrl = selectedCred?.tsr_url ?? (selectedCred ? tsrUrlForKey(selectedCred.media_key ?? null) : null);
  const selectedSha = selectedCred?.sha256 ?? "";
  const selectedId = selectedCred?.id ?? "";

  const selectedAudio = audioRecords.find((a) => a.id === selectedAudioId) ?? null;
  const selectedAudioUrl = selectedAudio?.media_url ?? null;

  const onCreateShare = async () => {
    setShareError(null); setShareUrl(null); setShareExpiresAt(null);
    if (!selectedCred?.id) { setShareError("Select a capture first."); return; }
    try {
      setShareBusy(true);
      const res = await createShare(accessToken, selectedCred.id);
      setShareUrl(res.shareUrl); setShareExpiresAt(res.expiresAt ?? null);
    } catch (e: any) { setShareError(e?.message || "Share create failed"); } finally { setShareBusy(false); }
  };

  const onCopyShare = async () => { if (shareUrl) try { await navigator.clipboard.writeText(shareUrl); } catch {} };

  const onDownloadBundle = async () => {
    setBundleError(null);
    if (!selectedCred?.id) { setBundleError("Select a capture first."); return; }
    try { setBundleBusy(true); await downloadEvidenceBundleZip(accessToken, selectedCred.id); }
    catch (e: any) { setBundleError(e?.message || "Evidence bundle download failed"); }
    finally { setBundleBusy(false); }
  };

  const onCreateAudioShare = async () => {
    setAudioShareError(null); setAudioShareUrl(null); setAudioShareExpiresAt(null);
    if (!selectedAudio?.id) { setAudioShareError("Select an audio record first."); return; }
    try {
      setAudioShareBusy(true);
      const res = await createAudioShare(accessToken, selectedAudio.id);
      setAudioShareUrl(res.shareUrl); setAudioShareExpiresAt(res.expiresAt ?? null);
    } catch (e: any) { setAudioShareError(e?.message || "Audio share create failed"); } finally { setAudioShareBusy(false); }
  };

  const onCopyAudioShare = async () => { if (audioShareUrl) try { await navigator.clipboard.writeText(audioShareUrl); } catch {} };

  const onDownloadAudioBundle = async () => {
    setAudioBundleError(null);
    if (!selectedAudio?.id) { setAudioBundleError("Select an audio record first."); return; }
    try { setAudioBundleBusy(true); await downloadAudioEvidenceBundleZip(accessToken, selectedAudio.id); }
    catch (e: any) { setAudioBundleError(e?.message || "Audio evidence bundle download failed"); }
    finally { setAudioBundleBusy(false); }
  };

  /* Scroll effects */
  useEffect(() => {
    if (!shouldScrollToCaptureDetailRef.current || viewMode !== "captures" || !selectedCredId) return;
    shouldScrollToCaptureDetailRef.current = false;
    const timer = window.setTimeout(() => { captureDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    return () => window.clearTimeout(timer);
  }, [viewMode, selectedCredId]);

  useEffect(() => {
    if (!shareUrl) return;
    const timer = window.setTimeout(() => { captureShareResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    return () => window.clearTimeout(timer);
  }, [shareUrl]);

  useEffect(() => {
    if (!shouldScrollToAudioDetailRef.current || viewMode !== "audio" || !selectedAudioId) return;
    shouldScrollToAudioDetailRef.current = false;
    const timer = window.setTimeout(() => { audioDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    return () => window.clearTimeout(timer);
  }, [viewMode, selectedAudioId]);

  useEffect(() => {
    if (!audioShareUrl) return;
    const timer = window.setTimeout(() => { audioShareResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    return () => window.clearTimeout(timer);
  }, [audioShareUrl]);

  /* Grouping helpers */
  const audioGroups = useMemo((): Array<{ day: string; items: AudioRecord[] }> => {
    const groups = new Map<string, AudioRecord[]>();
    audioRecords.forEach((a) => {
      const day = a.created_at ? new Date(a.created_at).toLocaleDateString() : "Unknown";
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(a);
    });
    return Array.from(groups.entries()).map(([day, items]) => ({
      day,
      items: items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    }));
  }, [audioRecords]);

  const credGroups = useMemo((): Array<{ day: string; items: CredentialRow[] }> => {
    const groups = new Map<string, CredentialRow[]>();
    creds.forEach((c) => {
      const day = c.timestamp ? new Date(c.timestamp).toLocaleDateString() : "Unknown";
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(c);
    });
    return Array.from(groups.entries())
      .map(([day, items]) => ({
        day,
        items: items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()),
      }))
      .sort((a, b) => {
        if (a.day === "Unknown") return 1;
        if (b.day === "Unknown") return -1;
        return new Date(b.items[0]?.timestamp || 0).getTime() - new Date(a.items[0]?.timestamp || 0).getTime();
      });
  }, [creds]);

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  };

  /* Render */
  return (
    <Suspense fallback={<LazyFallback />}>
      <div className="stack fade-in" style={{ gap: 28 }}>
        <div className="page-intro">
          <h2 className="page-intro__title">Your Evidence</h2>
          <p className="page-intro__desc muted">
            Browse your captured evidence. Each credential is cryptographically signed and timestamp-anchored.
          </p>
        </div>

        {/* Tabs + Refresh */}
        <SectionCard>
          <div className="row space" style={{ marginBottom: 8 }}>
            <div className="tabs">
              <button className={viewMode === "bursts" ? "active" : ""} onClick={() => setViewMode("bursts")}>
                <Layers size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                Bursts
              </button>
              <button className={viewMode === "captures" ? "active" : ""} onClick={() => setViewMode("captures")}>
                <ImageIcon size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                All Frames
              </button>
              <button className={viewMode === "audio" ? "active" : ""} onClick={() => setViewMode("audio")}>
                <Music size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                Audio
              </button>
            </div>
            <button
              className="secondary"
              onClick={viewMode === "bursts" ? loadBursts : viewMode === "captures" ? loadCreds : loadAudio}
              disabled={viewMode === "bursts" ? burstsBusy : viewMode === "captures" ? credsBusy : audioBusy}
            >
              {(viewMode === "bursts" ? burstsBusy : viewMode === "captures" ? credsBusy : audioBusy) ? (
                <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Refreshing</>
              ) : (
                <><RefreshCw size={14} strokeWidth={2.5} /> Refresh</>
              )}
            </button>
          </div>

          {/* Errors */}
          {viewMode === "bursts" && burstsError && <div className="alert error">{burstsError}</div>}
          {viewMode === "captures" && credsError && <div className="alert error">{credsError}</div>}
          {viewMode === "audio" && audioError && <div className="alert error">{audioError}</div>}

          {/* Bursts view */}
          {viewMode === "bursts" && bursts.length === 0 && !burstsBusy && <EmptyState type="bursts" />}

          {viewMode === "bursts" && bursts.length > 0 && (
            <div className="stack stagger">
              {bursts.map((burst) => {
                const isExpanded = expandedBurst?.burst?.id === burst.id;
                return (
                  <div key={burst.id} className="detail-card">
                    <div className="row space" style={{ cursor: "pointer", padding: "4px 0" }}
                      onClick={() => isExpanded ? setExpandedBurst(null) : onExpandBurst(burst.id)}>
                      <div>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <StatusBadge status={burst.status} />
                          <span style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                            {burst.frame_total === 1 ? "Single Capture" : `${burst.frame_total}-Frame Burst`}
                          </span>
                          <span className="muted" style={{ fontSize: "0.8125rem" }}>
                            {burst.trigger === "motion" ? "Motion" : "Manual"}
                          </span>
                        </div>
                        <div className="muted" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                          <Clock size={10} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />
                          {new Date(burst.created_at).toLocaleString()} &middot; {burst.frame_total} frame{burst.frame_total !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div style={{ color: "var(--text-muted)", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>
                        <ChevronDown size={18} strokeWidth={2} />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="fade-in" style={{ marginTop: 12 }}>
                        {expandBusy && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
                            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                            <span className="muted">Loading frames&hellip;</span>
                          </div>
                        )}
                        {!expandBusy && expandedBurst && (
                          <>
                            {expandedBurst.frames.anchored.length === 0 && (
                              <div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>No frames in this burst</div>
                            )}
                            {expandedBurst.frames.anchored.length > 0 && (
                              <BurstFrameStrip
                                frames={expandedBurst.frames.anchored}
                                selectedFrameId={selectedCredId}
                                onFrameClick={(frame: any) => {
                                  shouldScrollToCaptureDetailRef.current = true;
                                  setSelectedCredId(frame.id ?? null);
                                  setViewMode("captures");
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Captures view */}
          {viewMode === "captures" && creds.length === 0 && !credsBusy && <EmptyState type="captures" />}

          {viewMode === "captures" && creds.length > 0 && (
            <div className="stack stagger">
              {credGroups.map((group) => (
                <div key={group.day} className="date-group">
                  <div className="date-group__header">
                    <span className="date-group__label">{group.day}</span>
                    <span className="date-group__count">{group.items.length} frame{group.items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="grid">
                    {group.items.map((c) => (
                      <CaptureCard
                        key={c.id}
                        id={c.id ?? ""}
                        status={c.status ?? "pending"}
                        timestamp={c.timestamp}
                        type="single"
                        frameIndex={c.metadata?.frame_index}
                        selected={c.id === selectedCredId}
                        onClick={() => { shouldScrollToCaptureDetailRef.current = true; setSelectedCredId(c.id ?? null); }}
                        thumbnailUrl={c.media_url ?? mediaUrlForKey(c.media_key ?? null)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Audio view */}
          {viewMode === "audio" && audioRecords.length === 0 && !audioBusy && <EmptyState type="audio" />}

          {viewMode === "audio" && audioRecords.length > 0 && (
            <div className="stack stagger">
              {audioGroups.map((group) => (
                <div key={group.day} className="date-group">
                  <div className="date-group__header">
                    <span className="date-group__label">{group.day}</span>
                    <span className="date-group__count">{group.items.length} recording{group.items.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="grid">
                    {group.items.map((a: AudioRecord) => (
                      <CaptureCard
                        key={a.id}
                        id={a.id ?? ""}
                        status={a.tsa_status || "pending"}
                        timestamp={a.created_at}
                        type="audio"
                        label={a.title || "Untitled"}
                        sublabel={`${Math.round(((a.duration ?? (a as any).duration_ms ?? 0)) / 1000)}s`}
                        selected={a.id === selectedAudioId}
                        onClick={() => { shouldScrollToAudioDetailRef.current = true; setSelectedAudioId(a.id ?? null); }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Capture detail panel */}
        {viewMode === "captures" && selectedCred && (
          <div ref={captureDetailRef}>
            <SectionCard className="fade-in">
              <div className="detail-panel__header">
                <div>
                  <h3>
                    <FileKey size={18} strokeWidth={2} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8, color: "var(--primary-light)" }} />
                    Capture Details
                  </h3>
                  <div className="mono small" style={{ marginTop: 8 }}>{selectedId || selectedSha}</div>
                </div>
                <div className="links">
                  <button className="secondary" onClick={onCreateShare} disabled={shareBusy}>
                    <Share2 size={14} strokeWidth={2} />
                    {shareBusy ? "Creating\u2026" : "Share Link"}
                  </button>
                  <button className="secondary" onClick={onDownloadBundle} disabled={bundleBusy}>
                    <Download size={14} strokeWidth={2} />
                    {bundleBusy ? "Preparing\u2026" : "Evidence Bundle"}
                  </button>
                  {selectedMediaUrl && (
                    <a href={selectedMediaUrl} target="_blank" rel="noreferrer">
                      <button className="secondary"><ExternalLink size={14} strokeWidth={2} /> Download JPG</button>
                    </a>
                  )}
                  {selectedTsrUrl && (
                    <a href={selectedTsrUrl} target="_blank" rel="noreferrer">
                      <button className="secondary"><FileText size={14} strokeWidth={2} /> View TSR</button>
                    </a>
                  )}
                </div>
              </div>

              {selectedMediaUrl && (
                <div className="detail-panel__preview fade-in">
                  <img src={selectedMediaUrl} alt="Capture preview" loading="lazy" />
                </div>
              )}

              <div className="detail-panel__meta">
                {selectedCred.timestamp && (
                  <div className="detail-panel__meta-item">
                    <Clock size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Captured</span>
                    <span className="detail-panel__meta-value">{new Date(selectedCred.timestamp).toLocaleString()}</span>
                  </div>
                )}
                {selectedCred.device_id && (
                  <div className="detail-panel__meta-item">
                    <Smartphone size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Device</span>
                    <span className="detail-panel__meta-value font-mono">{selectedCred.device_id}</span>
                  </div>
                )}
                {selectedCred.sha256 && (
                  <div className="detail-panel__meta-item">
                    <Hash size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">SHA-256</span>
                    <span className="detail-panel__meta-value font-mono" style={{ fontSize: "0.6875rem" }}>{selectedCred.sha256}</span>
                  </div>
                )}
                {(selectedCred.tsa_time || selectedCred.anchor_timestamp) && (
                  <div className="detail-panel__meta-item">
                    <Anchor size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Anchor</span>
                    <span className="detail-panel__meta-value">{new Date(selectedCred.tsa_time || selectedCred.anchor_timestamp).toLocaleString()}</span>
                  </div>
                )}
                {selectedCred.status && (
                  <div className="detail-panel__meta-item">
                    <Shield size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Status</span>
                    <StatusBadge status={selectedCred.status} size="sm" />
                  </div>
                )}
              </div>

              {bundleError && <div className="alert error">{bundleError}</div>}

              {(shareError || shareUrl) && (
                <div className="stack">
                  {shareError && <div className="alert error">{shareError}</div>}
                  {shareUrl && (
                    <div ref={captureShareResultRef} className="result fade-in">
                      <div className="muted"><strong>Share link created</strong></div>
                      <div className="mono">{shareUrl}</div>
                      <div className="row">
                        <button className="secondary" onClick={onCopyShare}>
                          <Copy size={14} strokeWidth={2} /> Copy Link
                        </button>
                      </div>
                      <div className="muted" style={{ fontSize: "0.8125rem" }}>
                        Anyone with this link can verify this specific capture until it expires.
                      </div>
                      {shareExpiresAt && (
                        <div className="muted">
                          <Clock size={11} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />
                          <strong>Expires:</strong> {new Date(shareExpiresAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <details className="raw-json-details">
                <summary className="raw-json-summary">
                  <Code2 size={13} strokeWidth={2} /> View Raw Credential JSON
                  <ChevronDown size={13} strokeWidth={2} className="raw-json-chevron" />
                </summary>
                <div className="kv-list fade-in">
                  {Object.entries(selectedCred).map(([key, value]) => (
                    <div key={key} className="kv-row">
                      <div className="kv-key">{key}</div>
                      <div className="kv-value">{formatValue(value)}</div>
                    </div>
                  ))}
                </div>
              </details>
            </SectionCard>
          </div>
        )}

        {/* Audio detail panel */}
        {viewMode === "audio" && selectedAudio && (
          <div ref={audioDetailRef}>
            <SectionCard className="fade-in">
              <div className="detail-panel__header">
                <div>
                  <h3>
                    <Music size={18} strokeWidth={2} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8, color: "var(--primary-light)" }} />
                    Audio Details
                  </h3>
                  <div className="mono small" style={{ marginTop: 8 }}>{selectedAudio.id || ""}</div>
                </div>
                <div className="links">
                  <button className="secondary" onClick={onCreateAudioShare} disabled={audioShareBusy}>
                    <Share2 size={14} strokeWidth={2} />
                    {audioShareBusy ? "Creating\u2026" : "Share Link"}
                  </button>
                  <button className="secondary" onClick={onDownloadAudioBundle} disabled={audioBundleBusy}>
                    <Download size={14} strokeWidth={2} />
                    {audioBundleBusy ? "Preparing\u2026" : "Evidence Bundle"}
                  </button>
                  {selectedAudioUrl && (
                    <a href={selectedAudioUrl} target="_blank" rel="noreferrer">
                      <button className="secondary"><ExternalLink size={14} strokeWidth={2} /> Download</button>
                    </a>
                  )}
                </div>
              </div>

              {selectedAudioUrl && (
                <div className="audio-preview fade-in">
                  <audio controls src={selectedAudioUrl} style={{ width: "100%", borderRadius: 12 }} />
                </div>
              )}

              <div className="detail-panel__meta">
                {selectedAudio.created_at && (
                  <div className="detail-panel__meta-item">
                    <Clock size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Created</span>
                    <span className="detail-panel__meta-value">{new Date(selectedAudio.created_at).toLocaleString()}</span>
                  </div>
                )}
                {selectedAudio.device_id && (
                  <div className="detail-panel__meta-item">
                    <Smartphone size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Device</span>
                    <span className="detail-panel__meta-value font-mono">{selectedAudio.device_id}</span>
                  </div>
                )}
                {selectedAudio.sha256 && (
                  <div className="detail-panel__meta-item">
                    <Hash size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">SHA-256</span>
                    <span className="detail-panel__meta-value font-mono" style={{ fontSize: "0.6875rem" }}>{selectedAudio.sha256}</span>
                  </div>
                )}
                {selectedAudio.anchor_timestamp && (
                  <div className="detail-panel__meta-item">
                    <Anchor size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">Anchor</span>
                    <span className="detail-panel__meta-value">{new Date(selectedAudio.anchor_timestamp).toLocaleString()}</span>
                  </div>
                )}
                {selectedAudio.tsa_status && (
                  <div className="detail-panel__meta-item">
                    <Shield size={13} strokeWidth={2} />
                    <span className="detail-panel__meta-label">TSA Status</span>
                    <StatusBadge status={selectedAudio.tsa_status} size="sm" />
                  </div>
                )}
              </div>

              {audioBundleError && <div className="alert error">{audioBundleError}</div>}

              {(audioShareError || audioShareUrl) && (
                <div className="stack">
                  {audioShareError && <div className="alert error">{audioShareError}</div>}
                  {audioShareUrl && (
                    <div ref={audioShareResultRef} className="result fade-in">
                      <div className="muted"><strong>Share link created</strong></div>
                      <div className="mono">{audioShareUrl}</div>
                      <div className="row">
                        <button className="secondary" onClick={onCopyAudioShare}>
                          <Copy size={14} strokeWidth={2} /> Copy Link
                        </button>
                      </div>
                      <div className="muted" style={{ fontSize: "0.8125rem" }}>
                        Anyone with this link can verify this audio recording until it expires.
                      </div>
                      {audioShareExpiresAt && (
                        <div className="muted">
                          <Clock size={11} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 3 }} />
                          <strong>Expires:</strong> {new Date(audioShareExpiresAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <details className="raw-json-details">
                <summary className="raw-json-summary">
                  <Code2 size={13} strokeWidth={2} /> View Raw Credential JSON
                  <ChevronDown size={13} strokeWidth={2} className="raw-json-chevron" />
                </summary>
                <div className="kv-list fade-in">
                  {Object.entries(selectedAudio).map(([key, value]) => (
                    <div key={key} className="kv-row">
                      <div className="kv-key">{key}</div>
                      <div className="kv-value">{formatValue(value)}</div>
                    </div>
                  ))}
                </div>
              </details>
            </SectionCard>
          </div>
        )}
      </div>
    </Suspense>
  );
}
