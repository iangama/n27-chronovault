import React, { useEffect, useState } from "react";

const BASE = "/api";
const getActor = () => localStorage.getItem("chronovault_actor") || "operator:anon";
const setActor = (v) => localStorage.setItem("chronovault_actor", v);

async function api(path, { method="GET", body } = {}) {
  const actor = getActor();
  const hasBody = body !== undefined && body !== null;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": hasBody ? "application/json" : "text/plain", "x-actor": actor },
    body: hasBody ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let j=null; try{ j=JSON.parse(t);}catch{}
  if(!r.ok) throw new Error(j?.error || `http_${r.status}`);
  return j ?? { ok:true };
}

function useRoute() {
  const [h, setH] = useState(window.location.hash || "#/overview");
  useEffect(()=>{ const on=()=>setH(window.location.hash||"#/overview"); window.addEventListener("hashchange",on); return ()=>window.removeEventListener("hashchange",on); },[]);
  return h.replace("#","");
}

function Sidebar({ route }) {
  const items=[["overview","Visão geral"],["new","Nova cápsula"],["explore","Explorar"],["audit","Auditoria"],["about","Sobre"]];
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="logo" />
        <div>
          <div style={{fontWeight:800}}>CHRONOVAULT</div>
          <div style={{color:"var(--muted)",fontSize:12}}>Cofre Auditável (event log + hash)</div>
        </div>
      </div>
      <div className="nav">
        {items.map(([k,label])=>(
          <a key={k} href={`#/${k}`} className={route===`/${k}`?"active":""}>{label}</a>
        ))}
      </div>
      <div className="card" style={{marginTop:14}}>
        <div className="inner">
          <div style={{color:"var(--muted)",fontSize:12}}>x-actor (operador)</div>
          <input className="input mono" defaultValue={getActor()} onBlur={(e)=>setActor((e.target.value||"operator:anon").trim()||"operator:anon")} />
          <div style={{color:"var(--muted)",fontSize:12,marginTop:10}}>Links: <span className="mono">/grafana</span> <span className="mono">/prometheus</span> <span className="mono">/loki</span></div>
        </div>
      </div>
    </div>
  );
}

