"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Issuer, LensDocument, CATEGORIES, DOC_STATUSES, YEAR_RANGE, CURRENT_YEAR } from "@/lib/types"
import styles from "./page.module.css"

function nid() { return `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function dbToIssuer(row: any): Issuer {
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

interface SearchStep { status: "active" | "done" | "warn" | "error"; msg: string }
interface FoundDoc { type: string; category: string; year: string | null; quarter?: string | null; url: string | null; confidence: "high" | "medium" | "low" }

const ALL_DOC_TYPES = Object.values(CATEGORIES).flat()

export default function Home() {
  const [issuers, setIssuers] = useState<Issuer[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<"connected" | "connecting" | "error">("connecting")
  const [modal, setModal] = useState<string | null>(null)
  const [newIssuer, setNewIssuer] = useState({ ticker: "", name: "", sector: "", investorRelationsUrl: "" })
  const [newDoc, setNewDoc] = useState({ category: "Réglementaire", type: "", year: String(CURRENT_YEAR), status: "pending" as const, url: "", quarter: "" })
  const [acDocTypes, setAcDocTypes] = useState<string[]>([])
  const [acYears, setAcYears] = useState<string[]>([String(CURRENT_YEAR)])
  const [acCategoryFilter, setAcCategoryFilter] = useState<string>("all")
  const [searchSteps, setSearchSteps] = useState<SearchStep[]>([])
  const [foundDocs, setFoundDocs] = useState<FoundDoc[]>([])
  const [selDocs, setSelDocs] = useState<Set<number>>(new Set())
  const [searching, setSearching] = useState(false)
  const [searchTarget, setSearchTarget] = useState<Issuer | null>(null)
  const [searchingDocId, setSearchingDocId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Load initial data
  const fetchIssuers = useCallback(async () => {
    const { data, error } = await supabase
      .from("issuers")
      .select("*")
      .order("created_at", { ascending: true })
    if (!error && data) {
      const mapped = data.map(dbToIssuer)
      setIssuers(mapped)
      setActiveId(prev => prev ?? (mapped.length > 0 ? mapped[0].id : null))
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchIssuers() }, [fetchIssuers])

  // Supabase Realtime subscription
  useEffect(() => {
    setSyncStatus("connecting")
    const channel = supabase
      .channel("issuers-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "issuers" }, payload => {
        if (payload.eventType === "INSERT") {
          setIssuers(p => [...p, dbToIssuer(payload.new)])
        } else if (payload.eventType === "UPDATE") {
          setIssuers(p => p.map(i => i.id === payload.new.id ? dbToIssuer(payload.new) : i))
        } else if (payload.eventType === "DELETE") {
          setIssuers(p => p.filter(i => i.id !== payload.old.id))
        }
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") setSyncStatus("connected")
        else if (status === "CLOSED" || status === "CHANNEL_ERROR") setSyncStatus("error")
      })

    return () => { supabase.removeChannel(channel) }
  }, [])

  const saveIssuer = async (updated: Issuer) => {
    const { data, error } = await supabase
      .from("issuers")
      .update({
        ticker: updated.ticker,
        name: updated.name,
        sector: updated.sector,
        investor_relations_url: updated.investorRelationsUrl || null,
        docs: updated.docs,
      })
      .eq("id", updated.id)
      .select()
      .single()
    if (!error && data) {
      setIssuers(p => p.map(i => i.id === updated.id ? dbToIssuer(data) : i))
    }
  }

  const addIssuer = async () => {
    if (!newIssuer.ticker.trim() || !newIssuer.name.trim()) return
    const { data, error } = await supabase
      .from("issuers")
      .insert({
        ticker: newIssuer.ticker,
        name: newIssuer.name,
        sector: newIssuer.sector || "",
        investor_relations_url: newIssuer.investorRelationsUrl || null,
        docs: [],
      })
      .select()
      .single()
    if (!error && data) {
      const created = dbToIssuer(data)
      setIssuers(p => [...p, created])
      setActiveId(created.id)
    }
    setNewIssuer({ ticker: "", name: "", sector: "", investorRelationsUrl: "" })
    setModal(null)
  }

  const addDoc = async () => {
    if (!newDoc.type) return
    const active = issuers.find(i => i.id === activeId)
    if (!active) return
    const doc: LensDocument = { ...newDoc, id: nid(), quarter: newDoc.quarter || null, addedAt: new Date().toISOString() }
    await saveIssuer({ ...active, docs: [...active.docs, doc] })
    setNewDoc({ category: "Réglementaire", type: "", year: String(CURRENT_YEAR), status: "pending", url: "", quarter: "" })
    setModal(null)
  }

  const deleteDoc = async (docId: string) => {
    const active = issuers.find(i => i.id === activeId)
    if (!active) return
    await saveIssuer({ ...active, docs: active.docs.filter(d => d.id !== docId) })
  }

  const searchForDoc = async (doc: LensDocument) => {
    const active = issuers.find(i => i.id === activeId)
    if (!active) return
    setSearchingDocId(doc.id)
    try {
      const res = await fetch("/api/searchdoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuerName: active.name, ticker: active.ticker,
          docType: doc.type, year: doc.year, quarter: doc.quarter || null,
          irUrl: active.investorRelationsUrl || null,
        }),
      })
      const result = await res.json()
      const updatedDoc = result.url
        ? { ...doc, url: result.url, status: "collected" as const }
        : { ...doc, status: DOC_STATUSES[(DOC_STATUSES.indexOf(doc.status) + 1) % 3] }
      await saveIssuer({ ...active, docs: active.docs.map(d => d.id === doc.id ? updatedDoc : d) })
    } catch (e) { console.error(e) }
    finally { setSearchingDocId(null) }
  }

  const openAutoCollect = (issuer: Issuer) => {
    setSearchTarget(issuer); setSearchSteps([]); setFoundDocs([]); setSelDocs(new Set())
    setAcDocTypes([]); setAcYears([String(CURRENT_YEAR)]); setAcCategoryFilter("all")
    setModal("search")
  }

  const runAutoCollect = async () => {
    if (!searchTarget) return
    setSearching(true); setSearchSteps([]); setFoundDocs([])
    abortRef.current = new AbortController()
    try {
      const res = await fetch("/api/autocollect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: searchTarget.name, ticker: searchTarget.ticker, sector: searchTarget.sector, irUrl: searchTarget.investorRelationsUrl || null, docTypes: acDocTypes, years: acYears }),
        signal: abortRef.current.signal,
      })
      const reader = res.body!.getReader(); const decoder = new TextDecoder(); let buffer = ""
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n"); buffer = lines.pop() || ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if ("msg" in payload) setSearchSteps(p => { const last = p[p.length - 1]; if (last?.status === "active") return [...p.slice(0, -1), payload]; return [...p, payload] })
            if ("documents" in payload) { setFoundDocs(payload.documents); setSelDocs(new Set(payload.documents.map((_: any, i: number) => i))) }
            if ("error" in payload) setSearchSteps(p => [...p, { status: "error", msg: payload.message }])
          } catch {}
        }
      }
    } catch (err: any) { if (err.name !== "AbortError") setSearchSteps(p => [...p, { status: "error", msg: err.message }]) }
    finally { setSearching(false) }
  }

  const importSelected = async () => {
    if (!searchTarget) return
    const toImport = foundDocs.filter((_, i) => selDocs.has(i))
    const newDocs: LensDocument[] = toImport.map(d => ({ id: nid(), category: d.category, type: d.type, year: d.year || String(CURRENT_YEAR), quarter: d.quarter || null, status: d.url ? "collected" : "pending", url: d.url || "", addedAt: new Date().toISOString() }))
    const issuer = issuers.find(i => i.id === searchTarget.id)
    if (!issuer) return
    await saveIssuer({ ...issuer, docs: [...issuer.docs, ...newDocs] })
    setModal(null)
  }

  const exportJSON = () => JSON.stringify(issuers.map(iss => ({ issuer_id: iss.id, ticker: iss.ticker, name: iss.name, sector: iss.sector, export_timestamp: new Date().toISOString(), document_coverage: { total: iss.docs.length, collected: iss.docs.filter(d => d.status === "collected").length, pending: iss.docs.filter(d => d.status === "pending").length, missing: iss.docs.filter(d => d.status === "missing").length }, documents: iss.docs.filter(d => d.status === "collected").map(d => ({ doc_id: d.id, category: d.category, type: d.type, fiscal_year: d.year, quarter: d.quarter || null, url: d.url || null, ready_for_llm: !!d.url })) })), null, 2)

  const downloadJSON = () => { const blob = new Blob([exportJSON()], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "lens_document_index.json"; a.click(); URL.revokeObjectURL(url) }

  const toggleDocType = (t: string) => setAcDocTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])
  const toggleYear = (y: string) => setAcYears(p => p.includes(y) ? p.filter(x => x !== y) : [...p, y])
  const filteredDocTypes = acCategoryFilter === "all" ? ALL_DOC_TYPES : (CATEGORIES[acCategoryFilter] || [])

  const active = issuers.find(i => i.id === activeId)
  const docsByCat = active ? Object.keys(CATEGORIES).reduce<Record<string, LensDocument[]>>((acc, cat) => { const docs = active.docs.filter(d => d.category === cat); if (docs.length) acc[cat] = docs; return acc }, {}) : {}
  const totC = issuers.reduce((s, i) => s + i.docs.filter(d => d.status === "collected").length, 0)
  const totP = issuers.reduce((s, i) => s + i.docs.filter(d => d.status === "pending").length, 0)
  const totM = issuers.reduce((s, i) => s + i.docs.filter(d => d.status === "missing").length, 0)
  const allSel = foundDocs.length > 0 && selDocs.size === foundDocs.length

  const syncColor = syncStatus === "connected" ? "#4aaa5e" : syncStatus === "connecting" ? "#c49a2a" : "#c44a4a"
  const syncLabel = syncStatus === "connected" ? "temps réel · Supabase" : syncStatus === "connecting" ? "connexion…" : "erreur de sync"

  if (loading) return <div className={styles.loadingScreen}><div className={styles.spinner} /><span className={styles.loadTxt}>Connexion à Supabase…</span></div>

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logo}>LENS · Document Index</div>
          <div className={styles.logoSub}>Collaboratif · Supabase</div>
          <div className={styles.collabBadge} style={{ color: syncColor }}>
            <div className={styles.collabDot} style={{ background: syncColor }} />
            {syncLabel}
          </div>
        </div>
        <div className={styles.sidebarLbl}>Émetteurs ({issuers.length})</div>
        <div className={styles.issuerList}>
          {issuers.map(iss => (
            <div key={iss.id} className={`${styles.issuerItem} ${iss.id === activeId ? styles.active : ""}`} onClick={() => setActiveId(iss.id)}>
              <span className={styles.iTick}>{iss.ticker}</span>
              <span className={styles.iName}>{iss.name}</span>
              <span className={styles.iCnt}>{iss.docs.length}</span>
            </div>
          ))}
        </div>
        <button className={styles.addBtn} onClick={() => { setNewIssuer({ ticker: "", name: "", sector: "", investorRelationsUrl: "" }); setModal("addIssuer") }}>+ Ajouter un émetteur</button>
      </aside>

      <div className={styles.mainPanel}>
        {active ? <>
          <div className={styles.pHeader}>
            <div>
              <div className={styles.pTitle}>{active.name}</div>
              <div className={styles.pMeta}>{active.ticker} · {active.sector || "—"} · {active.docs.length} docs{active.investorRelationsUrl ? " · IR ✓" : ""}</div>
            </div>
            <div className={styles.hActions}>
              <button className={styles.btnSearch} onClick={() => openAutoCollect(active)}>⌕ Auto-collect</button>
              <button className={styles.btnExport} onClick={() => setModal("export")}>⬡ JSON</button>
              <button className={styles.btnPrimary} onClick={() => { setNewDoc({ category: "Réglementaire", type: "", year: String(CURRENT_YEAR), status: "pending", url: "", quarter: "" }); setModal("addDoc") }}>+ Doc</button>
            </div>
          </div>
          <div className={styles.statsBar}>
            {([["collected", totC, "Collectés"], ["pending", totP, "En attente"], ["missing", totM, "Manquants"]] as const).map(([s, v, l]) => (
              <div key={s} className={styles.statI}><div className={`${styles.sDot} ${styles[s]}`} /><span className={styles.sLbl}>{l}</span><span className={styles.sVal}>{v}</span></div>
            ))}
            <div className={`${styles.statI} ${styles.statRight}`}><span className={styles.sLbl}>Total</span><span className={styles.sVal}>{issuers.reduce((s, i) => s + i.docs.length, 0)} docs</span></div>
          </div>
          <div className={styles.docGrid}>
            {Object.entries(docsByCat).map(([cat, docs]) => (
              <div key={cat} className={styles.catBlock}>
                <div className={styles.catHdr}><span className={styles.catLbl}>{cat}</span><div className={styles.catLine} /></div>
                <div className={styles.docItems}>
                  {docs.map(doc => (
                    <div key={doc.id} className={`${styles.docCard} ${styles[doc.status]}`}>
                      <div className={styles.docType}>{doc.type}{doc.quarter ? <span className={styles.quarterTag}>{doc.quarter}</span> : null}</div>
                      <div className={styles.docYr}>{doc.year}</div>
                      <div className={styles.docSr}>
                        <span className={`${styles.sbadge} ${styles[doc.status]}`}>{doc.status === "collected" ? "✓ collecté" : doc.status === "pending" ? "⋯ en attente" : "✕ manquant"}</span>
                        {doc.url && <a className={styles.docUrl} href={doc.url} target="_blank" rel="noreferrer" title={doc.url}>{doc.url.replace("https://", "").slice(0, 18)}…</a>}
                      </div>
                      <div className={styles.docActs}>
                        <button className={`${styles.dab} ${searchingDocId === doc.id ? styles.dabSpin : ""}`} onClick={() => searchForDoc(doc)} title="Rechercher ce document">⌕</button>
                        <button className={styles.dab} onClick={() => deleteDoc(doc.id)}>×</button>
                      </div>
                    </div>
                  ))}
                  <div className={styles.addDocCard} onClick={() => { setNewDoc(p => ({ ...p, category: cat })); setModal("addDoc") }}>+ {cat}</div>
                </div>
              </div>
            ))}
            {Object.keys(docsByCat).length === 0 && <div className={styles.empty}><div className={styles.emptyT}>Aucun document</div><div className={styles.emptyS}>Cliquez "Auto-collect" pour lancer la recherche automatique.</div></div>}
          </div>
        </> : <div className={styles.empty}><div className={styles.emptyT}>Sélectionnez un émetteur</div></div>}
      </div>

      {modal === "addIssuer" && (
        <div className={styles.overlay} onClick={e => e.currentTarget === e.target && setModal(null)}>
          <div className={styles.modal}>
            <div className={styles.mTitle}>Nouvel émetteur</div>
            <div className={styles.mSub}>Enregistré dans Supabase · visible par tous</div>
            {([["ticker", "Ticker / Identifiant"], ["name", "Nom complet"], ["sector", "Secteur"], ["investorRelationsUrl", "URL site Investor Relations (optionnel)"]] as const).map(([k, l]) => (
              <div key={k} className={styles.fg}><label className={styles.flbl}>{l}</label><input className={styles.finp} value={newIssuer[k]} onChange={e => setNewIssuer(p => ({ ...p, [k]: e.target.value }))} placeholder={l} onKeyDown={e => e.key === "Enter" && addIssuer()} /></div>
            ))}
            <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => setModal(null)}>Annuler</button><button className={styles.btnPrimary} onClick={addIssuer} disabled={!newIssuer.ticker.trim() || !newIssuer.name.trim()}>Créer</button></div>
          </div>
        </div>
      )}

      {modal === "addDoc" && (
        <div className={styles.overlay} onClick={e => e.currentTarget === e.target && setModal(null)}>
          <div className={styles.modal}>
            <div className={styles.mTitle}>Nouveau document · {active?.name}</div>
            <div className={styles.fg}><label className={styles.flbl}>Catégorie</label><select className={styles.fsel} value={newDoc.category} onChange={e => setNewDoc(p => ({ ...p, category: e.target.value, type: "" }))}>{Object.keys(CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className={styles.fg}><label className={styles.flbl}>Type</label><select className={styles.fsel} value={newDoc.type} onChange={e => setNewDoc(p => ({ ...p, type: e.target.value }))}><option value="">— Sélectionner —</option>{(CATEGORIES[newDoc.category] || []).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            {newDoc.category === "Trimestriel" && <div className={styles.fg}><label className={styles.flbl}>Trimestre</label><select className={styles.fsel} value={newDoc.quarter} onChange={e => setNewDoc(p => ({ ...p, quarter: e.target.value }))}><option value="">— Optionnel —</option>{["T1","T2","T3","T4"].map(q => <option key={q} value={q}>{q}</option>)}</select></div>}
            <div className={styles.fg}><label className={styles.flbl}>Exercice</label><select className={styles.fsel} value={newDoc.year} onChange={e => setNewDoc(p => ({ ...p, year: e.target.value }))}>{YEAR_RANGE.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
            <div className={styles.fg}><label className={styles.flbl}>Statut</label><select className={styles.fsel} value={newDoc.status} onChange={e => setNewDoc(p => ({ ...p, status: e.target.value as any }))}><option value="collected">✓ Collecté</option><option value="pending">⋯ En attente</option><option value="missing">✕ Manquant</option></select></div>
            <div className={styles.fg}><label className={styles.flbl}>URL source (optionnel)</label><input className={styles.finp} value={newDoc.url} onChange={e => setNewDoc(p => ({ ...p, url: e.target.value }))} placeholder="https://…" /></div>
            <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => setModal(null)}>Annuler</button><button className={styles.btnPrimary} onClick={addDoc} disabled={!newDoc.type}>Ajouter</button></div>
          </div>
        </div>
      )}

      {modal === "search" && (
        <div className={styles.overlay}>
          <div className={`${styles.modal} ${styles.modalWide}`}>
            <div className={styles.mTitle}>Auto-collect · {searchTarget?.name}</div>
            <div className={styles.mSub}>{searchTarget?.ticker} · {searchTarget?.sector || "—"}</div>
            {!searching && foundDocs.length === 0 && <>
              <div className={styles.filterSection}>
                <div className={styles.filterLabel}>Années</div>
                <div className={styles.chipRow}>{YEAR_RANGE.map(y => <button key={y} className={`${styles.chip} ${acYears.includes(y) ? styles.chipActive : ""}`} onClick={() => toggleYear(y)}>{y}</button>)}</div>
              </div>
              <div className={styles.filterSection}>
                <div className={styles.filterLabel}>Catégorie</div>
                <div className={styles.chipRow}>
                  <button className={`${styles.chip} ${acCategoryFilter === "all" ? styles.chipActive : ""}`} onClick={() => setAcCategoryFilter("all")}>Toutes</button>
                  {Object.keys(CATEGORIES).map(c => <button key={c} className={`${styles.chip} ${acCategoryFilter === c ? styles.chipActive : ""}`} onClick={() => setAcCategoryFilter(c)}>{c}</button>)}
                </div>
              </div>
              <div className={styles.filterSection}>
                <div className={styles.filterLabelRow}>
                  <span className={styles.filterLabel}>Types {acDocTypes.length > 0 ? `(${acDocTypes.length} sélectionnés)` : "(tous)"}</span>
                  <button className={styles.saBtn} onClick={() => setAcDocTypes(acDocTypes.length === filteredDocTypes.length ? [] : filteredDocTypes)}>{acDocTypes.length === filteredDocTypes.length ? "Tout désélectionner" : "Tout sélectionner"}</button>
                </div>
                <div className={styles.docTypeGrid}>{filteredDocTypes.map(t => <button key={t} className={`${styles.docTypeChip} ${acDocTypes.includes(t) ? styles.chipActive : ""}`} onClick={() => toggleDocType(t)}>{t}</button>)}</div>
              </div>
              <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => setModal(null)}>Annuler</button><button className={styles.btnSearch} onClick={runAutoCollect}>⌕ Lancer</button></div>
            </>}
            {(searching || (searchSteps.length > 0 && foundDocs.length === 0)) && <div className={styles.spBox}>{searchSteps.length === 0 ? <div className={`${styles.spRow} ${styles.active}`}><div className={`${styles.spDot} ${styles.spin}`} /><span>Initialisation…</span></div> : searchSteps.map((s, i) => <div key={i} className={`${styles.spRow} ${styles[s.status]}`}><div className={`${styles.spDot} ${s.status === "active" ? styles.spin : ""}`} /><span>{s.msg}</span></div>)}</div>}
            {!searching && foundDocs.length > 0 && <>
              <div className={styles.saRow}><span className={styles.saCount}>{selDocs.size}/{foundDocs.length} sélectionnés</span><button className={styles.saBtn} onClick={() => setSelDocs(allSel ? new Set() : new Set(foundDocs.map((_, i) => i)))}>{allSel ? "Tout désélectionner" : "Tout sélectionner"}</button></div>
              <div className={styles.fdList}>{foundDocs.map((doc, i) => <div key={i} className={`${styles.fdItem} ${selDocs.has(i) ? styles.sel : ""}`} onClick={() => setSelDocs(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n })}><div className={styles.fdChk}>{selDocs.has(i) ? "✓" : ""}</div><div className={styles.fdInfo}><div className={styles.fdType}>{doc.type}{doc.quarter ? <span className={styles.quarterTag}>{doc.quarter}</span> : null}</div><div className={styles.fdMeta}><span className={styles.cbadge}>{doc.category}</span>{" · "}{doc.year || "—"}{" · "}<span style={{ color: doc.confidence === "high" ? "#4aaa5e" : doc.confidence === "medium" ? "#c49a2a" : "#8a95a8" }}>{doc.confidence}</span></div>{doc.url && <div className={styles.fdUrl}>{doc.url.replace("https://", "")}</div>}</div></div>)}</div>
              <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => { setFoundDocs([]); setSearchSteps([]) }}>← Modifier filtres</button><button className={styles.btnGhost} onClick={() => setModal(null)}>Fermer</button><button className={styles.btnPrimary} onClick={importSelected} disabled={selDocs.size === 0}>Importer ({selDocs.size})</button></div>
            </>}
            {searching && <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => { abortRef.current?.abort(); setSearching(false) }}>Annuler</button></div>}
          </div>
        </div>
      )}

      {modal === "export" && (
        <div className={styles.overlay} onClick={e => e.currentTarget === e.target && setModal(null)}>
          <div className={`${styles.modal} ${styles.modalWide}`}>
            <div className={styles.mTitle}>Export LENS — Document Index</div>
            <pre className={styles.expPre}>{exportJSON()}</pre>
            <div className={styles.mActs}><button className={styles.btnGhost} onClick={() => setModal(null)}>Fermer</button><button className={styles.btnExport} onClick={downloadJSON}>⬡ Télécharger JSON</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
