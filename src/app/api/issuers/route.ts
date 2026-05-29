import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("issuers")
    .select("*")
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()
  const { data, error } = await supabase
    .from("issuers")
    .insert({
      ticker: body.ticker,
      name: body.name,
      sector: body.sector || "",
      investor_relations_url: body.investorRelationsUrl || null,
      docs: [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(dbToIssuer(data))
}

export async function PUT(req: NextRequest) {
  const supabase = getSupabase()
  const body = await req.json()
  const { data, error } = await supabase
    .from("issuers")
    .update({
      ticker: body.ticker,
      name: body.name,
      sector: body.sector || "",
      investor_relations_url: body.investorRelationsUrl || null,
      docs: body.docs,
    })
    .eq("id", body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(dbToIssuer(data))
}

export async function DELETE(req: NextRequest) {
  const supabase = getSupabase()
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  const { error } = await supabase.from("issuers").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function dbToIssuer(row: any) {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    investorRelationsUrl: row.investor_relations_url || "",
    docs: row.docs || [],
    addedAt: row.created_at,
  }
}
