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
};

type Conflict = {
    field: string;
    severity: "block" | "warn";
    message: string;
};

/* ── CHECK constraint values ── */
const ALLOWED: Record<string, string[]> = {
    global_role:      ["user", "admin", "moderator"],
    govt_id_type:     ["aadhaar", "pan", "passport", "driving"],
    verification_status: ["pending", "verified", "rejected"],
    approval_status:  ["pending", "approved", "rejected"],
    compute_tier:     ["starter", "standard", "advanced"],
    billing_frequency:["monthly", "annual"],
    payment_method:   ["card", "upi"],
    area_unit:        ["acres", "hectares"],
    provisioning_mode:["auto", "custom"],
};

/* ── Fields that are LOCKED (PKs / referenced FKs) ── */
const LOCKED_USER_FIELDS = ["id", "created_at", "auth_provider", "auth_provider_id"];
const LOCKED_USER_DATA_FIELDS = ["id", "user_id", "created_at"];

function relTime(d: string | null) {
    if (!d) return "—";
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/* ═══════════════════════════════════════════
   CONFLICT CHECKER
═══════════════════════════════════════════ */
async function checkConflicts(
    original: User,
    edited: User,
    allUsers: User[]
): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // 1. auth_provider_id UNIQUE constraint
    if (edited.auth_provider_id !== original.auth_provider_id) {
        const duplicate = allUsers.find(
            u => u.id !== original.id &&
            u.auth_provider_id === edited.auth_provider_id.trim()
        );
        if (duplicate) {
            conflicts.push({
                field: "auth_provider_id",
                severity: "block",
                message: `auth_provider_id "${edited.auth_provider_id}" is already used by user ${duplicate.email}. This UNIQUE constraint will break the table.`,
            });
        } else {
            conflicts.push({
                field: "auth_provider_id",
                severity: "warn",
                message: "Changing auth_provider_id will break the Kinde authentication link for this user. They will not be able to log in.",
            });
        }
    }

    // 2. email uniqueness warning
    if (edited.email !== original.email) {
        const duplicate = allUsers.find(
            u => u.id !== original.id &&
            u.email?.toLowerCase() === edited.email?.toLowerCase().trim()
        );
        if (duplicate) {
            conflicts.push({
                field: "email",
                severity: "block",
                message: `Email "${edited.email}" is already registered to another user (${duplicate.id.slice(0, 8)}…). Duplicate emails will cause authentication confusion.`,
            });
        } else {
            conflicts.push({
                field: "email",
                severity: "warn",
                message: "Changing email will not update the Kinde auth provider — the user will still log in with their original email unless updated there too.",
            });
        }
    }

    // 3. global_role CHECK
    if (edited.global_role && !ALLOWED.global_role.includes(edited.global_role)) {
        conflicts.push({
            field: "global_role",
            severity: "block",
            message: `"${edited.global_role}" is not a valid role. Allowed: ${ALLOWED.global_role.join(", ")}.`,
        });
    }

    return conflicts;
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════ */
export default function AdminUserPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const [user, setUser]         = useState<User | null>(null);
    const [userData, setUserData] = useState<UserData | null>(null);
    const [clusters, setClusters] = useState<Cluster[]>([]);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [loading, setLoading]   = useState(true);

    const [editUser, setEditUser]         = useState<User | null>(null);
    const [editUserData, setEditUserData] = useState<UserData | null>(null);
    const [editingSection, setEditingSection] = useState<"user" | "userdata" | null>(null);

    const [conflicts, setConflicts] = useState<Conflict[]>([]);
    const [saving, setSaving]       = useState(false);
    const [toast, setToast]         = useState<{ msg: string; type: "success" | "error" | "warn" } | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const showToast = (msg: string, type: "success" | "error" | "warn" = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    };

    /* ── FETCH ── */
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [
                { data: u },
                { data: ud },
                { data: cc },
                { data: au },
            ] = await Promise.all([
                supabase.from("users").select("*").eq("id", id).single(),
                supabase.from("user_data").select("*").eq("user_id", id).maybeSingle(),
                supabase.from("clusters_main_data").select("id, farm_name, crop_type, approval_status, compute_tier, billing_frequency, land_area, area_unit, created_at").eq("user_id", id),
                supabase.from("users").select("id, email, auth_provider_id, global_role"),
            ]);
            if (u)  { setUser(u); setEditUser({ ...u }); }
            if (ud) { setUserData(ud); setEditUserData({ ...ud }); }
            if (cc) setClusters(cc);
            if (au) setAllUsers(au);
            setLoading(false);
        };
        load();
    }, [id]);

    /* ── START EDIT ── */
    const startEdit = (section: "user" | "userdata") => {
        setConflicts([]);
        setEditingSection(section);
    };

    const cancelEdit = () => {
        setEditingSection(null);
        setConflicts([]);
        if (user)     setEditUser({ ...user });
        if (userData) setEditUserData({ ...userData });
    };

    /* ── PRE-SAVE: CHECK CONFLICTS ── */
    const preSave = async () => {
        if (!editUser || !user) return;
        const found = await checkConflicts(user, editUser, allUsers);
        setConflicts(found);

        const blockers = found.filter(c => c.severity === "block");
        if (blockers.length > 0) {
            showToast(`${blockers.length} blocking conflict(s) must be resolved before saving.`, "error");
            return;
        }

        // if only warnings, open confirm dialog
        if (found.filter(c => c.severity === "warn").length > 0) {
            setConfirmOpen(true);
            return;
        }

        // no conflicts → save directly
        await doSave();
    };

    /* ── SAVE ── */
    const doSave = async () => {
        setConfirmOpen(false);
        setSaving(true);

        try {
            if (editingSection === "user" && editUser && user) {
                // Strip locked fields before patching
                const { id: _id, created_at: _ca, auth_provider: _ap, auth_provider_id: _api, ...patch } = editUser;
                const { error } = await supabase.from("users").update({
                    ...patch,
                    updated_at: new Date().toISOString(),
                }).eq("id", user.id);
                if (error) throw error;
                setUser({ ...editUser, updated_at: new Date().toISOString() });
                showToast("User updated successfully ✓");
            }

            if (editingSection === "userdata" && editUserData && userData) {
                // Strip locked fields
                const { id: _id, user_id: _uid, created_at: _ca, ...patch } = editUserData;

                // Validate CHECK constraints
                if (patch.govt_id_type && !ALLOWED.govt_id_type.includes(patch.govt_id_type)) {
                    throw new Error(`Invalid govt_id_type. Allowed: ${ALLOWED.govt_id_type.join(", ")}`);
                }
                if (patch.verification_status && !ALLOWED.verification_status.includes(patch.verification_status)) {
                    throw new Error(`Invalid verification_status. Allowed: ${ALLOWED.verification_status.join(", ")}`);
                }

                const { error } = await supabase.from("user_data").update({
                    ...patch,
                    updated_at: new Date().toISOString(),
                }).eq("id", userData.id);
                if (error) throw error;
                setUserData({ ...editUserData, updated_at: new Date().toISOString() });
                showToast("Profile data updated successfully ✓");
            }

            setEditingSection(null);
            setConflicts([]);
        } catch (e: any) {
            showToast(e?.message || "Save failed", "error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="loading-page">
            <div className="spinner" />
            <span>Loading user profile…</span>
        </div>
    );

    if (!user) return (
        <div className="loading-page">
            <span style={{ color: "#ef4444" }}>User not found.</span>
            <button className="back-btn" onClick={() => router.push("/admin")}>← Back to Admin</button>
        </div>
    );

    const isEditing = editingSection !== null;

    return (
        <div className="page">

            {/* TOAST */}
            {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}

            {/* CONFIRM DIALOG */}
            {confirmOpen && (
                <div className="overlay" onClick={() => setConfirmOpen(false)}>
                    <div className="confirm-modal" onClick={e => e.stopPropagation()}>
                        <div className="confirm-icon"><WarnIcon /></div>
                        <h3 className="confirm-title">Confirm save with warnings</h3>
                        <p className="confirm-sub">The following warnings were detected. These changes are allowed but may cause issues:</p>
                        <div className="confirm-warns">
                            {conflicts.filter(c => c.severity === "warn").map((c, i) => (
                                <div className="conflict-item warn" key={i}>
                                    <span className="conflict-field">{c.field}</span>
                                    <span className="conflict-msg">{c.message}</span>
                                </div>
                            ))}
                        </div>
                        <div className="confirm-actions">
                            <button className="confirm-cancel" onClick={() => setConfirmOpen(false)}>Cancel — go back</button>
                            <button className="confirm-proceed" onClick={doSave}>I understand — save anyway</button>
                        </div>
                    </div>
                </div>
            )}

            {/* HEADER */}
            <header className="hdr">
                <button className="back-link" onClick={() => router.push("/admin")}>
                    ← Admin
                </button>
                <div className="hdr-center">
                    <div className="hdr-av">{user.email?.[0]?.toUpperCase()}</div>
                    <div>
                        <div className="hdr-name">{user.first_name || user.last_name ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() : user.email}</div>
                        <div className="hdr-sub mono">{user.id}</div>
                    </div>
                </div>
                <div className="hdr-badges">
                    <span className="badge-role">{user.global_role || "user"}</span>
                    <span className="badge-provider">{user.auth_provider}</span>
                </div>
            </header>

            <div className="body">

                {/* ── CONFLICTS PANEL ── */}
                {conflicts.length > 0 && (
                    <div className="conflicts-panel">
                        <div className="conflicts-title">
                            <AlertIcon />
                            {conflicts.filter(c => c.severity === "block").length} blocking · {conflicts.filter(c => c.severity === "warn").length} warnings
                        </div>
                        {conflicts.map((c, i) => (
                            <div className={`conflict-item ${c.severity}`} key={i}>
                                <div className="conflict-field">
                                    {c.severity === "block" ? <BlockIcon /> : <WarnIcon />}
                                    {c.field}
                                </div>
                                <div className="conflict-msg">{c.message}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ── USERS TABLE ── */}
                <section className="section">
                    <div className="section-hdr">
                        <div>
                            <span className="section-tag">users</span>
                            <h2 className="section-title">Authentication Record</h2>
                            <p className="section-note">
                                🔒 <strong>id</strong>, <strong>auth_provider</strong>, <strong>auth_provider_id</strong>, <strong>created_at</strong> are locked — editing them would break Kinde auth and downstream FK references.
                            </p>
                        </div>
                        {!isEditing && (
                            <button className="edit-btn" onClick={() => startEdit("user")}>
                                <EditIcon /> Edit
                            </button>
                        )}
                        {editingSection === "user" && (
                            <div className="edit-actions">
                                <button className="cancel-btn" onClick={cancelEdit}>Cancel</button>
                                <button className="save-btn" onClick={preSave} disabled={saving}>
                                    {saving ? <><span className="btn-spinner" /> Saving…</> : "Save changes →"}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="fields-grid">
                        {([
                            { key: "id",                 label: "ID (Primary Key)",       locked: true,  note: "PK — referenced by user_data.user_id FK. Never editable." },
                            { key: "auth_provider",      label: "Auth Provider",           locked: true,  note: "Locked — changing breaks Kinde integration." },
                            { key: "auth_provider_id",   label: "Auth Provider ID",        locked: true,  note: "UNIQUE constraint. Locked — changing breaks auth login flow." },
                            { key: "email",              label: "Email",                   locked: false, note: "No DB unique constraint but functionally unique. Changing here does NOT update Kinde." },
                            { key: "first_name",         label: "First Name",              locked: false },
                            { key: "last_name",          label: "Last Name",               locked: false },
                            { key: "global_role",        label: "Global Role",             locked: false, allowed: ALLOWED.global_role },
                            { key: "default_app",        label: "Default App",             locked: false },
                            { key: "avatar_url",         label: "Avatar URL",              locked: false },
                            { key: "last_login",         label: "Last Login",              locked: true,  note: "Set automatically by the auth system." },
                            { key: "created_at",         label: "Created At",              locked: true,  note: "Immutable — auto-set on row creation." },
                            { key: "updated_at",         label: "Updated At",              locked: true,  note: "Auto-updated by the system." },
                        ] as { key: keyof User; label: string; locked: boolean; note?: string; allowed?: string[] }[]).map(f => (
                            <FieldRow
                                key={f.key}
                                label={f.label}
                                value={editUser?.[f.key] ?? null}
                                originalValue={user[f.key] ?? null}
                                locked={f.locked}
                                note={f.note}
                                allowed={f.allowed}
                                editing={editingSection === "user"}
                                onChange={val => setEditUser(prev => prev ? { ...prev, [f.key]: val } : prev)}
                                hasConflict={conflicts.some(c => c.field === f.key && c.severity === "block")}
                                hasWarn={conflicts.some(c => c.field === f.key && c.severity === "warn")}
                            />
                        ))}
                    </div>
                </section>

                {/* ── USER_DATA TABLE ── */}
                {userData && editUserData && (
                    <section className="section">
                        <div className="section-hdr">
                            <div>
                                <span className="section-tag">user_data</span>
                                <h2 className="section-title">Profile & KYC Data</h2>
                                <p className="section-note">
                                    🔒 <strong>id</strong>, <strong>user_id</strong>, <strong>created_at</strong> are locked. <strong>user_id</strong> is a FK referencing users.id — changing it would reassign this profile to a different user.
                                </p>
                            </div>
                            {!isEditing && (
                                <button className="edit-btn" onClick={() => startEdit("userdata")}>
                                    <EditIcon /> Edit
                                </button>
                            )}
                            {editingSection === "userdata" && (
                                <div className="edit-actions">
                                    <button className="cancel-btn" onClick={cancelEdit}>Cancel</button>
                                    <button className="save-btn" onClick={preSave} disabled={saving}>
                                        {saving ? <><span className="btn-spinner" /> Saving…</> : "Save changes →"}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="fields-grid">
                            {([
                                { key: "id",                    label: "ID (Primary Key)",         locked: true,  note: "PK — never editable." },
                                { key: "user_id",               label: "User ID (FK → users.id)",  locked: true,  note: "FK — changing this would reassign the profile to a different user account." },
                                { key: "full_name",             label: "Full Name",                locked: false },
                                { key: "dob",                   label: "Date of Birth",            locked: false },
                                { key: "address",               label: "Address",                  locked: false },
                                { key: "govt_id_type",          label: "Govt ID Type",             locked: false, allowed: ALLOWED.govt_id_type },
                                { key: "govt_id_number",        label: "Govt ID Number",           locked: false },
                                { key: "verification_status",   label: "Verification Status",      locked: false, allowed: ALLOWED.verification_status },
                                { key: "created_at",            label: "Created At",               locked: true },
                                { key: "updated_at",            label: "Updated At",               locked: true },
                            ] as { key: keyof UserData; label: string; locked: boolean; note?: string; allowed?: string[] }[]).map(f => (
                                <FieldRow
                                    key={f.key}
                                    label={f.label}
                                    value={editUserData?.[f.key] ?? null}
                                    originalValue={userData[f.key] ?? null}
                                    locked={f.locked}
                                    note={f.note}
                                    allowed={f.allowed}
                                    editing={editingSection === "userdata"}
                                    onChange={val => setEditUserData(prev => prev ? { ...prev, [f.key]: val } : prev)}
                                    hasConflict={false}
                                    hasWarn={false}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {/* ── CLUSTERS ── */}
                <section className="section">
                    <div className="section-hdr">
                        <div>
                            <span className="section-tag">clusters_main_data</span>
                            <h2 className="section-title">Linked Clusters ({clusters.length})</h2>
                            <p className="section-note">
                                Cluster IDs are PKs referenced by <strong>cluster_live_data</strong>, <strong>ai_insights</strong>, and <strong>volumetric_scans</strong>. Manage clusters from the Clusters tab to avoid cascading FK issues.
                            </p>
                        </div>
                        <button className="edit-btn" onClick={() => router.push("/admin/dashboard")}>
                            Manage in Dashboard →
                        </button>
                    </div>

                    {clusters.length === 0 ? (
                        <div className="empty">No clusters linked to this user.</div>
                    ) : (
                        <div className="cluster-list">
                            {clusters.map(c => {
                                const s = c.approval_status === "approved" ? { color: "#34d399", bg: "rgba(52,211,153,.1)" }
                                        : c.approval_status === "rejected" ? { color: "#ef4444", bg: "rgba(239,68,68,.1)" }
                                        : { color: "#f59e0b", bg: "rgba(245,158,11,.1)" };
                                return (
                                    <div className="cluster-row" key={c.id}>
                                        <div className="cluster-icon">⬡</div>
                                        <div className="cluster-info">
                                            <div className="cluster-name">{c.farm_name}</div>
                                            <div className="cluster-meta mono">{c.id.slice(0, 14)}… · {c.crop_type} · {c.land_area} {c.area_unit}</div>
                                        </div>
                                        <span className="badge" style={{ color: s.color, background: s.bg }}>{c.approval_status}</span>
                                        <span className="badge" style={{ color: "#a78bfa", background: "rgba(167,139,250,.1)" }}>{c.compute_tier}</span>
                                        <span className="cluster-time mono">{relTime(c.created_at)}</span>
                                        <button className="act-view" onClick={() => router.push(`/clusters/${c.id}`)}>View →</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

            </div>

            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700&family=JetBrains+Mono:wght@400;500&display=swap');
                *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
                :root{
                    --bg:#080807;--s1:#0f0f0e;--s2:#141413;--s3:#1a1a18;--s4:#212120;
                    --b0:rgba(255,255,255,.05);--b1:rgba(255,255,255,.09);--b2:rgba(255,255,255,.15);
                    --t0:#f0f0ec;--t1:rgba(240,240,236,.6);--t2:rgba(240,240,236,.32);--t3:rgba(240,240,236,.15);
                    --g0:#10b981;--g1:#34d399;--ga:rgba(16,185,129,.07);--gb:rgba(16,185,129,.14);
                    --font:'Instrument Sans',-apple-system,sans-serif;
                    --mono:'JetBrains Mono',monospace;
                }
                html,body{background:var(--bg);color:var(--t0);font-family:var(--font);-webkit-font-smoothing:antialiased}

                .loading-page{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;color:var(--t2);font-size:.9rem;background:var(--bg)}
                .spinner{width:28px;height:28px;border:2px solid var(--b1);border-top-color:var(--g0);border-radius:50%;animation:spin .7s linear infinite}
                @keyframes spin{to{transform:rotate(360deg)}}
                .back-btn{margin-top:1rem;padding:.5rem 1rem;background:var(--s2);border:1px solid var(--b1);border-radius:8px;color:var(--t1);font-family:var(--font);font-size:.85rem;cursor:pointer}

                .page{min-height:100vh;background:var(--bg)}

                /* TOAST */
                .toast{position:fixed;bottom:1.5rem;right:1.5rem;z-index:999;padding:.72rem 1.2rem;border-radius:10px;font-size:.83rem;font-weight:500;animation:slideUp .3s ease;box-shadow:0 8px 32px -8px rgba(0,0,0,.5)}
                .toast-success{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.25);color:#34d399}
                .toast-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);color:#ef4444}
                .toast-warn{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);color:#f59e0b}
                @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

                /* HEADER */
                .hdr{display:flex;align-items:center;gap:1.5rem;padding:1.25rem 2rem;background:var(--s1);border-bottom:1px solid var(--b0);position:sticky;top:0;z-index:40}
                .back-link{background:none;border:none;font-family:var(--font);font-size:.82rem;color:var(--t2);cursor:pointer;white-space:nowrap;transition:color .15s;padding:.3rem .5rem;border-radius:6px}
                .back-link:hover{color:var(--t0);background:var(--s2)}
                .hdr-center{display:flex;align-items:center;gap:.85rem;flex:1}
                .hdr-av{width:38px;height:38px;border-radius:10px;background:var(--gb);border:1px solid rgba(16,185,129,.3);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--g1);flex-shrink:0;font-family:var(--font)}
                .hdr-name{font-size:.95rem;font-weight:700;letter-spacing:-.02em;color:var(--t0)}
                .hdr-sub{font-size:.62rem;color:var(--t3);letter-spacing:.03em;margin-top:.1rem}
                .hdr-badges{display:flex;gap:.5rem;flex-shrink:0}
                .badge-role,.badge-provider{font-family:var(--mono);font-size:.62rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;padding:.2rem .55rem;border-radius:5px}
                .badge-role{color:var(--g1);background:var(--ga);border:1px solid rgba(16,185,129,.18)}
                .badge-provider{color:#a78bfa;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.18)}

                /* BODY */
                .body{max-width:1000px;margin:0 auto;padding:2rem;display:flex;flex-direction:column;gap:2rem}

                /* CONFLICTS */
                .conflicts-panel{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:14px;padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:.75rem;animation:fadeIn .3s ease}
                @keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
                .conflicts-title{display:flex;align-items:center;gap:.5rem;font-size:.82rem;font-weight:700;color:#ef4444;letter-spacing:-.01em}
                .conflict-item{padding:.75rem 1rem;border-radius:9px;display:flex;flex-direction:column;gap:.3rem}
                .conflict-item.block{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.18)}
                .conflict-item.warn{background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.18)}
                .conflict-field{display:flex;align-items:center;gap:.4rem;font-family:var(--mono);font-size:.7rem;font-weight:600;color:#ef4444}
                .conflict-item.warn .conflict-field{color:#f59e0b}
                .conflict-msg{font-size:.82rem;color:var(--t1);line-height:1.5}

                /* SECTION */
                .section{background:var(--s2);border:1px solid var(--b1);border-radius:16px;overflow:hidden}
                .section-hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;padding:1.4rem 1.5rem;border-bottom:1px solid var(--b0)}
                .section-tag{font-family:var(--mono);font-size:.62rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--g0);display:block;margin-bottom:.4rem}
                .section-title{font-size:1rem;font-weight:700;letter-spacing:-.025em;color:var(--t0);margin-bottom:.4rem}
                .section-note{font-size:.78rem;color:var(--t2);line-height:1.55;max-width:580px}
                .section-note strong{color:var(--t0)}

                /* EDIT BUTTONS */
                .edit-btn{display:flex;align-items:center;gap:.4rem;padding:.48rem 1rem;background:var(--s3);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.8rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .2s,color .2s,border-color .2s;flex-shrink:0}
                .edit-btn:hover{background:var(--s4);color:var(--t0);border-color:var(--b2)}
                .edit-actions{display:flex;gap:.6rem;flex-shrink:0}
                .cancel-btn{padding:.48rem .95rem;background:var(--s3);color:var(--t2);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.8rem;font-weight:500;cursor:pointer;transition:background .15s}
                .cancel-btn:hover{background:var(--s4);color:var(--t0)}
                .save-btn{display:flex;align-items:center;gap:.4rem;padding:.48rem 1.1rem;background:var(--g0);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:.8rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s}
                .save-btn:hover{opacity:.88;transform:translateY(-1px)}
                .save-btn:disabled{opacity:.5;cursor:default;transform:none}
                .btn-spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}

                /* FIELDS GRID */
                .fields-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--b0)}

                /* CLUSTER LIST */
                .cluster-list{display:flex;flex-direction:column}
                .cluster-row{display:flex;align-items:center;gap:.9rem;padding:1rem 1.5rem;border-bottom:1px solid var(--b0);transition:background .15s}
                .cluster-row:last-child{border-bottom:none}
                .cluster-row:hover{background:var(--s3)}
                .cluster-icon{width:28px;height:28px;border-radius:7px;background:var(--ga);border:1px solid rgba(16,185,129,.14);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0}
                .cluster-info{flex:1;min-width:0}
                .cluster-name{font-size:.85rem;font-weight:600;color:var(--t0)}
                .cluster-meta{font-size:.62rem;color:var(--t3);margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .cluster-time{font-size:.65rem;color:var(--t3);white-space:nowrap}
                .badge{display:inline-flex;align-items:center;padding:.18rem .5rem;border-radius:5px;font-family:var(--mono);font-size:.6rem;font-weight:600;letter-spacing:.05em;white-space:nowrap}
                .act-view{padding:.28rem .65rem;background:var(--s4);color:var(--t1);border:1px solid var(--b1);border-radius:6px;font-family:var(--font);font-size:.72rem;font-weight:600;cursor:pointer;transition:opacity .2s}
                .act-view:hover{opacity:.8}
                .empty{padding:2rem;text-align:center;color:var(--t3);font-size:.85rem}
                .mono{font-family:var(--mono)}

                /* CONFIRM MODAL */
                .overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:center;justify-content:center;padding:2rem}
                .confirm-modal{background:var(--s2);border:1px solid rgba(245,158,11,.25);border-radius:18px;width:100%;max-width:500px;padding:2rem;box-shadow:0 40px 80px -20px rgba(0,0,0,.7);animation:fadeIn .3s ease}
                .confirm-icon{width:42px;height:42px;border-radius:11px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.22);display:flex;align-items:center;justify-content:center;color:#f59e0b;margin-bottom:1rem}
                .confirm-title{font-size:1rem;font-weight:700;color:var(--t0);margin-bottom:.4rem}
                .confirm-sub{font-size:.85rem;color:var(--t1);line-height:1.55;margin-bottom:1.1rem}
                .confirm-warns{display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.5rem}
                .confirm-actions{display:flex;gap:.75rem;justify-content:flex-end}
                .confirm-cancel{padding:.6rem 1.2rem;background:var(--s3);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.83rem;font-weight:500;cursor:pointer;transition:background .15s}
                .confirm-cancel:hover{background:var(--s4);color:var(--t0)}
                .confirm-proceed{padding:.6rem 1.4rem;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.25);border-radius:8px;font-family:var(--font);font-size:.83rem;font-weight:600;cursor:pointer;transition:opacity .2s}
                .confirm-proceed:hover{opacity:.85}

                @media(max-width:768px){.fields-grid{grid-template-columns:1fr}.hdr{flex-wrap:wrap}.cluster-meta{display:none}}
            `}</style>
        </div>
    );
}

/* ═══════════════════════════════════════════
   FIELD ROW COMPONENT
═══════════════════════════════════════════ */
function FieldRow({
    label, value, originalValue, locked, note, allowed,
    editing, onChange, hasConflict, hasWarn,
}: {
    label: string;
    value: string | number | boolean | null;
    originalValue: string | number | boolean | null;
    locked: boolean;
    note?: string;
    allowed?: string[];
    editing: boolean;
    onChange: (val: string) => void;
    hasConflict: boolean;
    hasWarn: boolean;
}) {
    const isDirty = editing && value !== originalValue;
    const displayVal = value === null || value === undefined ? "" : String(value);

    return (
        <div className={`field-row ${locked ? "locked" : ""} ${hasConflict ? "has-conflict" : ""} ${hasWarn ? "has-warn" : ""} ${isDirty ? "is-dirty" : ""}`}>
            <div className="field-label-wrap">
                <span className="field-label">{label}</span>
                {locked && <span className="lock-badge"><LockIcon /> locked</span>}
                {isDirty && !locked && <span className="dirty-badge">modified</span>}
                {hasConflict && <span className="conflict-badge"><BlockIcon /> conflict</span>}
                {hasWarn && <span className="warn-badge"><WarnIcon /> warning</span>}
            </div>

            {editing && !locked ? (
                allowed ? (
                    <select
                        className="field-select"
                        value={displayVal}
                        onChange={e => onChange(e.target.value)}
                    >
                        {allowed.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                ) : (
                    <input
                        className={`field-input ${hasConflict ? "input-error" : ""} ${hasWarn ? "input-warn" : ""}`}
                        value={displayVal}
                        onChange={e => onChange(e.target.value)}
                        placeholder={`Enter ${label.toLowerCase()}…`}
                    />
                )
            ) : (
                <div className="field-value">
                    {displayVal || <span className="null-val">null</span>}
                </div>
            )}

            {note && (
                <div className="field-note">{note}</div>
            )}

            <style jsx>{`
                .field-row{background:var(--s2);padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.38rem;transition:background .15s;border-left:3px solid transparent}
                .field-row:hover{background:var(--s3)}
                .field-row.locked{opacity:.7}
                .field-row.locked:hover{background:var(--s2)}
                .field-row.has-conflict{border-left-color:#ef4444;background:rgba(239,68,68,.04)}
                .field-row.has-warn{border-left-color:#f59e0b;background:rgba(245,158,11,.04)}
                .field-row.is-dirty{border-left-color:var(--g0);background:rgba(16,185,129,.04)}
                .field-label-wrap{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
                .field-label{font-family:var(--mono);font-size:.62rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--t3)}
                .lock-badge{display:inline-flex;align-items:center;gap:.25rem;font-family:var(--mono);font-size:.58rem;color:var(--t3);background:var(--s3);border:1px solid var(--b0);padding:.08rem .38rem;border-radius:4px}
                .dirty-badge{font-family:var(--mono);font-size:.58rem;color:var(--g0);background:var(--ga);border:1px solid rgba(16,185,129,.18);padding:.08rem .38rem;border-radius:4px}
                .conflict-badge{display:inline-flex;align-items:center;gap:.22rem;font-family:var(--mono);font-size:.58rem;color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);padding:.08rem .38rem;border-radius:4px}
                .warn-badge{display:inline-flex;align-items:center;gap:.22rem;font-family:var(--mono);font-size:.58rem;color:#f59e0b;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);padding:.08rem .38rem;border-radius:4px}
                .field-value{font-size:.88rem;color:var(--t0);word-break:break-all;line-height:1.5}
                .null-val{color:var(--t3);font-style:italic;font-size:.8rem}
                .field-input{background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:8px;padding:.55rem .8rem;font-family:var(--font);font-size:.88rem;outline:none;width:100%;transition:border-color .2s,box-shadow .2s}
                .field-input:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .field-input.input-error{border-color:rgba(239,68,68,.4);box-shadow:0 0 0 3px rgba(239,68,68,.07)}
                .field-input.input-warn{border-color:rgba(245,158,11,.35);box-shadow:0 0 0 3px rgba(245,158,11,.07)}
                .field-select{background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:8px;padding:.55rem .8rem;font-family:var(--font);font-size:.88rem;outline:none;width:100%;cursor:pointer;transition:border-color .2s}
                .field-select:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .field-select option{background:var(--s3);color:var(--t0)}
                .field-note{font-size:.72rem;color:var(--t3);line-height:1.5;padding-top:.1rem}
            `}</style>
        </div>
    );
}

/* ── Icons ── */
const EditIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const LockIcon  = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
const WarnIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const BlockIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const AlertIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
