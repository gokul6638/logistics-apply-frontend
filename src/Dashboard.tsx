import React, { useEffect, useMemo, useState } from "react";

type TabKey = "all" | "saved" | "applied";
type LocationMode = "All" | "Custom";
type PostedWithin = "any" | "24h" | "1d" | "1w";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  postedDate?: string | null;
  url?: string | null;
  hrEmail?: string | null;
  recruiterLinkedin?: string | null;
  saved: boolean;
  applied: boolean;
  matchScore?: number | null;
};

type Settings = {
  location: string;
  keywords: string;
  exclude_keywords: string;
};

interface Props {
  token: string;
  onLogout: () => void;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function parsePostedDateToMs(postedDate?: string | null): number | null {
  if (!postedDate) return null;
  const s = postedDate.trim().toLowerCase();
  if (!s) return null;

  const rel = s.match(/(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks)\s*ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (!Number.isFinite(n)) return null;

    const now = Date.now();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;

    let delta = 0;
    if (unit.startsWith("minute")) delta = n * minute;
    else if (unit.startsWith("hour")) delta = n * hour;
    else if (unit.startsWith("day")) delta = n * day;
    else if (unit.startsWith("week")) delta = n * week;

    return now - delta;
  }

  const t = Date.parse(postedDate);
  if (!Number.isNaN(t)) return t;

  return null;
}

function withinFilter(postedMs: number | null, filter: PostedWithin): boolean {
  if (filter === "any") return true;
  if (postedMs === null) return true;

  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const week = 7 * day;

  if (filter === "24h") return now - postedMs <= 24 * hour;
  if (filter === "1d") return now - postedMs <= 1 * day;
  if (filter === "1w") return now - postedMs <= 1 * week;

  return true;
}

export default function Dashboard({ token, onLogout }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const [locationMode, setLocationMode] = useState<LocationMode>("All");
  const [locationText, setLocationText] = useState<string>("");

  const [postedWithin, setPostedWithin] = useState<PostedWithin>("any");

  const [settings, setSettings] = useState<Settings | null>(null);

  const [loadingJobs, setLoadingJobs] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string>("");

  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [applyJobId, setApplyJobId] = useState<string | null>(null);

  const sessionState = token ? "authenticated" : "guest";

  const counts = useMemo(() => {
    const savedCount = jobs.filter((j) => j.saved).length;
    const appliedCount = jobs.filter((j) => j.applied).length;
    return { total: jobs.length, saved: savedCount, applied: appliedCount };
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const needle = locationText.trim().toLowerCase();

    return jobs
      .filter((j) => {
        if (tab === "saved" && !j.saved) return false;
        if (tab === "applied" && !j.applied) return false;
        return true;
      })
      .filter((j) => {
        const ms = parsePostedDateToMs(j.postedDate);
        return withinFilter(ms, postedWithin);
      })
      .filter((j) => {
        if (locationMode === "All") return true;
        if (!needle) return true;
        return (j.location || "").toLowerCase().includes(needle);
      })
      .filter((j) => {
        if (!q) return true;
        return (
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          (j.source || "").toLowerCase().includes(q)
        );
      });
  }, [jobs, tab, search, locationMode, locationText, postedWithin]);

  async function loadSettings() {
    const res = await fetch("/api/settings", { headers: { ...authHeaders(token) } });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as Settings;
    setSettings(data);

    setLocationText(data.location || "");
    setLocationMode(data.location ? "Custom" : "All");
  }

  async function saveSettings(next: Settings) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as Settings;
    setSettings(data);
  }

  async function loadJobs() {
    setLoadingJobs(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (postedWithin !== "any") {
        params.set("posted_within", postedWithin);
      }
      const qs = params.toString();
      const url = qs ? `/api/jobs?${qs}` : "/api/jobs";

      const res = await fetch(url, { headers: { ...authHeaders(token) } });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as Job[];
      setJobs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoadingJobs(false);
    }
  }

  async function fetchJobsNow() {
    setFetching(true);
    setError("");
    try {
      const res = await fetch("/api/fetch-jobs", {
        method: "POST",
        headers: { ...authHeaders(token) },
      });
      if (!res.ok) throw new Error(await res.text());
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch jobs");
    } finally {
      setFetching(false);
    }
  }

