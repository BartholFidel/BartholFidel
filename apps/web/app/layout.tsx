import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BartholFidel",
  description:
    "Professional behavioral anomaly detection and threat prevention platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
