import { NextRequest, NextResponse } from "next/server";

// Auth disabled temporarily — re-enable when Kinde is configured
export function middleware(req: NextRequest) {
    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};