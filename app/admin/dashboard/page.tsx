"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Cluster = { id: string; farm_name: string; crop_type: string; approval_status: string; connectivity_type: string; created_at: string; user_id?: string; [key: string]: any; };
type User    = { id: string; email: string; created_at: string; role?: string; [key: string]: any; };
type Toast   = { id: number; msg: string; type: "success" | "error" | "info" | "notif" };
type Tab     = "overview" | "users" | "clusters" | "approvals";
type Notif   = { id: string; farm_name: string; created_at: string; seen: boolean };

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
    approved: { label: "Approved", color: "#34d399", bg: "rgba(52,211,153,.12)"  },
    pending:  { label: "Pending",  color: "#f59e0b", bg: "rgba(245,158,11,.12)" },
    rejected: { label: "Rejected", color: "#ef4444", bg: "rgba(239,68,68,.12)"  },
};

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

export default function AdminPanel() {
    const router = useRouter();
    const [tab, setTab]           = useState<Tab>("overview");
    const [users, setUsers]       = useState<User[]>([]);
    const [clusters, setClusters] = useState<Cluster[]>([]);
    const [loading, setLoading]   = useState(true);
    const [syncing, setSyncing]   = useState(false);
    const [search, setSearch]     = useState("");
    const [toasts, setToasts]     = useState<Toast[]>([]);
    const [editRow, setEditRow]   = useState<Cluster | null>(null);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const toastId = useRef(0);

    // ── BULK ACTIONS ──
    const [selected, setSelected]     = useState<Set<string>>(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    // ── NOTIFICATIONS ──
    const [notifs, setNotifs]         = useState<Notif[]>([]);
    const [notifOpen, setNotifOpen]   = useState(false);
    const prevPendingIds              = useRef<Set<string>>(new Set());

    /* ── TOAST ── */
    const showToast = useCallback((msg: string, type: Toast["type"] = "success") => {
        const id = ++toastId.current;
        setToasts(prev => [...prev, { id, msg, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === "notif" ? 6000 : 3500);
    }, []);

    /* ── FETCH ── */
    const fetchAll = useCallback(async (silent = false) => {
        if (!silent) setLoading(true); else setSyncing(true);
        try {
            const [{ data: cu, error: ue }, { data: cc, error: ce }] = await Promise.all([
                supabase.from("users").select("*").order("created_at", { ascending: false }),
                supabase.from("clusters_main_data").select("*").order("created_at", { ascending: false }),
            ]);
            if (ue) throw ue; if (ce) throw ce;
            if (cu) setUsers(cu);
            if (cc) {
                // detect NEW pending clusters and push notifications
                const newPending = (cc as Cluster[]).filter(c => c.approval_status === "pending");
                const newIds = new Set(newPending.map(c => c.id));
                newPending.forEach(c => {
                    if (!prevPendingIds.current.has(c.id)) {
                        setNotifs(prev => [{ id: c.id, farm_name: c.farm_name || "Untitled", created_at: c.created_at, seen: false }, ...prev].slice(0, 20));
                        if (prevPendingIds.current.size > 0) {
                            showToast(`New pending approval: ${c.farm_name || "Untitled"}`, "notif");
                        }
                    }
                });
                prevPendingIds.current = newIds;
                setClusters(cc);
            }
            setLastSync(new Date());
            if (silent) showToast("Data refreshed", "info");
        } catch (e: any) {
            showToast(e?.message || "Fetch failed", "error");
        } finally { setLoading(false); setSyncing(false); }
    }, [showToast]);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    /* ── REAL-TIME SUBSCRIPTION for new pending clusters ── */
    useEffect(() => {
        const channel = supabase
            .channel("pending-approvals")
            .on("postgres_changes", {
                event: "INSERT",
                schema: "public",
                table: "clusters_main_data",
                filter: "approval_status=eq.pending",
            }, (payload) => {
                const c = payload.new as Cluster;
                setClusters(prev => [c, ...prev]);
                setNotifs(prev => [{ id: c.id, farm_name: c.farm_name || "Untitled", created_at: c.created_at, seen: false }, ...prev].slice(0, 20));
                showToast(`🔔 New cluster pending: ${c.farm_name || "Untitled"}`, "notif");
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [showToast]);

    /* ── SINGLE UPDATE ── */
    const updateCluster = async (id: string, patch: Partial<Cluster>) => {
        setSyncing(true);
        const { error } = await supabase.from("clusters_main_data").update(patch).eq("id", id);
        if (error) { showToast(error.message, "error"); }
        else { setClusters(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); showToast("Cluster updated ✓"); }
        setSyncing(false);
    };

    const updateUser = async (id: string, patch: Partial<User>) => {
        setSyncing(true);
        const { error } = await supabase.from("users").update(patch).eq("id", id);
        if (error) { showToast(error.message, "error"); }
        else { setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u)); showToast("User updated ✓"); }
        setSyncing(false);
    };

    const deleteCluster = async (id: string) => {
        if (!confirm("Delete this cluster? This cannot be undone.")) return;
        setSyncing(true);
        const { error } = await supabase.from("clusters_main_data").delete().eq("id", id);
        if (error) { showToast(error.message, "error"); }
        else { setClusters(prev => prev.filter(c => c.id !== id)); showToast("Cluster deleted"); }
        setSyncing(false);
    };

    const saveEdit = async () => {
        if (!editRow) return;
        setSyncing(true);
        const { id, created_at, ...patch } = editRow;
        const { error } = await supabase.from("clusters_main_data").update(patch).eq("id", id);
        if (error) { showToast(error.message, "error"); }
        else { setClusters(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)); showToast("Saved ✓"); setEditRow(null); }
        setSyncing(false);
    };

    /* ── BULK ACTIONS ── */
    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleSelectAll = (ids: string[]) => {
        if (ids.every(id => selected.has(id))) {
            setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
        } else {
            setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
        }
    };

    const bulkUpdate = async (status: string) => {
        if (selected.size === 0) return;
        if (!confirm(`${status === "approved" ? "Approve" : "Reject"} ${selected.size} cluster(s)?`)) return;
        setBulkLoading(true);
        const ids = Array.from(selected);
        const { error } = await supabase
            .from("clusters_main_data")
            .update({ approval_status: status })
            .in("id", ids);
        if (error) { showToast(error.message, "error"); }
        else {
            setClusters(prev => prev.map(c => ids.includes(c.id) ? { ...c, approval_status: status } : c));
            showToast(`${ids.length} cluster(s) ${status} ✓`);
            setSelected(new Set());
        }
        setBulkLoading(false);
    };

    const bulkDelete = async () => {
        if (selected.size === 0) return;
        if (!confirm(`Permanently delete ${selected.size} cluster(s)? This cannot be undone.`)) return;
        setBulkLoading(true);
        const ids = Array.from(selected);
        const { error } = await supabase.from("clusters_main_data").delete().in("id", ids);
        if (error) { showToast(error.message, "error"); }
        else {
            setClusters(prev => prev.filter(c => !ids.includes(c.id)));
            showToast(`${ids.length} cluster(s) deleted`);
            setSelected(new Set());
        }
        setBulkLoading(false);
    };

    const markAllNotifsSeen = () => setNotifs(prev => prev.map(n => ({ ...n, seen: true })));
    const unseenCount = notifs.filter(n => !n.seen).length;

    const pending  = clusters.filter(c => c.approval_status === "pending");
    const approved = clusters.filter(c => c.approval_status === "approved");
    const rejected = clusters.filter(c => c.approval_status === "rejected");
    const filteredUsers    = users.filter(u => u.email?.toLowerCase().includes(search.toLowerCase()) || u.id?.toLowerCase().includes(search.toLowerCase()));
    const filteredClusters = clusters.filter(c => c.farm_name?.toLowerCase().includes(search.toLowerCase()) || c.crop_type?.toLowerCase().includes(search.toLowerCase()) || c.id?.toLowerCase().includes(search.toLowerCase()));
    const pendingIds = pending.map(c => c.id);

    return (
        <div className="admin">

            {/* EDIT MODAL */}
            {editRow && (
                <div className="modal-overlay" onClick={() => setEditRow(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-hdr">
                            <h3 className="modal-title">Edit Cluster</h3>
                            <button className="modal-close" onClick={() => setEditRow(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {[
                                { key: "farm_name",         label: "Farm Name"    },
                                { key: "crop_type",         label: "Crop Type"    },
                                { key: "connectivity_type", label: "Connectivity" },
                            ].map(f => (
                                <div className="modal-field" key={f.key}>
                                    <label>{f.label}</label>
                                    <input value={editRow[f.key] || ""} onChange={e => setEditRow({ ...editRow, [f.key]: e.target.value })} placeholder={f.label} />
                                </div>
                            ))}
                            <div className="modal-field">
                                <label>Approval Status</label>
                                <select value={editRow.approval_status || "pending"} onChange={e => setEditRow({ ...editRow, approval_status: e.target.value })}>
                                    <option value="pending">Pending</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                        </div>
                        <div className="modal-ftr">
                            <button className="modal-cancel" onClick={() => setEditRow(null)}>Cancel</button>
                            <button className="modal-save" onClick={saveEdit} disabled={syncing}>{syncing ? "Saving…" : "Save Changes →"}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* NOTIFICATION PANEL */}
            {notifOpen && (
                <div className="notif-overlay" onClick={() => setNotifOpen(false)}>
                    <div className="notif-panel" onClick={e => e.stopPropagation()}>
                        <div className="notif-hdr">
                            <span className="notif-title">Notifications</span>
                            <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                                {unseenCount > 0 && <button className="notif-mark-read" onClick={markAllNotifsSeen}>Mark all read</button>}
                                <button className="modal-close" onClick={() => setNotifOpen(false)}>✕</button>
                            </div>
                        </div>
                        <div className="notif-list">
                            {notifs.length === 0 ? (
                                <div className="notif-empty">No notifications yet</div>
                            ) : notifs.map(n => (
                                <button key={n.id} className={`notif-item ${n.seen ? "seen" : "unseen"}`}
                                    onClick={() => { setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, seen: true } : x)); setTab("approvals"); setNotifOpen(false); }}>
                                    <div className="notif-dot-wrap">{!n.seen && <span className="notif-dot" />}</div>
                                    <div className="notif-content">
                                        <div className="notif-name">{n.farm_name}</div>
                                        <div className="notif-sub">New cluster pending approval · {relTime(n.created_at)}</div>
                                    </div>
                                    <span className="notif-arrow">→</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* TOASTS STACK */}
            <div className="toast-stack">
                {toasts.map(t => (
                    <div key={t.id} className={`toast toast-${t.type}`}>
                        {t.type === "notif" && <span className="toast-bell">🔔</span>}
                        {t.msg}
                    </div>
                ))}
            </div>

            {/* SIDEBAR */}
            <aside className="sidebar">
                <div className="sidebar-top">
                    <div className="sidebar-logo" onClick={() => router.push("/")}>
                        <div className="sidebar-mark">RS</div>
                        <div>
                            <div className="sidebar-brand">Rootsense</div>
                            <div className="sidebar-sub">Admin Console</div>
                        </div>
                    </div>
                </div>
                <nav className="sidebar-nav">
                    {([
                        { id: "overview",  label: "Overview",  Icon: GridIcon  },
                        { id: "users",     label: "Users",     Icon: UsersIcon },
                        { id: "clusters",  label: "Clusters",  Icon: LayerIcon },
                        { id: "approvals", label: "Approvals", Icon: CheckIcon, badge: pending.length },
                    ] as any[]).map(item => (
                        <button key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => { setTab(item.id); setSearch(""); setSelected(new Set()); }}>
                            <span className="nav-icon"><item.Icon /></span>
                            <span className="nav-label">{item.label}</span>
                            {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <button className="nav-item" onClick={() => fetchAll(true)} disabled={syncing}>
                        <span className="nav-icon"><RefreshIcon spinning={syncing} /></span>
                        <span className="nav-label">{syncing ? "Syncing…" : "Refresh data"}</span>
                    </button>
                    {lastSync && <div className="last-sync">Synced {relTime(lastSync.toISOString())}</div>}
                    <button className="nav-item" onClick={() => router.push("/admin")}>
                        <span className="nav-icon"><BackIcon /></span>
                        <span className="nav-label">User Search</span>
                    </button>
                </div>
            </aside>

            {/* MAIN */}
            <div className="main">
                <header className="topbar">
                    <div>
                        <h1 className="topbar-title">{tab === "overview" ? "Overview" : tab === "users" ? "User Management" : tab === "clusters" ? "Cluster Management" : "Approval Workflows"}</h1>
                        <span className="topbar-sub">{tab === "overview" ? "Platform health at a glance" : tab === "users" ? `${users.length} total users` : tab === "clusters" ? `${clusters.length} total clusters` : `${pending.length} pending review`}</span>
                    </div>
                    <div className="topbar-right">
                        {(tab === "users" || tab === "clusters") && (
                            <div className="search-wrap">
                                <SearchIcon />
                                <input className="search-input" placeholder={`Search ${tab}...`} value={search} onChange={e => setSearch(e.target.value)} />
                                {search && <button className="search-clear" onClick={() => setSearch("")}>✕</button>}
                            </div>
                        )}

                        {/* NOTIFICATION BELL */}
                        <button className="notif-bell" onClick={() => { setNotifOpen(true); markAllNotifsSeen(); }}>
                            <BellIcon />
                            {unseenCount > 0 && <span className="notif-badge">{unseenCount}</span>}
                        </button>

                        <div className="live-pill"><span className={`live-dot ${syncing ? "syncing" : ""}`} />{syncing ? "Syncing" : "Live"}</div>
                    </div>
                </header>

                {/* BULK ACTION BAR */}
                {selected.size > 0 && (
                    <div className="bulk-bar">
                        <span className="bulk-count">{selected.size} selected</span>
                        <div className="bulk-actions">
                            <button className="bulk-btn bulk-approve" onClick={() => bulkUpdate("approved")} disabled={bulkLoading}>
                                <CheckIcon /> Approve All
                            </button>
                            <button className="bulk-btn bulk-reject" onClick={() => bulkUpdate("rejected")} disabled={bulkLoading}>
                                <XIcon /> Reject All
                            </button>
                            <button className="bulk-btn bulk-delete" onClick={bulkDelete} disabled={bulkLoading}>
                                <TrashIcon /> Delete All
                            </button>
                            <button className="bulk-btn bulk-clear" onClick={() => setSelected(new Set())}>
                                Clear
                            </button>
                        </div>
                        {bulkLoading && <div className="bulk-spinner" />}
                    </div>
                )}

                <div className="content">
                    {loading ? (
                        <div className="loading-wrap"><div className="spinner" /><span>Fetching from Supabase…</span></div>
                    ) : (
                        <>
                            {/* OVERVIEW */}
                            {tab === "overview" && (
                                <div>
                                    <div className="stats-row">
                                        {[
                                            { label: "Total Users",      val: users.length,    color: "#60a5fa", Icon: UsersIcon },
                                            { label: "Total Clusters",   val: clusters.length, color: "#a78bfa", Icon: LayerIcon },
                                            { label: "Pending Approval", val: pending.length,  color: "#f59e0b", Icon: ClockIcon },
                                            { label: "Approved",         val: approved.length, color: "#34d399", Icon: CheckIcon },
                                        ].map(s => (
                                            <div className="stat-card" key={s.label}>
                                                <div className="stat-icon" style={{ color: s.color, background: `${s.color}18` }}><s.Icon /></div>
                                                <div><div className="stat-val" style={{ color: s.color }}>{s.val}</div><div className="stat-label">{s.label}</div></div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="ov-grid">
                                        <div className="panel">
                                            <div className="panel-hdr"><span className="panel-title">Recent Clusters</span><button className="panel-link" onClick={() => setTab("clusters")}>View all →</button></div>
                                            {clusters.slice(0, 7).map(c => {
                                                const s = STATUS[c.approval_status] ?? STATUS.pending;
                                                return (
                                                    <div className="panel-row" key={c.id}>
                                                        <div className="panel-row-main"><span className="panel-row-name">{c.farm_name || "Untitled"}</span><span className="panel-row-sub">{c.crop_type || "—"}</span></div>
                                                        <span className="badge" style={{ color: s.color, background: s.bg }}>{s.label}</span>
                                                        <span className="panel-row-time">{relTime(c.created_at)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="panel">
                                            <div className="panel-hdr"><span className="panel-title">Approval Breakdown</span><button className="panel-link" onClick={() => setTab("approvals")}>Review →</button></div>
                                            {[
                                                { label: "Pending",  count: pending.length,  color: "#f59e0b" },
                                                { label: "Approved", count: approved.length, color: "#34d399" },
                                                { label: "Rejected", count: rejected.length, color: "#ef4444" },
                                            ].map(row => (
                                                <div className="bar-row" key={row.label}>
                                                    <span className="bar-label">{row.label}</span>
                                                    <div className="bar-track"><div className="bar-fill" style={{ width: clusters.length ? `${(row.count / clusters.length) * 100}%` : "0%", background: row.color }} /></div>
                                                    <span className="bar-count" style={{ color: row.color }}>{row.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* USERS */}
                            {tab === "users" && (
                                <div className="table-box">
                                    <table className="tbl">
                                        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
                                        <tbody>
                                            {filteredUsers.map((u, i) => (
                                                <tr key={u.id} style={{ animationDelay: `${i * 25}ms` }}>
                                                    <td><div className="cell-user"><div className="av">{u.email?.[0]?.toUpperCase() ?? "U"}</div><span className="mono dim" style={{ fontSize: ".7rem" }}>{u.id.slice(0, 8)}…</span></div></td>
                                                    <td className="fw">{u.email || "—"}</td>
                                                    <td>
                                                        <select className="inline-select" value={u.role || "user"} onChange={e => updateUser(u.id, { role: e.target.value })}>
                                                            <option value="user">user</option>
                                                            <option value="admin">admin</option>
                                                            <option value="viewer">viewer</option>
                                                        </select>
                                                    </td>
                                                    <td className="mono dim">{relTime(u.created_at)}</td>
                                                    <td>
                                                        <div className="ab-group">
                                                            <button className="ab ab-view" onClick={() => router.push(`/admin/user/${u.id}`)}>View Profile →</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {filteredUsers.length === 0 && <div className="empty">No users found</div>}
                                </div>
                            )}

                            {/* CLUSTERS */}
                            {tab === "clusters" && (
                                <div className="table-box">
                                    <table className="tbl">
                                        <thead>
                                            <tr>
                                                <th>
                                                    <input type="checkbox"
                                                        className="cb"
                                                        checked={filteredClusters.length > 0 && filteredClusters.every(c => selected.has(c.id))}
                                                        onChange={() => toggleSelectAll(filteredClusters.map(c => c.id))}
                                                    />
                                                </th>
                                                <th>Farm</th><th>Crop</th><th>Connectivity</th><th>Status</th><th>Created</th><th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredClusters.map((c, i) => {
                                                const s = STATUS[c.approval_status] ?? STATUS.pending;
                                                return (
                                                    <tr key={c.id} className={selected.has(c.id) ? "selected-row" : ""} style={{ animationDelay: `${i * 25}ms` }}>
                                                        <td><input type="checkbox" className="cb" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} /></td>
                                                        <td><div className="cell-farm"><div className="farm-ic">⬡</div><div><div className="fw">{c.farm_name || "Untitled"}</div><div className="mono dim" style={{ fontSize: ".6rem" }}>{c.id.slice(0, 10)}…</div></div></div></td>
                                                        <td className="dim">{c.crop_type || "—"}</td>
                                                        <td className="dim">{c.connectivity_type || "—"}</td>
                                                        <td>
                                                            <select className="inline-select" style={{ color: s.color }} value={c.approval_status || "pending"} onChange={e => updateCluster(c.id, { approval_status: e.target.value })}>
                                                                <option value="pending">Pending</option>
                                                                <option value="approved">Approved</option>
                                                                <option value="rejected">Rejected</option>
                                                            </select>
                                                        </td>
                                                        <td className="mono dim">{relTime(c.created_at)}</td>
                                                        <td>
                                                            <div className="ab-group">
                                                                <button className="ab ab-view"  onClick={() => router.push(`/clusters/${c.id}`)}>View</button>
                                                                <button className="ab ab-edit"  onClick={() => setEditRow({ ...c })}>Edit</button>
                                                                <button className="ab ab-del"   onClick={() => deleteCluster(c.id)}>Delete</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    {filteredClusters.length === 0 && <div className="empty">No clusters found</div>}
                                </div>
                            )}

                            {/* APPROVALS */}
                            {tab === "approvals" && (
                                <div className="approvals">
                                    {/* BULK APPROVE ALL PENDING */}
                                    {pending.length > 0 && (
                                        <div className="bulk-approval-bar">
                                            <div>
                                                <span className="bulk-approval-title">{pending.length} cluster{pending.length > 1 ? "s" : ""} awaiting review</span>
                                                <span className="bulk-approval-sub">Select individual clusters below or use bulk actions</span>
                                            </div>
                                            <div className="bulk-approval-btns">
                                                <button className="bulk-btn bulk-approve" onClick={() => { setSelected(new Set(pendingIds)); }}>
                                                    Select All Pending
                                                </button>
                                                <button className="bulk-btn bulk-approve" disabled={bulkLoading}
                                                    onClick={async () => {
                                                        if (!confirm(`Approve all ${pending.length} pending clusters?`)) return;
                                                        setBulkLoading(true);
                                                        const { error } = await supabase.from("clusters_main_data").update({ approval_status: "approved" }).eq("approval_status", "pending");
                                                        if (error) showToast(error.message, "error");
                                                        else { setClusters(prev => prev.map(c => c.approval_status === "pending" ? { ...c, approval_status: "approved" } : c)); showToast(`All ${pending.length} clusters approved ✓`); }
                                                        setBulkLoading(false);
                                                    }}>
                                                    <CheckIcon /> Approve All
                                                </button>
                                                <button className="bulk-btn bulk-reject" disabled={bulkLoading}
                                                    onClick={async () => {
                                                        if (!confirm(`Reject all ${pending.length} pending clusters?`)) return;
                                                        setBulkLoading(true);
                                                        const { error } = await supabase.from("clusters_main_data").update({ approval_status: "rejected" }).eq("approval_status", "pending");
                                                        if (error) showToast(error.message, "error");
                                                        else { setClusters(prev => prev.map(c => c.approval_status === "pending" ? { ...c, approval_status: "rejected" } : c)); showToast(`All ${pending.length} clusters rejected`); }
                                                        setBulkLoading(false);
                                                    }}>
                                                    <XIcon /> Reject All
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* PENDING */}
                                    <div className="ap-section">
                                        <div className="ap-hdr"><span className="ap-title" style={{ color: "#f59e0b" }}>Pending Review</span><span className="ap-count">{pending.length}</span></div>
                                        {pending.length === 0
                                            ? <div className="ap-empty">All clear — no pending approvals ✓</div>
                                            : <div className="ap-cards">
                                                {pending.map(c => (
                                                    <div className={`ap-card ${selected.has(c.id) ? "ap-card-selected" : ""}`} key={c.id}>
                                                        <div className="ap-card-glow" />
                                                        <div className="ap-card-top">
                                                            <div style={{ display: "flex", alignItems: "flex-start", gap: ".75rem" }}>
                                                                <input type="checkbox" className="cb" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} style={{ marginTop: ".2rem" }} />
                                                                <div><div className="ap-name">{c.farm_name || "Untitled"}</div><div className="ap-meta"><span>{c.crop_type || "—"}</span><span className="sep">·</span><span>{c.connectivity_type || "—"}</span><span className="sep">·</span><span className="mono">{relTime(c.created_at)}</span></div></div>
                                                            </div>
                                                            <span className="badge" style={{ color: "#f59e0b", background: "rgba(245,158,11,.12)" }}>Pending</span>
                                                        </div>
                                                        <div className="ap-id mono">{c.id}</div>
                                                        <div className="ap-actions">
                                                            <button className="ap-btn ap-approve" onClick={() => updateCluster(c.id, { approval_status: "approved" })}><CheckIcon /> Approve</button>
                                                            <button className="ap-btn ap-reject"  onClick={() => updateCluster(c.id, { approval_status: "rejected" })}><XIcon /> Reject</button>
                                                            <button className="ap-btn ap-edit"    onClick={() => setEditRow({ ...c })}>Edit</button>
                                                            <button className="ap-btn ap-view"    onClick={() => router.push(`/clusters/${c.id}`)}>View →</button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>

                                    {/* APPROVED */}
                                    <div className="ap-section">
                                        <div className="ap-hdr"><span className="ap-title" style={{ color: "#34d399" }}>Approved</span><span className="ap-count">{approved.length}</span></div>
                                        <div className="compact-list">
                                            {approved.map(c => (
                                                <div className="compact-row" key={c.id}>
                                                    <input type="checkbox" className="cb" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                                                    <span className="fw compact-name">{c.farm_name || "Untitled"}</span>
                                                    <span className="dim compact-crop">{c.crop_type || "—"}</span>
                                                    <span className="badge" style={{ color: "#34d399", background: "rgba(52,211,153,.1)" }}>Approved</span>
                                                    <span className="mono dim compact-time">{relTime(c.created_at)}</span>
                                                    <div className="ab-group">
                                                        <button className="ab ab-edit" onClick={() => setEditRow({ ...c })}>Edit</button>
                                                        <button className="ab ab-del"  onClick={() => updateCluster(c.id, { approval_status: "rejected" })}>Revoke</button>
                                                    </div>
                                                </div>
                                            ))}
                                            {approved.length === 0 && <div className="ap-empty">No approved clusters yet</div>}
                                        </div>
                                    </div>

                                    {/* REJECTED */}
                                    <div className="ap-section">
                                        <div className="ap-hdr"><span className="ap-title" style={{ color: "#ef4444" }}>Rejected</span><span className="ap-count">{rejected.length}</span></div>
                                        <div className="compact-list">
                                            {rejected.map(c => (
                                                <div className="compact-row" key={c.id}>
                                                    <input type="checkbox" className="cb" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                                                    <span className="fw compact-name">{c.farm_name || "Untitled"}</span>
                                                    <span className="dim compact-crop">{c.crop_type || "—"}</span>
                                                    <span className="badge" style={{ color: "#ef4444", background: "rgba(239,68,68,.1)" }}>Rejected</span>
                                                    <span className="mono dim compact-time">{relTime(c.created_at)}</span>
                                                    <div className="ab-group">
                                                        <button className="ab ab-approve" onClick={() => updateCluster(c.id, { approval_status: "approved" })}>Restore</button>
                                                        <button className="ab ab-del"     onClick={() => deleteCluster(c.id)}>Delete</button>
                                                    </div>
                                                </div>
                                            ))}
                                            {rejected.length === 0 && <div className="ap-empty">No rejected clusters</div>}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <style jsx global>{`
                @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
                *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
                :root{--bg:#080807;--s1:#0f0f0e;--s2:#141413;--s3:#1a1a18;--s4:#212120;--b0:rgba(255,255,255,.05);--b1:rgba(255,255,255,.09);--b2:rgba(255,255,255,.15);--t0:#f0f0ec;--t1:rgba(240,240,236,.6);--t2:rgba(240,240,236,.32);--t3:rgba(240,240,236,.15);--g0:#10b981;--g1:#34d399;--ga:rgba(16,185,129,.07);--font:'Instrument Sans',-apple-system,sans-serif;--mono:'JetBrains Mono',monospace}
                html,body{background:var(--bg);color:var(--t0);font-family:var(--font);-webkit-font-smoothing:antialiased}
                .admin{display:flex;min-height:100vh;background:var(--bg)}
                /* SIDEBAR */
                .sidebar{width:228px;flex-shrink:0;background:var(--s1);border-right:1px solid var(--b0);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
                .sidebar-top{padding:1.2rem 1rem;border-bottom:1px solid var(--b0)}
                .sidebar-logo{display:flex;align-items:center;gap:.7rem;cursor:pointer}
                .sidebar-mark{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#059669,#10b981);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.7rem;font-weight:600;color:#fff;flex-shrink:0}
                .sidebar-brand{font-size:.88rem;font-weight:700;letter-spacing:-.02em;color:var(--t0);line-height:1.2}
                .sidebar-sub{font-family:var(--mono);font-size:.58rem;color:var(--t3);letter-spacing:.06em}
                .sidebar-nav{flex:1;padding:.75rem;display:flex;flex-direction:column;gap:.2rem}
                .sidebar-bottom{padding:.75rem;border-top:1px solid var(--b0);display:flex;flex-direction:column;gap:.2rem}
                .last-sync{font-family:var(--mono);font-size:.58rem;color:var(--t3);letter-spacing:.04em;padding:.25rem .85rem;text-align:center}
                .nav-item{display:flex;align-items:center;gap:.65rem;padding:.58rem .82rem;border-radius:8px;background:transparent;border:none;font-family:var(--font);font-size:.82rem;font-weight:500;color:var(--t2);cursor:pointer;width:100%;text-align:left;transition:background .15s,color .15s}
                .nav-item:hover{background:var(--s2);color:var(--t0)}.nav-item.active{background:var(--ga);color:var(--g1);border:1px solid rgba(16,185,129,.14)}.nav-item:disabled{opacity:.5;cursor:default}
                .nav-icon{width:15px;height:15px;flex-shrink:0;display:flex;align-items:center;justify-content:center}.nav-label{flex:1}
                .nav-badge{background:#f59e0b;color:#000;font-size:.58rem;font-weight:700;padding:.07rem .38rem;border-radius:20px;min-width:16px;text-align:center}
                /* MAIN */
                .main{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}
                .topbar{height:60px;padding:0 1.75rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--b0);background:var(--s1);position:sticky;top:0;z-index:10;flex-shrink:0}
                .topbar-title{font-size:.98rem;font-weight:700;letter-spacing:-.025em;color:var(--t0)}
                .topbar-sub{font-family:var(--mono);font-size:.6rem;color:var(--t3);letter-spacing:.06em;display:block;margin-top:.1rem}
                .topbar-right{display:flex;align-items:center;gap:.85rem}
                .search-wrap{display:flex;align-items:center;gap:.42rem;background:var(--s2);border:1px solid var(--b1);border-radius:8px;padding:.4rem .78rem}
                .search-wrap svg{color:var(--t3);flex-shrink:0}
                .search-input{background:transparent;border:none;outline:none;font-family:var(--font);font-size:.82rem;color:var(--t0);width:165px}
                .search-input::placeholder{color:var(--t3)}
                .search-clear{background:none;border:none;color:var(--t3);cursor:pointer;font-size:.72rem;padding:0 .1rem;transition:color .15s}.search-clear:hover{color:var(--t0)}
                .live-pill{display:flex;align-items:center;gap:.35rem;font-family:var(--mono);font-size:.6rem;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--g1);padding:.26rem .68rem;background:var(--ga);border:1px solid rgba(16,185,129,.14);border-radius:20px}
                .live-dot{width:5px;height:5px;border-radius:50%;background:var(--g0);box-shadow:0 0 6px rgba(16,185,129,.6);animation:blink 2.4s ease infinite}
                .live-dot.syncing{background:#f59e0b;animation:spin .8s linear infinite}
                @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
                /* NOTIFICATION BELL */
                .notif-bell{position:relative;width:34px;height:34px;border-radius:8px;background:var(--s2);border:1px solid var(--b1);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--t2);transition:background .15s,color .15s}
                .notif-bell:hover{background:var(--s3);color:var(--t0)}
                .notif-badge{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:#ef4444;color:#fff;font-size:.6rem;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid var(--bg)}
                /* NOTIFICATION PANEL */
                .notif-overlay{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);display:flex;justify-content:flex-end;align-items:flex-start;padding-top:64px}
                .notif-panel{width:360px;max-height:calc(100vh - 80px);background:var(--s2);border:1px solid var(--b2);border-radius:16px 0 0 16px;display:flex;flex-direction:column;overflow:hidden;margin-right:0;box-shadow:-20px 0 60px rgba(0,0,0,.4);animation:slideLeft .25s ease}
                @keyframes slideLeft{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
                .notif-hdr{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--b0);flex-shrink:0}
                .notif-title{font-size:.88rem;font-weight:700;color:var(--t0)}
                .notif-mark-read{background:none;border:none;font-family:var(--mono);font-size:.62rem;color:var(--g0);cursor:pointer;letter-spacing:.04em;transition:opacity .15s}
                .notif-mark-read:hover{opacity:.7}
                .notif-list{flex:1;overflow-y:auto}
                .notif-item{width:100%;display:flex;align-items:flex-start;gap:.75rem;padding:.9rem 1.25rem;background:transparent;border:none;border-bottom:1px solid var(--b0);cursor:pointer;text-align:left;transition:background .15s}
                .notif-item:last-child{border-bottom:none}
                .notif-item:hover{background:var(--s3)}
                .notif-item.unseen{background:rgba(16,185,129,.04)}
                .notif-dot-wrap{width:12px;flex-shrink:0;padding-top:.3rem;display:flex;justify-content:center}
                .notif-dot{width:7px;height:7px;border-radius:50%;background:var(--g0);box-shadow:0 0 6px rgba(16,185,129,.5)}
                .notif-content{flex:1;min-width:0}
                .notif-name{font-size:.85rem;font-weight:600;color:var(--t0);margin-bottom:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .notif-sub{font-size:.72rem;color:var(--t2)}
                .notif-arrow{font-size:.75rem;color:var(--t3);flex-shrink:0;margin-top:.2rem}
                .notif-empty{padding:2rem;text-align:center;color:var(--t3);font-size:.85rem}
                /* TOASTS */
                .toast-stack{position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;align-items:flex-end}
                .toast{padding:.72rem 1.2rem;border-radius:10px;font-size:.83rem;font-weight:500;animation:slideUp .3s ease;box-shadow:0 8px 32px -8px rgba(0,0,0,.5);display:flex;align-items:center;gap:.5rem;max-width:320px}
                .toast-success{background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.25);color:#34d399}
                .toast-error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);color:#ef4444}
                .toast-info{background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);color:#60a5fa}
                .toast-notif{background:var(--s3);border:1px solid var(--b2);color:var(--t0)}
                .toast-bell{font-size:.9rem}
                @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
                /* BULK BAR */
                .bulk-bar{display:flex;align-items:center;gap:1rem;padding:.75rem 1.75rem;background:rgba(16,185,129,.06);border-bottom:1px solid rgba(16,185,129,.15);flex-shrink:0;flex-wrap:wrap}
                .bulk-count{font-family:var(--mono);font-size:.72rem;font-weight:600;color:var(--g1);letter-spacing:.06em;white-space:nowrap}
                .bulk-actions{display:flex;gap:.5rem;flex-wrap:wrap}
                .bulk-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.38rem .85rem;border:none;border-radius:7px;font-family:var(--font);font-size:.78rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s;white-space:nowrap}
                .bulk-btn:hover{opacity:.85;transform:translateY(-1px)}.bulk-btn:disabled{opacity:.5;cursor:default;transform:none}
                .bulk-approve{background:rgba(52,211,153,.12);color:#34d399;border:1px solid rgba(52,211,153,.22)}
                .bulk-reject {background:rgba(239,68,68,.1); color:#ef4444;border:1px solid rgba(239,68,68,.2)}
                .bulk-delete {background:rgba(239,68,68,.08);color:#ef4444;border:1px solid rgba(239,68,68,.15)}
                .bulk-clear  {background:var(--s3);color:var(--t2);border:1px solid var(--b1)}
                .bulk-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.2);border-top-color:var(--g0);border-radius:50%;animation:spin .7s linear infinite}
                /* BULK APPROVAL BAR */
                .bulk-approval-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.18);border-radius:12px;margin-bottom:1.25rem;flex-wrap:wrap}
                .bulk-approval-title{font-size:.88rem;font-weight:700;color:var(--t0);display:block;margin-bottom:.2rem}
                .bulk-approval-sub{font-family:var(--mono);font-size:.62rem;color:var(--t3)}
                .bulk-approval-btns{display:flex;gap:.5rem;flex-wrap:wrap}
                /* CHECKBOX */
                .cb{width:15px;height:15px;accent-color:var(--g0);cursor:pointer;flex-shrink:0}
                .selected-row{background:rgba(16,185,129,.04) !important}
                /* CONTENT */
                .content{flex:1;padding:1.75rem;overflow-y:auto}
                .loading-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:1rem;color:var(--t2);font-size:.88rem}
                .spinner{width:28px;height:28px;border:2px solid var(--b1);border-top-color:var(--g0);border-radius:50%;animation:spin .7s linear infinite}
                @keyframes spin{to{transform:rotate(360deg)}}
                /* OVERVIEW */
                .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--b0);border:1px solid var(--b1);border-radius:14px;overflow:hidden;margin-bottom:1.5rem}
                .stat-card{background:var(--s2);padding:1.35rem 1.2rem;display:flex;align-items:center;gap:.88rem;transition:background .2s}.stat-card:hover{background:var(--s3)}
                .stat-icon{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
                .stat-val{font-size:1.75rem;font-weight:700;letter-spacing:-.05em;line-height:1;margin-bottom:.16rem}
                .stat-label{font-family:var(--mono);font-size:.58rem;color:var(--t3);letter-spacing:.07em;text-transform:uppercase}
                .ov-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}
                .panel{background:var(--s2);border:1px solid var(--b1);border-radius:12px;overflow:hidden}
                .panel-hdr{display:flex;justify-content:space-between;align-items:center;padding:.88rem 1.2rem;border-bottom:1px solid var(--b0)}
                .panel-title{font-size:.8rem;font-weight:600;color:var(--t0)}
                .panel-link{background:none;border:none;font-family:var(--mono);font-size:.6rem;color:var(--g0);cursor:pointer;letter-spacing:.04em;transition:opacity .2s}.panel-link:hover{opacity:.7}
                .panel-row{display:flex;align-items:center;gap:.82rem;padding:.68rem 1.2rem;border-bottom:1px solid var(--b0);transition:background .15s}.panel-row:last-child{border-bottom:none}.panel-row:hover{background:var(--s3)}
                .panel-row-main{flex:1;min-width:0}
                .panel-row-name{font-size:.82rem;font-weight:600;color:var(--t0);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                .panel-row-sub{font-size:.7rem;color:var(--t2)}
                .panel-row-time{font-family:var(--mono);font-size:.6rem;color:var(--t3);white-space:nowrap}
                .bar-row{display:flex;align-items:center;gap:.88rem;padding:.78rem 1.2rem;border-bottom:1px solid var(--b0)}.bar-row:last-child{border-bottom:none}
                .bar-label{font-size:.8rem;color:var(--t1);width:62px;flex-shrink:0}
                .bar-track{flex:1;height:3px;background:var(--b1);border-radius:2px;overflow:hidden}
                .bar-fill{height:100%;border-radius:2px;transition:width 1.2s cubic-bezier(.25,1,.5,1)}
                .bar-count{font-family:var(--mono);font-size:.8rem;font-weight:600;width:20px;text-align:right;flex-shrink:0}
                /* TABLE */
                .table-box{background:var(--s2);border:1px solid var(--b1);border-radius:12px;overflow:hidden}
                .tbl{width:100%;border-collapse:collapse}
                .tbl thead tr{background:var(--s3);border-bottom:1px solid var(--b1)}
                .tbl th{padding:.78rem 1.2rem;text-align:left;font-family:var(--mono);font-size:.58rem;font-weight:500;color:var(--t3);letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}
                .tbl tbody tr{border-bottom:1px solid var(--b0);transition:background .15s;animation:fadeRow .4s ease both}.tbl tbody tr:last-child{border-bottom:none}.tbl tbody tr:hover{background:var(--s3)}
                .tbl td{padding:.82rem 1.2rem;font-size:.82rem;color:var(--t1);vertical-align:middle}
                @keyframes fadeRow{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:translateX(0)}}
                .cell-user{display:flex;align-items:center;gap:.62rem}
                .av{width:27px;height:27px;border-radius:7px;background:var(--ga);border:1px solid rgba(16,185,129,.2);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:600;color:var(--g1);flex-shrink:0}
                .cell-farm{display:flex;align-items:center;gap:.62rem}
                .farm-ic{width:27px;height:27px;border-radius:7px;background:var(--ga);border:1px solid rgba(16,185,129,.14);display:flex;align-items:center;justify-content:center;font-size:.82rem;flex-shrink:0}
                .fw{font-weight:600;color:var(--t0)}.dim{color:var(--t2)}.mono{font-family:var(--mono)}
                .inline-select{background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:6px;padding:.28rem .58rem;font-family:var(--font);font-size:.75rem;font-weight:500;cursor:pointer;outline:none;transition:border-color .2s}
                .inline-select:hover{border-color:var(--b2)}.inline-select:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 2px rgba(16,185,129,.07)}
                .inline-select option{background:var(--s3);color:var(--t0)}
                .ab-group{display:flex;gap:.38rem;flex-wrap:wrap}
                .ab{padding:.26rem .62rem;border:none;border-radius:6px;font-family:var(--font);font-size:.7rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s;white-space:nowrap}
                .ab:hover{opacity:.85;transform:translateY(-1px)}
                .ab-view   {background:var(--s4);color:var(--t1);border:1px solid var(--b1)}
                .ab-edit   {background:rgba(96,165,250,.1);color:#60a5fa;border:1px solid rgba(96,165,250,.2)}
                .ab-del    {background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
                .ab-approve{background:rgba(52,211,153,.1);color:#34d399;border:1px solid rgba(52,211,153,.2)}
                .badge{display:inline-flex;align-items:center;padding:.16rem .5rem;border-radius:5px;font-family:var(--mono);font-size:.6rem;font-weight:600;letter-spacing:.05em;white-space:nowrap}
                .empty{text-align:center;padding:2.5rem;color:var(--t3);font-size:.88rem}
                /* APPROVALS */
                .approvals{display:flex;flex-direction:column;gap:1.75rem}
                .ap-section{}
                .ap-hdr{display:flex;align-items:center;gap:.62rem;margin-bottom:.82rem}
                .ap-title{font-family:var(--mono);font-size:.7rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase}
                .ap-count{font-family:var(--mono);font-size:.65rem;color:var(--t3);padding:.07rem .42rem;background:var(--s3);border:1px solid var(--b1);border-radius:20px}
                .ap-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:.9rem}
                .ap-card{background:var(--s2);border:1px solid rgba(245,158,11,.2);border-radius:12px;padding:1.35rem;position:relative;overflow:hidden;transition:border-color .2s,box-shadow .2s}
                .ap-card:hover{border-color:rgba(245,158,11,.35);box-shadow:0 0 28px -10px rgba(245,158,11,.07)}
                .ap-card-selected{border-color:rgba(16,185,129,.4) !important;background:rgba(16,185,129,.04) !important}
                .ap-card-glow{position:absolute;top:-35px;right:-35px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(245,158,11,.07),transparent 65%);pointer-events:none}
                .ap-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.9rem;margin-bottom:.6rem}
                .ap-name{font-size:.92rem;font-weight:700;letter-spacing:-.02em;color:var(--t0);margin-bottom:.28rem}
                .ap-meta{font-size:.72rem;color:var(--t2);display:flex;align-items:center;gap:.32rem;flex-wrap:wrap}.sep{color:var(--t3)}
                .ap-id{font-family:var(--mono);font-size:.58rem;color:var(--t3);margin-bottom:1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .ap-actions{display:flex;gap:.45rem;flex-wrap:wrap}
                .ap-btn{display:inline-flex;align-items:center;gap:.32rem;padding:.48rem .88rem;border:none;border-radius:7px;font-family:var(--font);font-size:.78rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s}
                .ap-btn:hover{opacity:.87;transform:translateY(-1px)}
                .ap-approve{background:rgba(52,211,153,.12);color:#34d399;border:1px solid rgba(52,211,153,.22)}
                .ap-reject {background:rgba(239,68,68,.1); color:#ef4444;border:1px solid rgba(239,68,68,.2)}
                .ap-edit   {background:rgba(96,165,250,.1); color:#60a5fa;border:1px solid rgba(96,165,250,.18)}
                .ap-view   {background:var(--s3);color:var(--t1);border:1px solid var(--b1)}
                .ap-empty{padding:1.2rem;color:var(--t3);font-size:.82rem}
                .compact-list{background:var(--s2);border:1px solid var(--b1);border-radius:10px;overflow:hidden}
                .compact-row{display:flex;align-items:center;gap:.85rem;padding:.78rem 1.2rem;border-bottom:1px solid var(--b0);transition:background .15s}.compact-row:last-child{border-bottom:none}.compact-row:hover{background:var(--s3)}
                .compact-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.82rem}
                .compact-crop{width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.73rem}
                .compact-time{font-size:.6rem;width:56px;text-align:right;flex-shrink:0}
                /* MODAL */
                .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(6px);z-index:200;display:flex;align-items:center;justify-content:center;padding:2rem;animation:fadeIn .2s ease}
                @keyframes fadeIn{from{opacity:0}to{opacity:1}}
                .modal{background:var(--s2);border:1px solid var(--b2);border-radius:18px;width:100%;max-width:460px;overflow:hidden;animation:modalIn .3s cubic-bezier(.25,1,.5,1);box-shadow:0 40px 80px -20px rgba(0,0,0,.7)}
                @keyframes modalIn{from{opacity:0;transform:translateY(20px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
                .modal-hdr{display:flex;justify-content:space-between;align-items:center;padding:1.2rem 1.4rem;border-bottom:1px solid var(--b0)}
                .modal-title{font-size:.95rem;font-weight:700;letter-spacing:-.025em;color:var(--t0)}
                .modal-close{background:none;border:none;color:var(--t3);cursor:pointer;font-size:.88rem;padding:.2rem .38rem;border-radius:5px;transition:color .15s,background .15s}.modal-close:hover{color:var(--t0);background:var(--s3)}
                .modal-body{padding:1.4rem;display:flex;flex-direction:column;gap:1rem}
                .modal-field{display:flex;flex-direction:column;gap:.38rem}
                .modal-field label{font-family:var(--mono);font-size:.6rem;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--t3)}
                .modal-field input,.modal-field select{padding:.68rem .88rem;background:var(--s3);color:var(--t0);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.85rem;outline:none;transition:border-color .2s,box-shadow .2s}
                .modal-field input:focus,.modal-field select:focus{border-color:rgba(16,185,129,.4);box-shadow:0 0 0 3px rgba(16,185,129,.08)}
                .modal-field input::placeholder{color:var(--t3)}
                .modal-field select option{background:var(--s3);color:var(--t0)}
                .modal-ftr{display:flex;justify-content:flex-end;gap:.7rem;padding:1.2rem 1.4rem;border-top:1px solid var(--b0)}
                .modal-cancel{padding:.62rem 1.2rem;background:var(--s3);color:var(--t1);border:1px solid var(--b1);border-radius:8px;font-family:var(--font);font-size:.82rem;font-weight:500;cursor:pointer;transition:background .2s}.modal-cancel:hover{background:var(--s4)}
                .modal-save{padding:.62rem 1.45rem;background:var(--g0);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:.82rem;font-weight:600;cursor:pointer;transition:opacity .2s,transform .15s}.modal-save:hover{opacity:.88;transform:translateY(-1px)}.modal-save:disabled{opacity:.5;cursor:default;transform:none}
                @media(max-width:1100px){.stats-row{grid-template-columns:repeat(2,1fr)}.ov-grid{grid-template-columns:1fr}}
                @media(max-width:768px){.sidebar{display:none}.content{padding:1.25rem}.stats-row{grid-template-columns:1fr 1fr}.ap-cards{grid-template-columns:1fr}}
            `}</style>
        </div>
    );
}

const GridIcon   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
const UsersIcon  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const LayerIcon  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
const CheckIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const XIcon      = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const ClockIcon  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const BackIcon   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
const SearchIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const TrashIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const BellIcon   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
function RefreshIcon({ spinning }: { spinning: boolean }) {
    return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: spinning ? "spin .7s linear infinite" : "none" }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
}