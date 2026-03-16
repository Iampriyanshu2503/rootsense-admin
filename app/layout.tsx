import type { Metadata } from "next";
import { JetBrains_Mono, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono  = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
    title: "Rootsense Admin",
    description: "Rootsense Admin Console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${inter.variable} ${mono.variable}`}
                style={{ margin: 0, background: "#080807", color: "#f0f0ec", fontFamily: "var(--font-sans)" }}>
                {children}
            </body>
        </html>
    );
}
