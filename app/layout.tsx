import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockroom — Public Treasury Launchpad",
  description: "Launch a token with a public treasury behind it.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
