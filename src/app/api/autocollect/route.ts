import OpenAI from "openai"
import { NextRequest } from "next/server"
import { SYSTEM_PROMPT } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 60

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://lens-collector.app",
    "X-Title": "LENS Document Collector",
  },
})

async function braveSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return "[Brave Search API key manquante]"
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&lang=fr`
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
    })
    if (!res.ok) return `[Brave Search erreur: ${res.status}]`
    const data = await res.json()
    const results = (data.web?.results || []) as any[]
    return results.map((r: any) => `Titre: ${r.title}\nURL: ${r.url}\nDescription: ${r.description || ""}`).join("\n\n")
  } catch (e: any) {
    return `[Brave Search erreur: ${e.message}]`
  }
}

function sseMessage(event: string, data: object) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function buildQueries(
  name: string,
  ticker: string,
  irUrl: string | undefined,
  docTypes: string[],
  years: string[]
): string[] {
  const yearStr = years.join(" OR ")
  const irSite = irUrl ? `site:${new URL(irUrl).hostname}` : ""
  const queries: string[] = []

  // Always try IR site first if available
  const irPrefix = irSite ? `${irSite} ` : `"${name}" `

  // Group doc types into search queries
  const hasReglementaire = docTypes.some(t => ["Rapport annuel / URD", "Document d'enregistrement universel", "Rapport de gestion"].includes(t))
  const hasSemestriel = docTypes.some(t => t.toLowerCase().includes("semestr"))
  const hasTrimestriel = docTypes.some(t => t.toLowerCase().includes("trimestr") || t.match(/T[1-4]/))
  const hasFinancier = docTypes.some(t => ["États financiers consolidés", "Communiqué résultats annuels"].includes(t))
  const hasObligataire = docTypes.some(t => ["Prospectus d'émission", "Conditions définitives (Final Terms)", "Note d'information EMTN"].includes(t))
  const hasStrategique = docTypes.some(t => t.toLowerCase().includes("stratég") || t.toLowerCase().includes("esg"))
  const hasCredit = docTypes.some(t => t.toLowerCase().includes("notation") || t.toLowerCase().includes("crédit"))

  if (hasReglementaire || hasFinancier) {
    queries.push(`${irPrefix}${name} rapport annuel URD document enregistrement universel ${yearStr}`)
  }
  if (hasSemestriel) {
    queries.push(`${irPrefix}${name} rapport semestriel résultats semestriels ${yearStr}`)
  }
  if (hasTrimestriel) {
    const quarters = docTypes.filter(t => t.match(/T[1-4]/)).map(t => t.match(/T[1-4]/)![0])
    const qStr = quarters.length > 0 ? quarters.join(" OR ") : "T1 OR T2 OR T3 OR T4"
    queries.push(`${irPrefix}${name} communiqué résultats chiffre affaires ${qStr} ${yearStr}`)
  }
  if (hasObligataire) {
    queries.push(`"${name}" ${ticker} prospectus émission obligataire EMTN ${yearStr}`)
  }
  if (hasStrategique) {
    queries.push(`${irPrefix}${name} capital markets day présentation investisseurs RSE ESG ${yearStr}`)
  }
  if (hasCredit) {
    queries.push(`"${name}" notation crédit Moody's S&P Fitch rating ${yearStr}`)
  }

  // Fallback if no type selected
  if (queries.length === 0) {
    queries.push(`${irPrefix}${name} rapport annuel URD ${yearStr}`)
    queries.push(`"${name}" ${ticker} résultats financiers ${yearStr}`)
    queries.push(`"${name}" prospectus obligataire ${yearStr}`)
  }

  return queries.slice(0, 4) // max 4 queries to avoid rate limits
}

export async function POST(req: NextRequest) {
  const { name, ticker, sector, irUrl, docTypes, years } = await req.json()

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)))
      }

      try {
        const queries = buildQueries(name, ticker, irUrl, docTypes || [], years || [String(new Date().getFullYear())])
        let allContent = ""

        for (let i = 0; i < queries.length; i++) {
          send("step", { status: "active", msg: `Requête ${i + 1}/${queries.length} : ${queries[i].slice(0, 60)}…` })
          const results = await braveSearch(queries[i])
          allContent += `\n\n--- Requête ${i + 1} ---\n${results}`
          send("step", { status: "done", msg: `Requête ${i + 1}/${queries.length} terminée` })
          if (i < queries.length - 1) await new Promise(r => setTimeout(r, 8000))
        }

        send("step", { status: "active", msg: "Classification IA (Claude via OpenRouter)…" })

        const docFilter = docTypes?.length > 0 ? `\nTypes de documents recherchés : ${docTypes.join(", ")}` : ""
        const yearFilter = years?.length > 0 ? `\nAnnées ciblées : ${years.join(", ")}` : ""

        const completion = await openrouter.chat.completions.create({
          model: "anthropic/claude-sonnet-4-5",
          max_tokens: 2048,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Émetteur : "${name}" (ticker: ${ticker}, secteur: ${sector})${docFilter}${yearFilter}\n\nRésultats de recherche :\n${allContent}\n\nExtrait et classe uniquement les documents correspondant aux types et années demandés.`,
            },
          ],
        })

        const raw = (completion.choices[0]?.message?.content || "")
          .replace(/```json\n?/g, "").replace(/```/g, "").trim()
        const parsed = JSON.parse(raw)
        const docs = parsed.documents || []

        send("step", { status: "done", msg: `${docs.length} document${docs.length > 1 ? "s" : ""} identifié${docs.length > 1 ? "s" : ""}` })
        send("result", { documents: docs })
      } catch (err: any) {
        send("error", { message: err.message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  })
}
