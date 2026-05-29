import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "LENS · Document Index",
  description: "Collecte collaborative de documents financiers pour l'analyse crédit",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Syne:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
