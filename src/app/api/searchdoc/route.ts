import OpenAI from "openai"
import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 30

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "https://lens-collector.app", "X-Title": "LENS Document Collector" },
})

async function braveSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return "[Brave Search API key manquante]"
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&lang=fr`
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
    })
    if (!res.ok) return `[erreur: ${res.status}]`
    const data = await res.json()
    return (data.web?.results || []).map((r: any) => `Titre: ${r.title}\nURL: ${r.url}\nDescription: ${r.description || ""}`).join("\n\n")
  } catch (e: any) { return `[erreur: ${e.message}]` }
}

export async function POST(req: NextRequest) {
  const { issuerName, ticker, docType, year, quarter, irUrl } = await req.json()

  const irSite = irUrl ? `site:${new URL(irUrl).hostname} OR ` : ""
  const quarterStr = quarter ? ` ${quarter}` : ""
  const query = `${irSite}"${issuerName}" ${docType}${quarterStr} ${year}`

  const results = await braveSearch(query)

  const completion = await openrouter.chat.completions.create({
    model: "anthropic/claude-sonnet-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content: `Tu cherches l'URL directe d'un document financier précis. Réponds UNIQUEMENT en JSON : {"url": "URL directe ou null", "confidence": "high|medium|low", "note": "explication courte"}. Priorise les URLs du site investisseurs officiel. Ne jamais inventer d'URL.`,
      },
      {
        role: "user",
        content: `Émetteur : "${issuerName}" (${ticker})\nDocument cherché : ${docType}${quarter ? ` - ${quarter}` : ""} ${year}\n\nRésultats de recherche :\n${results}`,
      },
    ],
  })

  const raw = (completion.choices[0]?.message?.content || "").replace(/```json\n?/g, "").replace(/```/g, "").trim()
  try {
    return Response.json(JSON.parse(raw))
  } catch {
    return Response.json({ url: null, confidence: "low", note: "Parsing error" })
  }
}
