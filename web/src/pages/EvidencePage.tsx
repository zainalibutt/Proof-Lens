import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
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
import EvidenceInspector from "../components/EvidenceInspector";
import StatusBadge from "../components/StatusBadge";
import EmptyState from "../components/EmptyState";
import {
  RefreshCw,
  ChevronDown,
  Layers,
  Image as ImageIcon,
  Music,
  Clock,
  Search,
} from "lucide-react";

const BurstFrameStrip = lazy(() => import("../components/BurstFrameStrip"));

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
  const [loadedViews, setLoadedViews] = useState({ captures: false, bursts: false, audio: false });

  const [viewMode, setViewMode] = useState<"bursts" | "captures" | "audio">("captures");
  const [searchQuery, setSearchQuery] = useState("");

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

  /* Loaders */
  const loadCreds = useCallback(async () => {
    setCredsError(null); setCredsBusy(true);
    try {
      const list = (await fetchCredentials(accessToken)) as CredentialRow[];
      setCreds(list);
      if (list.length) setSelectedCredId((p) => p ?? list[0]?.id ?? null); else setSelectedCredId(null);
    } catch (e: any) { setCredsError(e?.message || "Failed to load credentials"); } finally {
      setCredsBusy(false);
      setLoadedViews((current) => ({ ...current, captures: true }));
    }
  }, [accessToken]);

  const loadBursts = useCallback(async () => {
    setBurstsError(null); setBurstsBusy(true);
    try {
      const items = await fetchBursts(accessToken);
      const anchored = items.filter((b: any) => b.status === "anchored");
      setBursts(anchored);
      setSelectedCredId(null);
    } catch (e: any) { setBurstsError(e?.message || "Failed to load bursts"); } finally {
      setBurstsBusy(false);
      setLoadedViews((current) => ({ ...current, bursts: true }));
    }
  }, [accessToken]);

  const loadAudio = useCallback(async () => {
    setAudioError(null); setAudioBusy(true);
    try {
      const items = await fetchAudioRecords(accessToken);
      setAudioRecords(items as AudioRecord[]);
      if (items.length) setSelectedAudioId((p) => p ?? (items[0].id ?? null)); else setSelectedAudioId(null);
    } catch (e: any) { setAudioError(e?.message || "Failed to load audio records"); } finally {
      setAudioBusy(false);
      setLoadedViews((current) => ({ ...current, audio: true }));
    }
  }, [accessToken]);

  useEffect(() => {
    if (viewMode === "captures" && !loadedViews.captures) loadCreds();
    if (viewMode === "bursts" && !loadedViews.bursts) loadBursts();
    if (viewMode === "audio" && !loadedViews.audio) loadAudio();
  }, [loadAudio, loadBursts, loadCreds, loadedViews.audio, loadedViews.bursts, loadedViews.captures, viewMode]);

  /* Handlers */
  const onExpandBurst = async (burstId: string) => {
    setExpandBusy(true);
    try {
      const data = await fetchBurstWithFrames(accessToken, burstId);
      if (data) {
        setExpandedBurst(data);
        const firstFrame = data.frames.anchored[0];
        if (firstFrame) selectCapture(firstFrame);
      }
    } catch (e: any) { setBurstsError(e?.message || "Failed to load burst frames"); } finally { setExpandBusy(false); }
  };

  const selectedCred = useMemo(
    () => creds.find((c) => c.id === selectedCredId)
      ?? expandedBurst?.frames.anchored.find((c) => c.id === selectedCredId)
      ?? null,
    [creds, expandedBurst, selectedCredId],
  );
  const selectedMediaUrl = selectedCred?.media_url ?? (selectedCred ? mediaUrlForKey(selectedCred.media_key ?? null) : null);
  const selectedTsrUrl = selectedCred?.tsr_url ?? (selectedCred ? tsrUrlForKey(selectedCred.media_key ?? null) : null);

  const selectedAudio = audioRecords.find((a) => a.id === selectedAudioId) ?? null;
  const selectedAudioUrl = selectedAudio?.media_url ?? null;

  const selectCapture = (capture: CredentialRow) => {
    setSelectedCredId(capture.id ?? null);
    setSelectedAudioId(null);
    setShareUrl(null);
    setShareExpiresAt(null);
    setShareError(null);
    setBundleError(null);
  };

  const selectAudio = (audio: AudioRecord) => {
    setSelectedAudioId(audio.id ?? null);
    setSelectedCredId(null);
    setAudioShareUrl(null);
    setAudioShareExpiresAt(null);
    setAudioShareError(null);
    setAudioBundleError(null);
  };

  const closeInspector = () => {
    setSelectedCredId(null);
    setSelectedAudioId(null);
  };

  const changeView = (mode: "bursts" | "captures" | "audio") => {
    setViewMode(mode);
    if (mode === "audio") setSelectedCredId(null);
    else setSelectedAudioId(null);
  };

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

  const filteredCredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return credGroups;
    return credGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((capture) =>
          [capture.id, capture.sha256, capture.device_id, capture.capture_device_id, capture.status]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [credGroups, searchQuery]);

  /* Render */
  return (
    <Suspense fallback={<LazyFallback />}>
      <div className="stack fade-in" style={{ gap: 28 }}>
        <div className="page-intro">
          <h2 className="page-intro__title">Evidence library</h2>
          <p className="page-intro__desc muted">
            Inspect the media, device signature and independent time anchor behind every record.
          </p>
        </div>

        <div className="evidence-workspace">
          <div className="evidence-workspace__collection">
          {/* Tabs + Refresh */}
          <SectionCard>
          <div className="evidence-toolbar">
            <div className="tabs" role="tablist" aria-label="Evidence type">
              <button role="tab" aria-selected={viewMode === "captures"} className={viewMode === "captures" ? "active" : ""} onClick={() => changeView("captures")}>
                <ImageIcon size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                All media
              </button>
              <button role="tab" aria-selected={viewMode === "bursts"} className={viewMode === "bursts" ? "active" : ""} onClick={() => changeView("bursts")}>
                <Layers size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                Sessions
              </button>
              <button role="tab" aria-selected={viewMode === "audio"} className={viewMode === "audio" ? "active" : ""} onClick={() => changeView("audio")}>
                <Music size={13} strokeWidth={2} style={{ marginRight: 4 }} />
                Audio
              </button>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {viewMode === "captures" && (
                <label className="evidence-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search hash or device"
                    aria-label="Search evidence"
                  />
                </label>
              )}
              <button
                className="secondary"
                onClick={viewMode === "bursts" ? loadBursts : viewMode === "captures" ? loadCreds : loadAudio}
                disabled={viewMode === "bursts" ? burstsBusy : viewMode === "captures" ? credsBusy : audioBusy}
                aria-label="Refresh evidence"
              >
                {(viewMode === "bursts" ? burstsBusy : viewMode === "captures" ? credsBusy : audioBusy) ? (
                  <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Refreshing</>
                ) : (
                  <><RefreshCw size={14} strokeWidth={2.5} /> Refresh</>
                )}
              </button>
            </div>
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
                    <button
                      type="button"
                      className="evidence-burst__toggle"
                      aria-expanded={isExpanded}
                      onClick={() => isExpanded ? setExpandedBurst(null) : onExpandBurst(burst.id)}
                    >
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
                      <span className={`evidence-burst__chevron${isExpanded ? " evidence-burst__chevron--open" : ""}`}>
                        <ChevronDown size={18} strokeWidth={2} />
                      </span>
                    </button>

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
                                  selectCapture(frame);
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

          {viewMode === "captures" && creds.length > 0 && filteredCredGroups.length === 0 && (
            <div className="evidence-search-empty">
              <Search size={20} />
              <strong>No matching evidence</strong>
              <span>Try a shorter hash, device identifier or status.</span>
            </div>
          )}

          {viewMode === "captures" && filteredCredGroups.length > 0 && (
            <div className="stack stagger">
              {filteredCredGroups.map((group) => (
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
                        onClick={() => selectCapture(c)}
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
                        onClick={() => selectAudio(a)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          </SectionCard>
          </div>

          <aside
            className={`evidence-workspace__inspector${selectedCred || selectedAudio ? " evidence-workspace__inspector--open" : ""}`}
            aria-label="Evidence details"
          >
            <SectionCard className="evidence-inspector">
              <EvidenceInspector
                capture={selectedCred}
                audio={selectedAudio}
                mediaUrl={selectedMediaUrl}
                tsrUrl={selectedTsrUrl}
                audioUrl={selectedAudioUrl}
                shareUrl={shareUrl}
                shareExpiresAt={shareExpiresAt}
                shareBusy={shareBusy}
                shareError={shareError}
                bundleBusy={bundleBusy}
                bundleError={bundleError}
                audioShareUrl={audioShareUrl}
                audioShareExpiresAt={audioShareExpiresAt}
                audioShareBusy={audioShareBusy}
                audioShareError={audioShareError}
                audioBundleBusy={audioBundleBusy}
                audioBundleError={audioBundleError}
                onCreateShare={onCreateShare}
                onCopyShare={onCopyShare}
                onDownloadBundle={onDownloadBundle}
                onCreateAudioShare={onCreateAudioShare}
                onCopyAudioShare={onCopyAudioShare}
                onDownloadAudioBundle={onDownloadAudioBundle}
                onClose={closeInspector}
              />
            </SectionCard>
          </aside>
        </div>

      </div>
    </Suspense>
  );
}