  async function toggleSave(job: Job) {
    const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/save`, {
      method: "POST",
      headers: { ...authHeaders(token) },
    });
    if (!res.ok) throw new Error(await res.text());
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, saved: !j.saved } : j)));
  }

  async function markApplied(jobId: string) {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/applied`, {
      method: "POST",
      headers: { ...authHeaders(token) },
    });
    if (!res.ok) throw new Error(await res.text());
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, applied: true } : j)));
  }

  function openApply(job: Job) {
    if (!job.url) return;
    window.open(job.url, "_blank", "noopener,noreferrer");
    setApplyJobId(job.id);
    setApplyModalOpen(true);
  }

  function closeApplyModal() {
    setApplyModalOpen(false);
    setApplyJobId(null);
  }

  async function confirmApplied() {
    if (applyJobId) {
      try {
        await markApplied(applyJobId);
      } finally {
        closeApplyModal();
      }
    } else {
      closeApplyModal();
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadSettings();
        await loadJobs();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to initialize dashboard");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="la-root" data-session={sessionState}>
      <style>{`
        :root{
          --bg: #f6f8fc;
          --panel: rgba(255,255,255,0.92);
          --panelSolid: #ffffff;
          --border: #e5eaf2;
          --text: #0f172a;
          --muted: #5b6b84;
          --brand: #2563eb;
          --brand2:#1d4ed8;
          --success:#16a34a;
          --danger:#dc2626;
          --shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        }

        *{ box-sizing:border-box; }

        .la-root{
          min-height:100vh;
          width: 100%;
          background:
            radial-gradient(1200px 500px at 20% 0%, rgba(37,99,235,0.08), transparent 60%),
            radial-gradient(900px 500px at 90% 10%, rgba(29,78,216,0.06), transparent 55%),
            var(--bg);
          color: var(--text);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }

        .la-shell{ width: 100%; margin: 0; padding: 18px 22px 48px; }

        .la-topbar{
          position: sticky;
          top: 0;
          z-index: 50;
          background: var(--panel);
          backdrop-filter: blur(16px);
          border: 1px solid var(--border);
          border-left: none;
          border-right: none;
          border-radius: 0;
          box-shadow: var(--shadow);
          padding: 14px 18px;
        }

        .la-topbarRow{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .la-brandName{
          font-weight: 900;
          letter-spacing: -0.02em;
          font-size: 18px;
          background: linear-gradient(135deg, var(--brand), var(--brand2));
          -webkit-background-clip:text;
          background-clip:text;
          color: transparent;
        }

        .la-badges{ display:flex; gap: 10px; flex-wrap: wrap; }
        .la-badge{
          background: var(--panelSolid);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 8px 10px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
        }

        .la-tabs{ display:flex; gap: 8px; padding: 10px 0 0; flex-wrap: wrap; }
        .la-tab{
          border: 1px solid var(--border);
          background: var(--panelSolid);
          color: var(--muted);
          padding: 10px 12px;
          border-radius: 12px;
          font-weight: 800;
          font-size: 13px;
          cursor: pointer;
          user-select:none;
        }
        .la-tabActive{
          background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(29,78,216,0.08));
          color: var(--text);
          border-color: rgba(37,99,235,0.35);
        }

        .la-actions{
          display:flex;
          gap: 10px;
          align-items:center;
          flex-wrap: wrap;
          padding: 10px 0 0;
        }

        .la-input, .la-select{
          background: var(--panelSolid);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 13px;
          outline: none;
          min-height: 40px;
        }
        .la-input{ min-width: 260px; flex: 1; }

        @media (max-width: 980px){
          .la-input{ min-width: 200px; }
        }

        .la-btn{
          border: none;
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 900;
          font-size: 13px;
          cursor: pointer;
          min-height: 40px;
          transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
        }
        .la-btn:hover{
          transform: translateY(-1px);
          box-shadow: 0 12px 22px rgba(15,23,42,0.10);
        }
        .la-btn:active{ transform: translateY(0px); box-shadow: none; }

        .la-btnSignOut{
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
        }

        .la-btnPrimary{
          background: linear-gradient(135deg, var(--brand), var(--brand2));
          color: white;
        }

        .la-page{ margin-top: 18px; }

        .la-grid{
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        @media (max-width: 980px){ .la-grid{ grid-template-columns: 1fr; } }

        .la-card{
          background: var(--panelSolid);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
          padding: 16px;
          display:flex;
          flex-direction:column;
          gap: 12px;
        }

        .la-cardTop{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap: 10px;
        }

        .la-jobTitle{ font-weight: 900; font-size: 16px; line-height: 1.25; }

        .la-score{
          font-weight: 900;
          font-size: 12px;
          color: white;
          background: linear-gradient(135deg, #16a34a, #15803d);
          border-radius: 999px;
          padding: 6px 10px;
          white-space: nowrap;
        }

        .la-meta{
          display:flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
          margin-top: 6px;
        }
        .la-meta strong{ color: var(--text); font-weight: 900; }

        .la-infoBox{
          background: #f8fafc;
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 12px 12px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap: 10px;
        }

        .la-infoLabel{
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .la-infoValue{
          font-size: 13px;
          color: var(--text);
          font-weight: 800;
          text-align:right;
          overflow-wrap:anywhere;
        }

        .la-infoValue a{ color: var(--brand); text-decoration:none; }
        .la-infoValue a:hover{ text-decoration: underline; }

        .la-cardActions{ display:flex; gap: 10px; margin-top: 2px; }

        .la-primary{
          background: linear-gradient(135deg, var(--brand), var(--brand2));
          color: white;
        }

        .la-secondary{
          background: #f1f5f9;
          color: #334155;
          border: 1px solid var(--border);
        }

        .la-success{
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: white;
        }

        .la-disabled{ opacity: 0.55; cursor: not-allowed; }

        .la-empty{
          background: var(--panelSolid);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: var(--shadow);
          padding: 26px;
          color: var(--muted);
          font-weight: 800;
        }

        .la-error{
          margin: 12px 0 0;
          background: rgba(220, 38, 38, 0.08);
          border: 1px solid rgba(220, 38, 38, 0.22);
          color: var(--danger);
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 800;
          font-size: 13px;
          white-space: pre-wrap;
        }

        .la-modalOverlay{
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display:flex;
          align-items:center;
          justify-content:center;
          padding: 18px;
          z-index: 200;
        }

        .la-modal{
          width: 100%;
          max-width: 520px;
          background: white;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.8);
          box-shadow: 0 30px 80px rgba(0,0,0,0.18);
          padding: 18px;
        }

        .la-modalTitle{ font-size: 16px; font-weight: 900; }
        .la-modalText{ margin-top: 8px; color: var(--muted); font-weight: 700; font-size: 13px; line-height: 1.5; }
        .la-modalBtns{ display:flex; gap: 10px; margin-top: 14px; }
      `}</style>

      <div className="la-shell">
        <header className="la-topbar">
          <div className="la-topbarRow">
            <div className="la-brandName">LogistiApply AI Pro</div>

            <div className="la-badges">
              <div className="la-badge">Total: {counts.total}</div>
              <div className="la-badge">Saved: {counts.saved}</div>
              <div className="la-badge">Applied: {counts.applied}</div>
            </div>
          </div>

          <div className="la-tabs" role="tablist" aria-label="Job views">
            <button type="button" className={`la-tab ${tab === "all" ? "la-tabActive" : ""}`} onClick={() => setTab("all")}>
              All Jobs
            </button>
            <button type="button" className={`la-tab ${tab === "saved" ? "la-tabActive" : ""}`} onClick={() => setTab("saved")}>
              Saved Jobs
            </button>
            <button type="button" className={`la-tab ${tab === "applied" ? "la-tabActive" : ""}`} onClick={() => setTab("applied")}>
              Applied Jobs
            </button>
          </div>

          <div className="la-actions">
            <input
              className="la-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, company, or source..."
              aria-label="Search jobs"
            />

            <select
              className="la-select"
              value={postedWithin}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPostedWithin(e.target.value as PostedWithin)}
              aria-label="Posted within"
              title="Filter by posting recency"
            >
              <option value="any">Any time</option>
              <option value="24h">Past 24 hours</option>
              <option value="1d">Past 1 day</option>
              <option value="1w">Past 1 week</option>
            </select>

            <select className="la-select" value={locationMode} onChange={(e) => setLocationMode(e.target.value as LocationMode)}>
              <option value="All">All locations</option>
              <option value="Custom">Custom location</option>
            </select>

            {locationMode === "Custom" && (
              <input
                className="la-input"
                value={locationText}
                onChange={(e) => {
                  const v = e.target.value;
                  setLocationText(v);
                }}
                onBlur={async () => {
                  if (!settings) return;
                  try {
                    await saveSettings({ ...settings, location: locationText });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to save settings");
                  }
                }}
                placeholder="Type your target location (e.g., Florida, Miami, Remote)"
                aria-label="Custom location"
              />
            )}

            <button type="button" className="la-btn la-btnPrimary" onClick={fetchJobsNow} disabled={fetching}>
              {fetching ? "Fetching..." : "Fetch jobs now"}
            </button>

            <button type="button" className="la-btn la-btnSignOut" onClick={onLogout}>
              Sign Out
            </button>
          </div>

          {error ? <div className="la-error">{error}</div> : null}
        </header>

        <section className="la-page">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 12,
              flexWrap: "wrap",
              margin: "8px 2px 14px",
            }}
          >
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>
                {tab === "all" && "Job Opportunities"}
                {tab === "saved" && "Saved Jobs"}
                {tab === "applied" && "Applied Jobs"}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700, marginTop: 4 }}>
                {loadingJobs ? "Loading..." : `${visibleJobs.length} results`}
              </div>
            </div>
          </div>

          {loadingJobs ? (
            <div className="la-empty">Loading jobs...</div>
          ) : visibleJobs.length === 0 ? (
            <div className="la-empty">No results found. Click “Fetch jobs now” or adjust filters.</div>
          ) : (
            <div className="la-grid">
              {visibleJobs.map((job) => {
                const hrEmailText = job.hrEmail ? job.hrEmail : "Not available";
                const canApply = Boolean(job.url) && !job.applied;

                return (
                  <article key={job.id} className="la-card">
                    <div className="la-cardTop">
                      <div>
                        <div className="la-jobTitle">{job.title}</div>
                        <div className="la-meta">
                          <span>
                            <strong>{job.company}</strong>
                          </span>
                          <span>{job.location}</span>
                          <span>{job.source}</span>
                          {job.postedDate ? <span>Posted {job.postedDate}</span> : null}
                        </div>
                      </div>
                      {typeof job.matchScore === "number" ? <div className="la-score">{job.matchScore}%</div> : null}
                    </div>

                    <div className="la-infoBox">
                      <div className="la-infoLabel">HR Email</div>
                      <div className="la-infoValue">
                        {job.hrEmail ? <a href={`mailto:${job.hrEmail}`}>{hrEmailText}</a> : hrEmailText}
                      </div>
                    </div>

                    {job.recruiterLinkedin ? (
                      <div className="la-infoBox">
                        <div className="la-infoLabel">LinkedIn</div>
                        <div className="la-infoValue">
                          <a href={job.recruiterLinkedin} target="_blank" rel="noreferrer">
                            Recruiter profile
                          </a>
                        </div>
                      </div>
                    ) : null}

                    <div className="la-cardActions">
                      {job.applied ? (
                        <button type="button" className="la-btn la-success la-disabled" disabled>
                          Applied
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`la-btn la-primary ${canApply ? "" : "la-disabled"}`}
                          disabled={!canApply}
                          onClick={() => openApply(job)}
                          title={!job.url ? "Application link not available for this job" : "Open application link"}
                        >
                          Apply Now
                        </button>
                      )}

                      <button
                        type="button"
                        className="la-btn la-secondary"
                        onClick={async () => {
                          try {
                            await toggleSave(job);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Failed to save job");
                          }
                        }}
                      >
                        {job.saved ? "Remove" : "Save"}
                      </button>

                      <button
                        type="button"
                        className="la-btn la-secondary"
                        onClick={async () => {
                          try {
                            await loadJobs();
                          } catch {
                            // loadJobs handles error state
                          }
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {applyModalOpen && (
        <div className="la-modalOverlay" role="dialog" aria-modal="true" onClick={closeApplyModal}>
          <div className="la-modal" onClick={(e) => e.stopPropagation()}>
            <div className="la-modalTitle">Confirm application</div>
            <div className="la-modalText">Did you submit the application on the external job site?</div>

            <div className="la-modalBtns">
              <button type="button" className="la-btn la-btnPrimary" onClick={confirmApplied}>
                Yes, mark as applied
              </button>
              <button type="button" className="la-btn la-secondary" onClick={closeApplyModal}>
                No, keep unchanged
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
