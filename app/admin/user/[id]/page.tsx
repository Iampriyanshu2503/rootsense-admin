"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ── Types ── */
type User = {
    id: string;
    auth_provider: string;
    auth_provider_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    global_role: string | null;
    default_app: string | null;
    created_at: string;
    updated_at: string;
    last_login: string | null;
};

type UserData = {
    id: string;
    user_id: string;
    full_name: string;
    dob: string;
    address: string | null;
    govt_id_type: string;
    govt_id_number: string;
    verification_status: string | null;
    monthly_revenue_bracket: string | null;
    created_at: string;
    updated_at: string;
};

type Cluster = {
    id: string;
    farm_name: string;
    crop_type: string;
    approval_status: string;
    compute_tier: string;
    billing_frequency: string;
    land_area: number;
    area_unit: string;
    created_at: string;
    full_name: string;
    address: string;
    govt_id_type: string;
    govt_id_number: string;
    monthly_revenue_range: string;
    provisioning_mode: string;
    farm_type: string | null;
    soil_type: string | null;
    irrigation_type: string | null;
    climate_category: string | null;
    connectivity_type: string | null;
    sensor_nodes: number | null;
    plan_id: string;
    payment_method: string;
    [key: string]: any;
};

type Toast = { msg: string; type: "success" | "error" | "warn" };

/* ── Locked fields — never editable ── */
const LOCKED_USER   = new Set(["id", "auth_provider", "auth_provider_id", "created_at", "updated_at", "last_login"]);
const LOCKED_UDATA  = new Set(["id", "user_id", "created_at", "updated_at"]);
const LOCKED_CLUSTER= new Set(["id", "user_id", "created_at", "updated_at"]);

/* ── CHECK constraint allowed values ── */
const ALLOWED: Record<string, string[]> = {
    global_role:          ["user", "admin", "moderator"],
    govt_id_type:         ["aadhaar", "pan", "passport", "driving"],
    verification_status:  ["pending", "verified", "rejected"],
    approval_status:      ["pending", "approved", "rejected"],
    compute_tier:         ["starter", "standard", "advanced"],
    billing_frequency:    ["monthly", "annual"],
    payment_method:       ["card", "upi"],
    area_unit:            ["acres", "hectares"],
    provisioning_mode:    ["auto", "custom"],
};

/* ── Conflict check ── */
type Conflict = { field: string; severity: "block" | "warn"; message: string };

async function checkUserConflicts(original: User, edited: User, allUsers: User[]): Promise<Conflict[]> {
    const out: Conflict[] = [];
    if (edited.email !== original.email) {
        const dup = allUsers.find(u => u.id !== original.id && u.email?.toLowerCase() === edited.email?.toLowerCase());
        if (dup) out.push({ field: "email", severity: "block", message: `Email already used by another user (${dup.id.slice(0,8)}…).` });
        else out.push({ field: "email", severity: "warn", message: "Changing email won't update Kinde auth — user still logs in with old email." });
    }
    if (edited.global_role && !ALLOWED.global_role.includes(edited.global_role))
        out.push({ field: "global_role", severity: "block", message: `Invalid role. Allowed: ${ALLOWED.global_role.join(", ")}` });
    return out;
}

