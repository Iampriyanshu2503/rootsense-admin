import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Uses service role key — bypasses RLS, only runs server-side
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
    const { data, error } = await supabaseAdmin
        .from("users")
        .select("id, email, created_at, first_name, last_name, global_role, auth_provider")
        .order("created_at", { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: data });
}