function Overview(){
  const [k,setK]=useState({total:0,open:0,sealed:0,events:[]}); const [e,setE]=useState("");
  useEffect(()=>{(async()=>{try{
    setE("");
    const c=await api("/capsules?limit=200"); const items=c.items||[];
    const total=items.length; const sealed=items.filter(x=>x.status==="sealed").length; const open=total-sealed;
    const ev=await api("/audit/events?limit=12");
    setK({total,open,sealed,events:ev.items||[]});
  }catch(err){setE(String(err.message||err));}})();},[]);
  return (
    <>
      {e? <div className="card"><div className="inner bad">Erro: {e}</div></div> : null}
      <div className="row" style={{justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>Visão geral</div>
          <div style={{color:"var(--muted)"}}>Poder = eventos imutáveis. Estado = projeção. Social = sem poder.</div>
        </div>
        <a className="btn" href="#/audit">Abrir auditoria</a>
      </div>
      <div className="row">
        <div className="card" style={{flex:1}}><div className="inner"><div style={{color:"var(--muted)",fontSize:12}}>Total</div><div style={{fontSize:22}}>{k.total}</div></div></div>
        <div className="card" style={{flex:1}}><div className="inner"><div style={{color:"var(--muted)",fontSize:12}}>Abertas</div><div style={{fontSize:22}}>{k.open}</div></div></div>
        <div className="card" style={{flex:1}}><div className="inner"><div style={{color:"var(--muted)",fontSize:12}}>Seladas</div><div style={{fontSize:22}}>{k.sealed}</div></div></div>
      </div>
      <div className="card" style={{marginTop:14}}>
        <div className="inner">
          <div style={{fontWeight:700,marginBottom:8}}>Eventos recentes</div>
          <table className="table"><thead><tr><th>id</th><th>type</th><th>actor</th><th>capsule</th></tr></thead>
            <tbody>{k.events.map(x=>(
              <tr key={x.id}><td className="mono">{x.id}</td><td className="mono">{x.type}</td><td className="mono">{x.actor}</td><td className="mono">{String(x.capsule_id||"").slice(0,8)}…</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function NewCapsule(){
  const [title,setTitle]=useState("");
  const [payload,setPayload]=useState('{\n  "why": "…",\n  "evidence": []\n}\n');
  const [tags,setTags]=useState("audit, access");
  const [lvl,setLvl]=useState(3);
  const [out,setOut]=useState(""); const [err,setErr]=useState("");
  async function submit(){
    try{
      setErr(""); setOut("Enviando…");
      const p=JSON.parse(payload);
      const r=await api("/capsules",{method:"POST",body:{title,payload:p,tags:tags.split(",").map(s=>s.trim()).filter(Boolean),seal_level:Number(lvl)}});
      setOut(`OK ✅ capsule_id=${r.capsule_id} event_id=${r.event_id}`);
      window.location.hash="#/explore";
    }catch(e){setErr(String(e.message||e)); setOut("");}
  }
  return (
    <>
      <div className="row" style={{justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>Nova cápsula</div>
          <div style={{color:"var(--muted)"}}>Comando estrutural → evento → worker projeta.</div>
        </div>
        <button className="btn primary" onClick={submit}>Criar</button>
      </div>
      {err? <div className="card"><div className="inner bad">Erro: {err}</div></div> : null}
      {out? <div className="card"><div className="inner ok mono">{out}</div></div> : null}
      <div className="row" style={{gap:14}}>
        <div className="card" style={{flex:1}}><div className="inner">
          <div style={{color:"var(--muted)",fontSize:12}}>Título</div>
          <input className="input" value={title} onChange={(e)=>setTitle(e.target.value)} />
          <div style={{color:"var(--muted)",fontSize:12,marginTop:10}}>Tags</div>
          <input className="input mono" value={tags} onChange={(e)=>setTags(e.target.value)} />
          <div style={{color:"var(--muted)",fontSize:12,marginTop:10}}>Seal level</div>
          <select className="input" value={lvl} onChange={(e)=>setLvl(e.target.value)}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select>
        </div></div>
        <div className="card" style={{flex:1}}><div className="inner">
          <div style={{color:"var(--muted)",fontSize:12}}>Payload JSON</div>
          <textarea className="input mono" value={payload} onChange={(e)=>setPayload(e.target.value)} />
        </div></div>
      </div>
    </>
  );
}

function Explore(){
  const [q,setQ]=useState(""); const [st,setSt]=useState(""); const [items,setItems]=useState([]);
  const [sel,setSel]=useState(null); const [err,setErr]=useState("");
  async function load(){
    try{
      setErr("");
      const p=new URLSearchParams(); if(q.trim()) p.set("q",q.trim()); if(st) p.set("status",st); p.set("limit","200");
      const r=await api(`/capsules?${p.toString()}`); setItems(r.items||[]);
    }catch(e){setErr(String(e.message||e));}
  }
  useEffect(()=>{load();},[]);
  async function open(id){ try{ setErr(""); const r=await api(`/capsules/${id}`); setSel(r); await api("/social/views",{method:"POST",body:{capsule_id:id}}).catch(()=>{});}catch(e){setErr(String(e.message||e));} }
  async function seal(id){ try{ setErr(""); await api(`/capsules/${id}/seal`,{method:"POST",body:{reason:"operator seal"}}); await load(); if(sel?.capsule?.id===id) await open(id);}catch(e){setErr(String(e.message||e));} }
  async function comment(id){ const b=prompt("Comentário (social/observável):")||""; if(!b.trim())return; await api("/social/comments",{method:"POST",body:{capsule_id:id,body:b}}); if(sel?.capsule?.id===id) await open(id); }
  return (
    <>
      <div className="row" style={{justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>Explorar</div>
          <div style={{color:"var(--muted)"}}>Busca + detalhar + selar + social.</div>
        </div>
        <button className="btn" onClick={load}>Atualizar</button>
      </div>
      {err? <div className="card"><div className="inner bad">Erro: {err}</div></div> : null}
      <div className="card"><div className="inner">
        <div className="row">
          <input className="input" style={{maxWidth:420}} value={q} onChange={(e)=>setQ(e.target.value)} placeholder="buscar por título…" />
          <select className="input" style={{maxWidth:220}} value={st} onChange={(e)=>setSt(e.target.value)}>
            <option value="">status: todos</option><option value="open">abertas</option><option value="sealed">seladas</option>
          </select>
          <button className="btn" onClick={load}>Buscar</button>
        </div>
      </div></div>

      <div className="row" style={{gap:14,marginTop:14}}>
        <div className="card" style={{flex:1}}><div className="inner">
          <div style={{fontWeight:700,marginBottom:8}}>Cápsulas</div>
          <table className="table"><thead><tr><th>status</th><th>título</th><th>id</th></tr></thead>
            <tbody>{items.map(c=>(
              <tr key={c.id} style={{cursor:"pointer"}} onClick={()=>open(c.id)}>
                <td className={(c.status==="sealed"?"ok":"warn")+" mono"}>{c.status}</td>
                <td>{c.title}</td>
                <td className="mono">{c.id.slice(0,8)}…</td>
              </tr>
            ))}</tbody>
          </table>
        </div></div>

        <div className="card" style={{flex:1}}><div className="inner">
          <div style={{fontWeight:700,marginBottom:8}}>Detalhe</div>
          {!sel ? <div style={{color:"var(--muted)"}}>Selecione uma cápsula.</div> : (
            <>
              <div className="row" style={{justifyContent:"space-between"}}>
                <div>
                  <div style={{fontWeight:800}}>{sel.capsule.title}</div>
                  <div className="mono" style={{color:"var(--muted)",fontSize:12}}>{sel.capsule.id}</div>
                </div>
                <div className="row">
                  <span className="badge">{sel.capsule.status}</span>
                  <button className="btn" onClick={()=>comment(sel.capsule.id)}>Comentar</button>
                  {sel.capsule.status==="open" ? <button className="btn primary" onClick={()=>seal(sel.capsule.id)}>Selar</button> : null}
                </div>
              </div>
              <div style={{marginTop:10,color:"var(--muted)",fontSize:12}}>Eventos (stream da cápsula)</div>
              <table className="table"><thead><tr><th>seq</th><th>type</th><th>hash</th></tr></thead>
                <tbody>{sel.events.map(ev=>(
                  <tr key={ev.id}><td className="mono">{ev.stream_seq}</td><td className="mono">{ev.type}</td><td className="mono">{String(ev.hash).slice(0,16)}…</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div></div>
      </div>
    </>
  );
}

function Audit(){
  const [items,setItems]=useState([]); const [cap,setCap]=useState(""); const [typ,setTyp]=useState(""); const [act,setAct]=useState("");
  const [vG,setVG]=useState(null); const [vC,setVC]=useState(null); const [err,setErr]=useState("");
  async function load(){
    try{
      setErr("");
      const p=new URLSearchParams(); if(cap.trim())p.set("capsule_id",cap.trim()); if(typ.trim())p.set("type",typ.trim()); if(act.trim())p.set("actor",act.trim());
      p.set("limit","200");
      const r=await api(`/audit/events?${p.toString()}`); setItems(r.items||[]);
    }catch(e){setErr(String(e.message||e));}
  }
  async function verGlobal(){ try{ setErr(""); setVG(await api("/audit/verify")); }catch(e){setErr(String(e.message||e));} }
  async function verCapsule(){ try{ setErr(""); if(!cap.trim()) return setErr("capsule_id vazio"); setVC(await api(`/audit/verify/${cap.trim()}`)); }catch(e){setErr(String(e.message||e));} }
  useEffect(()=>{load();},[]);
  return (
    <>
      <div className="row" style={{justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:22,fontWeight:800}}>Auditoria</div>
          <div style={{color:"var(--muted)"}}>Filtro + prova de integridade (hash-chain).</div>
        </div>
        <div className="row">
          <button className="btn" onClick={verGlobal}>Verificar global</button>
          <button className="btn" onClick={verCapsule}>Verificar item</button>
          <button className="btn primary" onClick={load}>Atualizar</button>
        </div>
      </div>
      {err? <div className="card"><div className="inner bad">Erro: {err}</div></div> : null}
      {(vG||vC)?(
        <div className="row" style={{gap:14}}>
          <div className="card" style={{flex:1}}><div className="inner">
            <div style={{fontWeight:700}}>Global</div>
            <pre className={"mono "+(vG?.ok?"ok":"bad")}>{vG?JSON.stringify(vG,null,2):"—"}</pre>
          </div></div>
          <div className="card" style={{flex:1}}><div className="inner">
            <div style={{fontWeight:700}}>Por cápsula</div>
            <pre className={"mono "+(vC?.ok?"ok":"bad")}>{vC?JSON.stringify(vC,null,2):"—"}</pre>
          </div></div>
        </div>
      ):null}
      <div className="card" style={{marginTop:14}}><div className="inner">
        <div className="row">
          <input className="input mono" style={{maxWidth:360}} value={cap} onChange={(e)=>setCap(e.target.value)} placeholder="capsule_id (uuid)" />
          <input className="input mono" style={{maxWidth:220}} value={act} onChange={(e)=>setAct(e.target.value)} placeholder="actor" />
          <input className="input mono" style={{maxWidth:220}} value={typ} onChange={(e)=>setTyp(e.target.value)} placeholder="type" />
        </div>
        <table className="table" style={{marginTop:10}}><thead><tr><th>id</th><th>type</th><th>actor</th><th>capsule</th><th>hash</th></tr></thead>
          <tbody>{items.map(e=>(
            <tr key={e.id}><td className="mono">{e.id}</td><td className="mono">{e.type}</td><td className="mono">{e.actor}</td><td className="mono">{String(e.capsule_id||"").slice(0,8)}…</td><td className="mono">{String(e.hash).slice(0,16)}…</td></tr>
          ))}</tbody>
        </table>
      </div></div>
    </>
  );
}

function About(){
  return (
    <div className="card"><div className="inner">
      <div style={{fontSize:22,fontWeight:800}}>Sobre</div>
      <div style={{color:"var(--muted)"}}>
        Contrato travado: <span className="mono">/</span> UI, <span className="mono">/api/*</span> API com StripPrefix(/api).
        Camada estrutural gera eventos imutáveis; camada social é observável sem poder.
      </div>
    </div></div>
  );
}

export default function App(){
  const route = useRoute();
  const page = route.replace(/^\/+/,"");
  return (
    <div className="container">
      <Sidebar route={route} />
      <div className="main">
        {page==="overview" && <Overview />}
        {page==="new" && <NewCapsule />}
        {page==="explore" && <Explore />}
        {page==="audit" && <Audit />}
        {page==="about" && <About />}
      </div>
    </div>
  );
}
