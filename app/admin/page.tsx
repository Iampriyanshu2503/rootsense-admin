"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
// Search uses API route with service role key to bypass RLS and see ALL users

type User = {
    id: string;
    email: string;
    created_at: string;
};

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function relTime(d: string) {
    if (!d) return "—";
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export default function AdminSearchPage() {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);

    const [input, setInput]             = useState("");
    const [allUsers, setAllUsers]       = useState<User[]>([]);
    const [usersLoaded, setUsersLoaded] = useState(false);
    const [suggestions, setSuggestions] = useState<User[]>([]);
    const [searched, setSearched]       = useState(false);
    const [result, setResult]           = useState<User | null | "not_found">(null);
    const [loading, setLoading]         = useState(false);
    const [focused, setFocused]         = useState(false);
    const [emailError, setEmailError]   = useState("");
    const [debugInfo, setDebugInfo]     = useState("");

    /* ── fetch all users on mount — service role via API route ── */
    useEffect(() => {
        fetch("/api/users")
            .then(r => r.json())
            .then(({ users, error }) => {
                console.log("[AdminSearch] API returned:", users?.length, "users", error ? "error:" + error : "");
                if (users) { setAllUsers(users); setUsersLoaded(true); }
                if (error) console.error("[AdminSearch] API error:", error);
            })
            .catch(e => console.error("[AdminSearch] fetch error:", e));
    }, []);

    /* ── live suggestions ── */
    useEffect(() => {
        if (!input.trim()) { setSuggestions([]); return; }
        const q = input.toLowerCase().trim();
        setSuggestions(
            allUsers.filter(u => u.email?.toLowerCase().includes(q)).slice(0, 5)
        );
    }, [input, allUsers]);

    const handleInput = (val: string) => {
        setInput(val);
        setEmailError("");
        setSearched(false);
        setResult(null);
        setDebugInfo("");
    };

    /* ── SEARCH — case-insensitive, trimmed, with local fallback ── */
    const handleSearch = async () => {
        const email = input.trim().toLowerCase();
        if (!email) { setEmailError("Please enter an email address."); return; }
        if (!isValidEmail(email)) { setEmailError("Enter a valid email format — e.g. name@domain.com"); return; }

        setEmailError("");
        setLoading(true);
        setSuggestions([]);
        setSearched(false);
        setDebugInfo("");

        // Always fetch fresh from API to avoid stale state issues
        let searchPool = allUsers;
        if (!usersLoaded || allUsers.length === 0) {
            try {
                const res = await fetch("/api/users");
                const { users, error: apiErr } = await res.json();
                console.log("[AdminSearch] re-fetched:", users?.length, apiErr);
                if (users) { setAllUsers(users); setUsersLoaded(true); searchPool = users; }
            } catch (e) { console.error("[AdminSearch] refetch error:", e); }
        }

        const match: User | null = searchPool.find(
            u => u.email?.trim().toLowerCase() === email
        ) ?? null;

        setDebugInfo(
            `Searched: "${email}" | pool: ${searchPool.length} users | match: ${match?.email ?? "none"}`
        );

        setResult(match ?? "not_found");
        setSearched(true);
        setLoading(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSearch();
        if (e.key === "Escape") { setSuggestions([]); setFocused(false); }
    };

    const pickSuggestion = (u: User) => {
        setInput(u.email);
        setSuggestions([]);
        setResult(null);
        setSearched(false);
        setDebugInfo("");
        setTimeout(() => inputRef.current?.focus(), 0);
    };

    const showDropdown = focused && suggestions.length > 0 && !searched;

    return (
        <div className="page">

            {/* HEADER */}
            <header className="hdr">
                <div className="hdr-inner">
                    <div className="hdr-logo">
                        <Image
                            src="/assets/images/rootsense.png"
                            alt="Rootsense"
                            width={360} height={350}
                            style={{ width: 180, height: "auto", filter: "brightness(0) invert(1)" }}
                        />
                    </div>
                    <h1 className="hdr-title">Admin Panel</h1>
                    <div className="hdr-right">
                        <button className="hdr-dash" onClick={() => router.push("/admin/dashboard")}>
                            Dashboard →
                        </button>
                    </div>
                </div>
            </header>

            {/* MAIN */}
            <main className="main">

                {/* Hero */}
                <div className="hero-text">
                    <span className="hero-eyebrow">
                        <span className="edot" />
                        User Lookup
                    </span>
                    <h2 className="hero-h">Search by email address</h2>
                    <p className="hero-p">Enter a user's email to find their account, view clusters, and manage access.</p>
                </div>

                {/* Search card */}
                <div className="search-card">

                    <div className={`search-bar ${focused ? "focused" : ""} ${emailError ? "has-error" : ""}`}>
                        <span className="search-icon"><SearchIcon /></span>
                        <input
                            ref={inputRef}
                            className="search-input"
                            type="text"
                            inputMode="email"
                            placeholder="name@organization.com"
                            value={input}
                            onChange={e => handleInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setTimeout(() => setFocused(false), 160)}
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                        {input && (
                            <button className="clear-btn" onClick={() => {
                                setInput(""); setResult(null); setSearched(false);
                                setEmailError(""); setDebugInfo("");
                                inputRef.current?.focus();
                            }}>
                                <XIcon />
                            </button>
                        )}
                    </div>

                    {/* Email format error */}
                    {emailError && (
                        <div className="err-msg"><WarnIcon /> {emailError}</div>
                    )}

                    {/* Suggestions dropdown */}
                    {showDropdown && (
                        <div className="dropdown">
                            <div className="dd-label">Suggestions from database</div>
                            {suggestions.map(u => (
                                <button key={u.id} className="sug-row" onMouseDown={() => pickSuggestion(u)}>
                                    <div className="sug-av">{u.email[0].toUpperCase()}</div>
                                    <div className="sug-info">
                                        <span className="sug-email">{u.email}</span>
                                        <span className="sug-meta">{relTime(u.created_at)} · joined {relTime(u.created_at)}</span>
                                    </div>
                                    <span className="sug-pick">↵ select</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Search button */}
                    <button className="search-btn" onClick={handleSearch} disabled={loading}>
                        <span className="btn-content">
                            {loading ? <><span className="btn-spinner" /> Searching…</> : <><SearchIcon /> Search</>}
                        </span>
                        <span className="btn-shine" />
                    </button>

                    {/* Debug info — shows in dev so you can see what's happening */}
                    {debugInfo && process.env.NODE_ENV === "development" && (
                        <div className="debug-bar">{debugInfo}</div>
                    )}
                </div>

                {/* RESULT */}
                {searched && !loading && (
                    <div className="result-area">

                        {result === "not_found" && (
                            <div className="not-found">
                                <div className="nf-icon"><NoUserIcon /></div>
                                <div>
                                    <p className="nf-title">No user found</p>
                                    <p className="nf-sub">
                                        No account matches <strong className="nf-email">{input.trim()}</strong>
                                    </p>
                                    <p className="nf-hint">
                                        Make sure the email is exactly as registered. Check the browser console for debug info.
                                    </p>
                                </div>
                            </div>
                        )}

                        {result && result !== "not_found" && (
                            <>
                                <div className="found-tag"><CheckIcon /> User found — click to open</div>
                                <button
                                    className="user-card"
                                    onClick={() => router.push(`/admin/user/${(result as User).id}`)}
                                >
                                    <div className="uc-glow" />
                                    <div className="uc-left">
                                        <div className="uc-av">{(result as User).email[0].toUpperCase()}</div>
                                        <div>
                                            <div className="uc-email">{(result as User).email}</div>
                                            <div className="uc-meta">
                                                
                                                <span className="uc-sep">·</span>
                                                <span>Joined {relTime((result as User).created_at)}</span>
                                                <span className="uc-sep">·</span>
                                                <span className="mono">{(result as User).id.slice(0, 12)}…</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="uc-cta">View profile →</div>
                                </button>
                            </>
                        )}
                    </div>
                )}

            </main>

            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700&family=JetBrains+Mono:wght@400;500&display=swap');
                *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
                :root{
                    --bg:#080807;--s1:#0f0f0e;--s2:#141413;--s3:#1a1a18;--s4:#212120;
                    --b0:rgba(255,255,255,.05);--b1:rgba(255,255,255,.09);--b2:rgba(255,255,255,.16);
                    --t0:#f0f0ec;--t1:rgba(240,240,236,.6);--t2:rgba(240,240,236,.32);--t3:rgba(240,240,236,.15);
                    --g0:#10b981;--g1:#34d399;--ga:rgba(16,185,129,.07);--gb:rgba(16,185,129,.14);
                    --font:'Instrument Sans',-apple-system,sans-serif;
                    --mono:'JetBrains Mono',monospace;
                }
                html,body{background:var(--bg);color:var(--t0);font-family:var(--font);-webkit-font-smoothing:antialiased;min-height:100vh}

                .page{display:flex;flex-direction:column;min-height:100vh;background:var(--bg);position:relative;overflow:hidden}
                .page::before{content:'';position:fixed;top:-80px;left:20%;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,.07),transparent 65%);filter:blur(80px);pointer-events:none;animation:ga 14s ease-in-out infinite alternate}
                .page::after{content:'';position:fixed;bottom:-80px;right:10%;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,.04),transparent 65%);filter:blur(70px);pointer-events:none;animation:ga 10s ease-in-out infinite alternate-reverse}
                @keyframes ga{0%{opacity:.6;transform:scale(.9)}100%{opacity:1;transform:scale(1.1)}}

                /* HEADER */
                .hdr{position:sticky;top:0;z-index:50;height:64px;background:rgba(8,8,7,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--b0)}
                .hdr-inner{max-width:1100px;margin:0 auto;padding:0 2.5rem;height:100%;display:flex;align-items:center;justify-content:space-between;gap:1.5rem;position:relative}
                .hdr-logo{flex-shrink:0}
                .hdr-title{font-size:1rem;font-weight:700;letter-spacing:-.03em;color:var(--t0);position:absolute;left:50%;transform:translateX(-50%)}
                .hdr-dash{padding:.42rem 1rem;background:var(--s2);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.8rem;font-weight:500;cursor:pointer;transition:background .2s,color .2s}
                .hdr-dash:hover{background:var(--s3);color:var(--t0)}

                /* MAIN */
                .main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem 2rem 6rem;position:relative;z-index:1}

                /* HERO */
                .hero-text{text-align:center;margin-bottom:2.5rem}
                .hero-eyebrow{display:inline-flex;align-items:center;gap:.45rem;padding:.28rem .85rem .28rem .5rem;background:var(--ga);border:1px solid rgba(16,185,129,.18);border-radius:40px;font-family:var(--mono);font-size:.67rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--g0);margin-bottom:1.5rem}
                .edot{width:6px;height:6px;border-radius:50%;background:var(--g0);box-shadow:0 0 8px rgba(16,185,129,.6);animation:blink 2.4s ease infinite;flex-shrink:0}
                @keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
                .hero-h{font-size:clamp(1.8rem,4vw,3rem);font-weight:700;letter-spacing:-.05em;line-height:1.08;color:var(--t0);margin-bottom:.85rem}
                .hero-p{font-size:1rem;color:var(--t1);line-height:1.65;max-width:400px;margin:0 auto}

                /* SEARCH CARD */
                .search-card{width:100%;max-width:540px;display:flex;flex-direction:column;gap:.72rem;position:relative}

                .search-bar{display:flex;align-items:center;gap:.72rem;background:var(--s2);border:1px solid var(--b1);border-radius:14px;padding:.88rem 1.1rem;transition:border-color .2s,box-shadow .2s}
                .search-bar.focused{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .search-bar.has-error{border-color:rgba(239,68,68,.35);box-shadow:0 0 0 3px rgba(239,68,68,.07)}
                .search-icon{color:var(--t3);flex-shrink:0;display:flex}
                .search-input{flex:1;background:transparent;border:none;outline:none;font-family:var(--font);font-size:.97rem;color:var(--t0)}
                .search-input::placeholder{color:var(--t3)}
                .clear-btn{background:none;border:none;color:var(--t3);cursor:pointer;display:flex;align-items:center;padding:.18rem;border-radius:5px;transition:color .15s,background .15s;flex-shrink:0}
                .clear-btn:hover{color:var(--t0);background:var(--s3)}

                .err-msg{display:flex;align-items:center;gap:.48rem;padding:.52rem .88rem;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:8px;font-size:.82rem;color:#ef4444;animation:pop .25s ease}
                @keyframes pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}

                /* DROPDOWN */
                .dropdown{background:var(--s2);border:1px solid var(--b2);border-radius:12px;overflow:hidden;box-shadow:0 20px 50px -12px rgba(0,0,0,.65);animation:pop .2s ease}
                .dd-label{font-family:var(--mono);font-size:.58rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);padding:.58rem 1rem .38rem;border-bottom:1px solid var(--b0)}
                .sug-row{width:100%;display:flex;align-items:center;gap:.8rem;padding:.78rem 1rem;background:transparent;border:none;border-bottom:1px solid var(--b0);cursor:pointer;transition:background .15s;text-align:left}
                .sug-row:last-child{border-bottom:none}
                .sug-row:hover{background:var(--s3)}
                .sug-av{width:30px;height:30px;border-radius:8px;background:var(--ga);border:1px solid rgba(16,185,129,.2);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;color:var(--g1);flex-shrink:0;font-family:var(--font)}
                .sug-info{flex:1;min-width:0}
                .sug-email{display:block;font-size:.88rem;font-weight:600;color:var(--t0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .sug-meta{display:block;font-family:var(--mono);font-size:.6rem;color:var(--t3);margin-top:.12rem}
                .sug-pick{font-family:var(--mono);font-size:.62rem;color:var(--t3);flex-shrink:0}

                /* BUTTON */
                .search-btn{display:flex;align-items:center;justify-content:center;padding:.88rem;background:var(--g0);color:#fff;border:none;border-radius:12px;font-family:var(--font);font-size:.95rem;font-weight:600;cursor:pointer;position:relative;overflow:hidden;transition:opacity .2s,transform .2s,box-shadow .2s}
                .search-btn:hover{opacity:.88;transform:translateY(-1px);box-shadow:0 10px 28px -8px rgba(16,185,129,.45)}
                .search-btn:active{transform:scale(.98)}
                .search-btn:disabled{opacity:.52;cursor:default;transform:none;box-shadow:none}
                .btn-content{display:flex;align-items:center;gap:.5rem;position:relative;z-index:1}
                .btn-shine{position:absolute;top:0;left:-75%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);transform:skewX(-20deg);animation:shine 3.5s ease-in-out infinite}
                @keyframes shine{0%,70%{left:-75%}100%{left:130%}}
                .btn-spinner{width:15px;height:15px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}
                @keyframes spin{to{transform:rotate(360deg)}}

                /* DEBUG */
                .debug-bar{padding:.5rem .85rem;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.18);border-radius:8px;font-family:var(--mono);font-size:.62rem;color:rgba(96,165,250,.7);word-break:break-all;line-height:1.5}

                /* RESULT */
                .result-area{width:100%;max-width:540px;margin-top:.5rem;display:flex;flex-direction:column;gap:.72rem;animation:pop .35s ease}

                .not-found{display:flex;align-items:flex-start;gap:1rem;padding:1.2rem 1.4rem;background:var(--s2);border:1px solid var(--b1);border-radius:14px}
                .nf-icon{width:38px;height:38px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);display:flex;align-items:center;justify-content:center;color:#ef4444;flex-shrink:0;margin-top:.1rem}
                .nf-title{font-size:.9rem;font-weight:700;color:var(--t0);margin-bottom:.22rem}
                .nf-sub{font-size:.83rem;color:var(--t1);margin-bottom:.3rem}
                .nf-email{color:var(--t0);font-weight:700}
                .nf-hint{font-family:var(--mono);font-size:.62rem;color:var(--t3);line-height:1.5}

                .found-tag{display:inline-flex;align-items:center;gap:.42rem;font-family:var(--mono);font-size:.63rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--g0)}

                /* USER CARD */
                .user-card{width:100%;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1.35rem 1.5rem;background:var(--s2);border:1px solid rgba(16,185,129,.28);border-radius:16px;cursor:pointer;position:relative;overflow:hidden;transition:border-color .2s,box-shadow .2s,transform .2s;text-align:left}
                .user-card:hover{border-color:rgba(16,185,129,.5);box-shadow:0 0 40px -12px rgba(16,185,129,.18);transform:translateY(-2px)}
                .user-card:active{transform:scale(.99)}
                .uc-glow{position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,.08),transparent 65%);pointer-events:none}
                .uc-left{display:flex;align-items:center;gap:1rem;position:relative;z-index:1}
                .uc-av{width:44px;height:44px;border-radius:12px;background:var(--gb);border:1px solid rgba(16,185,129,.3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:var(--g1);flex-shrink:0;font-family:var(--font)}
                .uc-email{font-size:.98rem;font-weight:700;color:var(--t0);margin-bottom:.3rem;letter-spacing:-.01em}
                .uc-meta{display:flex;align-items:center;gap:.38rem;font-size:.75rem;color:var(--t2);flex-wrap:wrap}
                .uc-role{color:var(--g1);font-weight:500}
                .uc-sep{color:var(--t3)}
                .uc-cta{font-size:.82rem;font-weight:600;color:var(--g0);white-space:nowrap;position:relative;z-index:1;flex-shrink:0}
                .mono{font-family:var(--mono)}

                @media(max-width:600px){
                    .hdr-title{display:none}
                    .hdr-inner{padding:0 1.25rem}
                    .main{padding:2rem 1.25rem 4rem}
                    .hero-h{font-size:1.7rem}
                }
            `}</style>
        </div>
    );
}

const SearchIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const XIcon      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const WarnIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const CheckIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const NoUserIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="1" x2="17" y2="7"/><line x1="17" y1="1" x2="23" y2="7"/></svg>;