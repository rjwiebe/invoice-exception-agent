import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ReviewerSwitcher } from "@/components/ReviewerSwitcher";
import { currentReviewer, REVIEWERS } from "@/lib/users";
import { currentDemoSessionId } from "@/lib/session";
import { ensureDemoSession } from "@/lib/seed";

export const metadata: Metadata = { title: "Invoice Exception Agent", description: "AI-assisted invoice exception handling with human approval and a tamper-evident audit log." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sessionId = await currentDemoSessionId();
  await ensureDemoSession(sessionId);
  const me = currentReviewer(sessionId);
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand"><i /> Invoice Exception Agent</Link>
          <nav className="nav">
            <Link href="/">Inbox</Link>
            <Link href="/new">Submit invoice</Link>
            <Link href="/audit">Audit log</Link>
            <Link href="/data">Vendors &amp; POs</Link>
          </nav>
          <div className="demo-identity">
            <span>Simulated role · not authentication</span>
            <ReviewerSwitcher reviewers={REVIEWERS} currentId={me.id} />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
