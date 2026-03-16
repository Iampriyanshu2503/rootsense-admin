"use client";
import { useRouter } from "next/navigation";

export default function Unauthorized() {
    const router = useRouter();
    return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", fontFamily: "var(--font-sans)", background: "#080807", color: "#f0f0ec" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem" }}>🔒</div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-.03em", margin: 0 }}>Access Denied</h1>
            <p style={{ color: "rgba(240,240,236,.5)", fontSize: ".9rem", margin: 0 }}>Your account is not authorised to access the admin console.</p>
            <button
                onClick={() => router.push("/api/auth/logout")}
                style={{ marginTop: ".5rem", padding: ".6rem 1.4rem", background: "rgba(239,68,68,.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, fontFamily: "var(--font-sans)", fontSize: ".85rem", fontWeight: 600, cursor: "pointer" }}
            >
                Sign out
            </button>
        </div>
    );
}