function relTime(d: string | null) {
    if (!d) return "—";
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/* ══════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════ */
export default function AdminUserPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const [user, setUser]           = useState<User | null>(null);
    const [userData, setUserData]   = useState<UserData | null>(null);
    const [clusters, setClusters]   = useState<Cluster[]>([]);
    const [allUsers, setAllUsers]   = useState<User[]>([]);
    const [loading, setLoading]     = useState(true);
    const [saving, setSaving]       = useState(false);
    const [toast, setToast]         = useState<Toast | null>(null);
    const [conflicts, setConflicts] = useState<Conflict[]>([]);
    const [confirmOpen, setConfirmOpen] = useState(false);

    /* edit drafts */
    const [draftUser, setDraftUser]       = useState<User | null>(null);
    const [draftUserData, setDraftUserData] = useState<UserData | null>(null);
    const [draftClusters, setDraftClusters] = useState<Cluster[]>([]);

    /* which sections are in edit mode */
    const [editingUser, setEditingUser]       = useState(false);
    const [editingUserData, setEditingUserData] = useState(false);
    const [editingClusterId, setEditingClusterId] = useState<string | null>(null);

    const showToast = (msg: string, type: Toast["type"] = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    };

    /* ── FETCH ── */
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [{ data: u }, { data: ud }, { data: cc }, { data: au }] = await Promise.all([
                supabase.from("users").select("*").eq("id", id).single(),
                supabase.from("user_data").select("*").eq("user_id", id).maybeSingle(),
                supabase.from("clusters_main_data").select("*").eq("user_id", id),
                supabase.from("users").select("id, email, auth_provider_id, global_role"),
            ]);
            if (u)  { setUser(u); setDraftUser({ ...u }); }
            if (ud) { setUserData(ud); setDraftUserData({ ...ud }); }
            if (cc) { setClusters(cc); setDraftClusters(cc.map((c: Cluster) => ({ ...c }))); }
            if (au) setAllUsers(au);
            setLoading(false);
        };
        load();
    }, [id]);

    /* ── SAVE USERS TABLE ── */
    const saveUser = async (force = false) => {
        if (!draftUser || !user) return;
        const found = await checkUserConflicts(user, draftUser, allUsers);
        setConflicts(found);
        const blockers = found.filter(c => c.severity === "block");
        if (blockers.length > 0) { showToast(`${blockers.length} blocking conflict(s) must be fixed.`, "error"); return; }
        if (!force && found.filter(c => c.severity === "warn").length > 0) { setConfirmOpen(true); return; }
        setConfirmOpen(false);
        setSaving(true);
        // only send editable fields
        const patch: Partial<User> = {};
        (Object.keys(draftUser) as (keyof User)[]).forEach(k => {
            if (!LOCKED_USER.has(k)) (patch as any)[k] = draftUser[k] ?? null;
        });
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase.from("users").update(patch).eq("id", user.id);
        if (error) showToast(error.message, "error");
        else { setUser({ ...user, ...patch }); setDraftUser({ ...user, ...patch }); setEditingUser(false); setConflicts([]); showToast("User saved ✓"); }
        setSaving(false);
    };

    /* ── SAVE USER_DATA TABLE ── */
    const saveUserData = async () => {
        if (!draftUserData || !userData) return;
        setSaving(true);
        const patch: Partial<UserData> = {};
        (Object.keys(draftUserData) as (keyof UserData)[]).forEach(k => {
            if (!LOCKED_UDATA.has(k)) (patch as any)[k] = draftUserData[k] ?? null;
        });
        // validate CHECK constraints
        if (patch.govt_id_type && !ALLOWED.govt_id_type.includes(patch.govt_id_type)) {
            showToast(`Invalid govt_id_type. Allowed: ${ALLOWED.govt_id_type.join(", ")}`, "error"); setSaving(false); return;
        }
        if (patch.verification_status && !ALLOWED.verification_status.includes(patch.verification_status)) {
            showToast(`Invalid verification_status.`, "error"); setSaving(false); return;
        }
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase.from("user_data").update(patch).eq("id", userData.id);
        if (error) showToast(error.message, "error");
        else { setUserData({ ...userData, ...patch }); setDraftUserData({ ...userData, ...patch }); setEditingUserData(false); showToast("Profile saved ✓"); }
        setSaving(false);
    };

    /* ── SAVE CLUSTER ── */
    const saveCluster = async (clusterId: string) => {
        const draft = draftClusters.find(c => c.id === clusterId);
        const original = clusters.find(c => c.id === clusterId);
        if (!draft || !original) return;
        setSaving(true);
        const patch: Record<string, any> = {};
        Object.keys(draft).forEach(k => {
            if (!LOCKED_CLUSTER.has(k)) patch[k] = draft[k] ?? null;
        });
        // validate CHECK constraints
        for (const [field, allowed] of Object.entries(ALLOWED)) {
            if (patch[field] !== undefined && !allowed.includes(patch[field])) {
                showToast(`Invalid ${field}. Allowed: ${allowed.join(", ")}`, "error"); setSaving(false); return;
            }
        }
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase.from("clusters_main_data").update(patch).eq("id", clusterId);
        if (error) showToast(error.message, "error");
        else {
            setClusters(prev => prev.map(c => c.id === clusterId ? { ...c, ...patch } : c));
            setDraftClusters(prev => prev.map(c => c.id === clusterId ? { ...c, ...patch } : c));
            setEditingClusterId(null);
            showToast("Cluster saved ✓");
        }
        setSaving(false);
    };

    const cancelUser     = () => { setDraftUser(user ? { ...user } : null); setEditingUser(false); setConflicts([]); };
    const cancelUserData = () => { setDraftUserData(userData ? { ...userData } : null); setEditingUserData(false); };
    const cancelCluster  = (id: string) => { setDraftClusters(prev => prev.map(c => c.id === id ? { ...clusters.find(x => x.id === id)! } : c)); setEditingClusterId(null); };

    if (loading) return <div className="loading-pg"><div className="spinner" /><span>Loading…</span></div>;
    if (!user)   return <div className="loading-pg"><span style={{ color: "#ef4444" }}>User not found.</span></div>;

    return (
        <div className="pg">

            {/* CONFIRM DIALOG */}
            {confirmOpen && (
                <div className="overlay" onClick={() => setConfirmOpen(false)}>
                    <div className="confirm-modal" onClick={e => e.stopPropagation()}>
                        <div className="confirm-icon">⚠️</div>
                        <h3 className="confirm-title">Save with warnings?</h3>
                        <p className="confirm-sub">These changes are allowed but may cause issues:</p>
                        <div className="confirm-warns">
                            {conflicts.filter(c => c.severity === "warn").map((c, i) => (
                                <div className="conflict-item warn" key={i}>
                                    <span className="cf-field">{c.field}</span>
                                    <span className="cf-msg">{c.message}</span>
                                </div>
                            ))}
                        </div>
                        <div className="confirm-btns">
                            <button className="btn-cancel" onClick={() => setConfirmOpen(false)}>Go back</button>
                            <button className="btn-warn-save" onClick={() => saveUser(true)}>Save anyway</button>
                        </div>
                    </div>
                </div>
            )}

            {/* TOAST */}
            {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

            {/* HEADER */}
            <header className="hdr">
                <button className="back-btn" onClick={() => router.push("/admin")}>← Admin</button>
                <div className="hdr-center">
                    <div className="hdr-av">{user.email?.[0]?.toUpperCase()}</div>
                    <div>
                        <div className="hdr-name">{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}</div>
                        <div className="hdr-id mono">{user.id}</div>
                    </div>
                </div>
                <div className="hdr-right">
                    <span className="role-badge">{user.global_role || "user"}</span>
                    <span className="provider-badge">{user.auth_provider}</span>
                </div>
            </header>

            <div className="body">

                {/* CONFLICTS */}
                {conflicts.length > 0 && (
                    <div className="conflicts-panel">
                        <div className="cp-title">⛔ {conflicts.filter(c => c.severity === "block").length} blocking · ⚠️ {conflicts.filter(c => c.severity === "warn").length} warnings</div>
                        {conflicts.map((c, i) => (
                            <div key={i} className={`conflict-item ${c.severity}`}>
                                <span className="cf-field">{c.field}</span>
                                <span className="cf-msg">{c.message}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* ── USERS TABLE ── */}
                <Section
                    tag="users"
                    title="Authentication Record"
                    note="🔒 id, auth_provider, auth_provider_id, created_at, updated_at, last_login are locked."
                    editing={editingUser}
                    saving={saving}
                    onEdit={() => setEditingUser(true)}
                    onSave={() => saveUser()}
                    onCancel={cancelUser}
                >
                    {draftUser && ([
                        { k: "id",               label: "ID (Primary Key)",      locked: true  },
                        { k: "auth_provider",    label: "Auth Provider",         locked: true  },
                        { k: "auth_provider_id", label: "Auth Provider ID",      locked: true  },
                        { k: "email",            label: "Email",                 locked: false },
                        { k: "first_name",       label: "First Name",            locked: false },
                        { k: "last_name",        label: "Last Name",             locked: false },
                        { k: "global_role",      label: "Global Role",           locked: false, allowed: ALLOWED.global_role },
                        { k: "default_app",      label: "Default App",           locked: false },
                        { k: "avatar_url",       label: "Avatar URL",            locked: false },
                        { k: "last_login",       label: "Last Login",            locked: true  },
                        { k: "created_at",       label: "Created At",            locked: true  },
                        { k: "updated_at",       label: "Updated At",            locked: true  },
                    ] as FieldDef[]).map(f => (
                        <Field
                            key={f.k} def={f} editing={editingUser}
                            value={(draftUser as any)[f.k]}
                            original={(user as any)[f.k]}
                            hasConflict={conflicts.some(c => c.field === f.k && c.severity === "block")}
                            hasWarn={conflicts.some(c => c.field === f.k && c.severity === "warn")}
                            onChange={v => setDraftUser(p => p ? { ...p, [f.k]: v } : p)}
                        />
                    ))}
                </Section>

                {/* ── USER_DATA TABLE ── */}
                {userData && draftUserData && (
                    <Section
                        tag="user_data"
                        title="Profile & KYC Data"
                        note="🔒 id, user_id, created_at, updated_at are locked."
                        editing={editingUserData}
                        saving={saving}
                        onEdit={() => setEditingUserData(true)}
                        onSave={saveUserData}
                        onCancel={cancelUserData}
                    >
                        {([
                            { k: "id",                      label: "ID (Primary Key)",      locked: true  },
                            { k: "user_id",                 label: "User ID (FK)",          locked: true  },
                            { k: "full_name",               label: "Full Name",             locked: false },
                            { k: "dob",                     label: "Date of Birth",         locked: false },
                            { k: "address",                 label: "Address",               locked: false },
                            { k: "govt_id_type",            label: "Govt ID Type",          locked: false, allowed: ALLOWED.govt_id_type },
                            { k: "govt_id_number",          label: "Govt ID Number",        locked: false },
                            { k: "monthly_revenue_bracket", label: "Monthly Revenue",       locked: false },
                            { k: "verification_status",     label: "Verification Status",   locked: false, allowed: ALLOWED.verification_status },
                            { k: "created_at",              label: "Created At",            locked: true  },
                            { k: "updated_at",              label: "Updated At",            locked: true  },
                        ] as FieldDef[]).map(f => (
                            <Field
                                key={f.k} def={f} editing={editingUserData}
                                value={(draftUserData as any)[f.k]}
                                original={(userData as any)[f.k]}
                                hasConflict={false} hasWarn={false}
                                onChange={v => setDraftUserData(p => p ? { ...p, [f.k]: v } : p)}
                            />
                        ))}
                    </Section>
                )}

                {/* ── CLUSTERS ── */}
                <div className="section">
                    <div className="section-hdr">
                        <div>
                            <span className="section-tag">clusters_main_data</span>
                            <h2 className="section-title">Linked Clusters ({clusters.length})</h2>
                            <p className="section-note">🔒 id, user_id, created_at, updated_at are locked. Each cluster can be edited independently.</p>
                        </div>
                    </div>

                    {clusters.length === 0
                        ? <div className="empty">No clusters linked to this user.</div>
                        : clusters.map(c => {
                            const draft = draftClusters.find(x => x.id === c.id)!;
                            const isEditing = editingClusterId === c.id;
                            const s = c.approval_status === "approved" ? { color: "#34d399", bg: "rgba(52,211,153,.1)" }
                                    : c.approval_status === "rejected" ? { color: "#ef4444", bg: "rgba(239,68,68,.1)" }
                                    : { color: "#f59e0b", bg: "rgba(245,158,11,.1)" };
                            return (
                                <div key={c.id} className="cluster-block">
                                    <div className="cluster-block-hdr">
                                        <div className="cluster-block-left">
                                            <div className="cluster-ic">⬡</div>
                                            <div>
                                                <div className="cluster-name">{c.farm_name}</div>
                                                <div className="mono dim" style={{ fontSize: ".62rem" }}>{c.id}</div>
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                                            <span className="badge" style={{ color: s.color, background: s.bg }}>{c.approval_status}</span>
                                            {!isEditing
                                                ? <button className="edit-btn" onClick={() => setEditingClusterId(c.id)}><EditIcon /> Edit</button>
                                                : <div className="edit-actions">
                                                    <button className="cancel-btn" onClick={() => cancelCluster(c.id)}>Cancel</button>
                                                    <button className="save-btn" onClick={() => saveCluster(c.id)} disabled={saving}>{saving ? "Saving…" : "Save →"}</button>
                                                  </div>
                                            }
                                        </div>
                                    </div>
                                    <div className="fields-grid">
                                        {([
                                            { k: "id",                    label: "ID (PK)",              locked: true  },
                                            { k: "user_id",               label: "User ID (FK)",         locked: true  },
                                            { k: "full_name",             label: "Full Name",            locked: false },
                                            { k: "farm_name",             label: "Farm Name",            locked: false },
                                            { k: "crop_type",             label: "Crop Type",            locked: false },
                                            { k: "farm_type",             label: "Farm Type",            locked: false },
                                            { k: "soil_type",             label: "Soil Type",            locked: false },
                                            { k: "irrigation_type",       label: "Irrigation Type",      locked: false },
                                            { k: "climate_category",      label: "Climate Category",     locked: false },
                                            { k: "connectivity_type",     label: "Connectivity",         locked: false },
                                            { k: "land_area",             label: "Land Area",            locked: false },
                                            { k: "area_unit",             label: "Area Unit",            locked: false, allowed: ALLOWED.area_unit },
                                            { k: "govt_id_type",          label: "Govt ID Type",         locked: false, allowed: ALLOWED.govt_id_type },
                                            { k: "govt_id_number",        label: "Govt ID Number",       locked: false },
                                            { k: "monthly_revenue_range", label: "Monthly Revenue",      locked: false },
                                            { k: "provisioning_mode",     label: "Provisioning Mode",    locked: false, allowed: ALLOWED.provisioning_mode },
                                            { k: "compute_tier",          label: "Compute Tier",         locked: false, allowed: ALLOWED.compute_tier },
                                            { k: "billing_frequency",     label: "Billing Frequency",    locked: false, allowed: ALLOWED.billing_frequency },
                                            { k: "payment_method",        label: "Payment Method",       locked: false, allowed: ALLOWED.payment_method },
                                            { k: "plan_id",               label: "Plan ID",              locked: false },
                                            { k: "sensor_nodes",          label: "Sensor Nodes",         locked: false },
                                            { k: "approval_status",       label: "Approval Status",      locked: false, allowed: ALLOWED.approval_status },
                                            { k: "address",               label: "Address",              locked: false },
                                            { k: "created_at",            label: "Created At",           locked: true  },
                                            { k: "updated_at",            label: "Updated At",           locked: true  },
                                        ] as FieldDef[]).map(f => (
                                            <Field
                                                key={f.k} def={f} editing={isEditing}
                                                value={draft[f.k]}
                                                original={c[f.k]}
                                                hasConflict={false} hasWarn={false}
                                                onChange={v => setDraftClusters(prev => prev.map(x => x.id === c.id ? { ...x, [f.k]: v } : x))}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    }
                </div>

            </div>

            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
                *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
                :root{--bg:#080807;--s1:#0f0f0e;--s2:#141413;--s3:#1a1a18;--s4:#212120;--b0:rgba(255,255,255,.05);--b1:rgba(255,255,255,.09);--b2:rgba(255,255,255,.15);--t0:#f0f0ec;--t1:rgba(240,240,236,.6);--t2:rgba(240,240,236,.32);--t3:rgba(240,240,236,.15);--g0:#10b981;--g1:#34d399;--ga:rgba(16,185,129,.07);--gb:rgba(16,185,129,.14);--font:'Instrument Sans',-apple-system,sans-serif;--mono:'JetBrains Mono',monospace}
                html,body{background:var(--bg);color:var(--t0);font-family:var(--font);-webkit-font-smoothing:antialiased}
                .loading-pg{min-height:100vh;display:flex;align-items:center;justify-content:center;gap:1rem;background:var(--bg);color:var(--t2);flex-direction:column;font-size:.9rem}
                .spinner{width:28px;height:28px;border:2px solid var(--b1);border-top-color:var(--g0);border-radius:50%;animation:spin .7s linear infinite}
                @keyframes spin{to{transform:rotate(360deg)}}
                .pg{min-height:100vh;background:var(--bg)}
                /* TOAST */
                .toast{position:fixed;bottom:1.5rem;right:1.5rem;z-index:999;padding:.72rem 1.2rem;border-radius:10px;font-size:.83rem;font-weight:500;animation:slideUp .3s ease;box-shadow:0 8px 32px -8px rgba(0,0,0,.5)}
                .toast-success{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.25);color:#34d399}
                .toast-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);color:#ef4444}
                .toast-warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);color:#f59e0b}
                @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
                /* HEADER */
                .hdr{display:flex;align-items:center;gap:1.5rem;padding:1.1rem 2rem;background:var(--s1);border-bottom:1px solid var(--b0);position:sticky;top:0;z-index:40;flex-wrap:wrap}
                .back-btn{background:none;border:none;font-family:var(--font);font-size:.82rem;color:var(--t2);cursor:pointer;padding:.3rem .6rem;border-radius:6px;transition:color .15s,background .15s}
                .back-btn:hover{color:var(--t0);background:var(--s2)}
                .hdr-center{display:flex;align-items:center;gap:.85rem;flex:1}
                .hdr-av{width:36px;height:36px;border-radius:9px;background:var(--gb);border:1px solid rgba(16,185,129,.3);display:flex;align-items:center;justify-content:center;font-size:.95rem;font-weight:700;color:var(--g1);flex-shrink:0}
                .hdr-name{font-size:.92rem;font-weight:700;letter-spacing:-.02em;color:var(--t0)}
                .hdr-id{font-size:.58rem;color:var(--t3);letter-spacing:.03em;margin-top:.1rem}
                .hdr-right{display:flex;gap:.5rem;flex-shrink:0}
                .role-badge,.provider-badge{font-family:var(--mono);font-size:.6rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;padding:.2rem .55rem;border-radius:5px}
                .role-badge{color:var(--g1);background:var(--ga);border:1px solid rgba(16,185,129,.18)}
                .provider-badge{color:#a78bfa;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.18)}
                /* BODY */
                .body{max-width:1020px;margin:0 auto;padding:2rem;display:flex;flex-direction:column;gap:1.75rem}
                /* CONFLICTS */
                .conflicts-panel{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:1.1rem 1.4rem;display:flex;flex-direction:column;gap:.6rem}
                .cp-title{font-size:.82rem;font-weight:700;color:#ef4444}
                .conflict-item{padding:.6rem .9rem;border-radius:8px;display:flex;flex-direction:column;gap:.2rem}
                .conflict-item.block{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.18)}
                .conflict-item.warn{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.18)}
                .cf-field{font-family:var(--mono);font-size:.68rem;font-weight:600;color:#ef4444}
                .conflict-item.warn .cf-field{color:#f59e0b}
                .cf-msg{font-size:.8rem;color:var(--t1);line-height:1.5}
                /* SECTION */
                .section{background:var(--s2);border:1px solid var(--b1);border-radius:16px;overflow:hidden}
                .section-hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1.25rem 1.4rem;border-bottom:1px solid var(--b0)}
                .section-tag{font-family:var(--mono);font-size:.6rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--g0);display:block;margin-bottom:.35rem}
                .section-title{font-size:.95rem;font-weight:700;letter-spacing:-.025em;color:var(--t0);margin-bottom:.3rem}
                .section-note{font-size:.75rem;color:var(--t2);line-height:1.55;max-width:560px}
                .section-note strong{color:var(--t0)}
                /* EDIT BUTTONS */
                .edit-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.42rem .9rem;background:var(--s3);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.78rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;flex-shrink:0}
                .edit-btn:hover{background:var(--s4);color:var(--t0)}
                .edit-actions{display:flex;gap:.5rem;flex-shrink:0}
                .cancel-btn{padding:.42rem .88rem;background:var(--s3);color:var(--t2);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.78rem;font-weight:500;cursor:pointer}
                .cancel-btn:hover{background:var(--s4);color:var(--t0)}
                .save-btn{padding:.42rem 1rem;background:var(--g0);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:.78rem;font-weight:600;cursor:pointer;transition:opacity .2s}
                .save-btn:hover{opacity:.88}.save-btn:disabled{opacity:.5;cursor:default}
                /* FIELDS GRID */
                .fields-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}
                /* CLUSTER BLOCK */
                .cluster-block{background:var(--s2);border:1px solid var(--b1);border-radius:14px;overflow:hidden;margin-bottom:1rem}
                .cluster-block:last-child{margin-bottom:0}
                .cluster-block-hdr{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--b0);background:var(--s3);flex-wrap:wrap;gap:.75rem}
                .cluster-block-left{display:flex;align-items:center;gap:.75rem}
                .cluster-ic{width:28px;height:28px;border-radius:7px;background:var(--ga);border:1px solid rgba(16,185,129,.14);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0}
                .cluster-name{font-size:.88rem;font-weight:700;color:var(--t0);margin-bottom:.15rem}
                .badge{display:inline-flex;align-items:center;padding:.16rem .5rem;border-radius:5px;font-family:var(--mono);font-size:.6rem;font-weight:600;letter-spacing:.05em;white-space:nowrap}
                .empty{padding:2rem;text-align:center;color:var(--t3);font-size:.85rem}
                .mono{font-family:var(--mono)}.dim{color:var(--t2)}
                /* CONFIRM MODAL */
                .overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:center;justify-content:center;padding:2rem}
                .confirm-modal{background:var(--s2);border:1px solid rgba(245,158,11,.25);border-radius:18px;width:100%;max-width:480px;padding:1.75rem;box-shadow:0 40px 80px -20px rgba(0,0,0,.7)}
                .confirm-icon{font-size:1.5rem;margin-bottom:.75rem}
                .confirm-title{font-size:.95rem;font-weight:700;color:var(--t0);margin-bottom:.4rem}
                .confirm-sub{font-size:.83rem;color:var(--t1);margin-bottom:1rem;line-height:1.55}
                .confirm-warns{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1.4rem}
                .confirm-btns{display:flex;gap:.65rem;justify-content:flex-end}
                .btn-cancel{padding:.58rem 1.1rem;background:var(--s3);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.82rem;font-weight:500;cursor:pointer}
                .btn-warn-save{padding:.58rem 1.3rem;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.25);border-radius:8px;font-family:var(--font);font-size:.82rem;font-weight:600;cursor:pointer}
                @media(max-width:768px){.fields-grid{grid-template-columns:1fr}.hdr{padding:1rem 1.25rem}.body{padding:1.25rem}}
            `}</style>
        </div>
    );
}

/* ══════════════════════════════════════════════════
   SECTION WRAPPER
══════════════════════════════════════════════════ */
function Section({ tag, title, note, editing, saving, onEdit, onSave, onCancel, children }: {
    tag: string; title: string; note: string;
    editing: boolean; saving: boolean;
    onEdit: () => void; onSave: () => void; onCancel: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="section">
            <div className="section-hdr">
                <div>
                    <span className="section-tag">{tag}</span>
                    <h2 className="section-title">{title}</h2>
                    <p className="section-note">{note}</p>
                </div>
                {!editing
                    ? <button className="edit-btn" onClick={onEdit}><EditIcon /> Edit</button>
                    : <div className="edit-actions">
                        <button className="cancel-btn" onClick={onCancel}>Cancel</button>
                        <button className="save-btn" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save →"}</button>
                      </div>
                }
            </div>
            <div className="fields-grid">{children}</div>
        </div>
    );
}

/* ══════════════════════════════════════════════════
   FIELD ROW
══════════════════════════════════════════════════ */
type FieldDef = { k: string; label: string; locked: boolean; allowed?: string[] };

function Field({ def, editing, value, original, hasConflict, hasWarn, onChange }: {
    def: FieldDef;
    editing: boolean;
    value: any;
    original: any;
    hasConflict: boolean;
    hasWarn: boolean;
    onChange: (v: string) => void;
}) {
    const isDirty  = editing && String(value ?? "") !== String(original ?? "");
    const display  = value === null || value === undefined ? "" : String(value);

    return (
        <div className={`fr ${def.locked ? "fr-locked" : ""} ${hasConflict ? "fr-conflict" : ""} ${hasWarn ? "fr-warn" : ""} ${isDirty ? "fr-dirty" : ""}`}>
            <div className="fr-label-row">
                <span className="fr-label">{def.label}</span>
                {def.locked  && <span className="tag-lock">🔒 locked</span>}
                {isDirty     && <span className="tag-dirty">modified</span>}
                {hasConflict && <span className="tag-conflict">⛔ conflict</span>}
                {hasWarn     && <span className="tag-warn">⚠️ warning</span>}
            </div>

            {editing && !def.locked ? (
                def.allowed ? (
                    <select className="fr-select" value={display} onChange={e => onChange(e.target.value)}>
                        {def.allowed.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                ) : (
                    <input
                        className={`fr-input ${hasConflict ? "fr-input-err" : ""} ${hasWarn ? "fr-input-warn" : ""}`}
                        value={display}
                        onChange={e => onChange(e.target.value)}
                        placeholder={`Enter ${def.label.toLowerCase()}…`}
                    />
                )
            ) : (
                <div className="fr-value">{display || <span className="fr-null">null</span>}</div>
            )}

            <style jsx>{`
                .fr{background:var(--s2);padding:.9rem 1.15rem;display:flex;flex-direction:column;gap:.32rem;border-left:3px solid transparent;transition:background .15s}
                .fr:hover{background:var(--s3)}
                .fr-locked{opacity:.65}.fr-locked:hover{background:var(--s2)}
                .fr-dirty{border-left-color:var(--g0);background:rgba(16,185,129,.03)}
                .fr-conflict{border-left-color:#ef4444;background:rgba(239,68,68,.04)}
                .fr-warn{border-left-color:#f59e0b;background:rgba(245,158,11,.03)}
                .fr-label-row{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
                .fr-label{font-family:var(--mono);font-size:.6rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--t3)}
                .tag-lock,.tag-dirty,.tag-conflict,.tag-warn{font-family:var(--mono);font-size:.56rem;padding:.06rem .32rem;border-radius:4px}
                .tag-lock{color:var(--t3);background:var(--s3);border:1px solid var(--b0)}
                .tag-dirty{color:var(--g0);background:var(--ga);border:1px solid rgba(16,185,129,.18)}
                .tag-conflict{color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2)}
                .tag-warn{color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2)}
                .fr-value{font-size:.85rem;color:var(--t0);word-break:break-all;line-height:1.5}
                .fr-null{color:var(--t3);font-style:italic;font-size:.78rem}
                .fr-input{background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:7px;padding:.5rem .75rem;font-family:var(--font);font-size:.85rem;outline:none;width:100%;transition:border-color .2s,box-shadow .2s}
                .fr-input:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .fr-input-err{border-color:rgba(239,68,68,.4) !important}
                .fr-input-warn{border-color:rgba(245,158,11,.35) !important}
                .fr-select{background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:7px;padding:.5rem .75rem;font-family:var(--font);font-size:.85rem;outline:none;width:100%;cursor:pointer;transition:border-color .2s}
                .fr-select:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .fr-select option{background:var(--s3);color:var(--t0)}
            `}</style>
        </div>
    );
}

const EditIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;