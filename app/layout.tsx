import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AgentReady — Is your website ready for AI agents?",
  description: "Free scan: see whether ChatGPT, Claude and other AI agents can reach, read and use your website. Get a full fix-it report.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
