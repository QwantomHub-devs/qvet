import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talent Vetting Platform | AI, IoT & Robotics Certification",
  description:
    "Verify and certify engineering talent in AI, IoT, and Robotics through a rigorous five-stage assessment pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}

