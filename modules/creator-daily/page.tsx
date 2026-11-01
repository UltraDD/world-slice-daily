import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { apiGet } from "../../apps/web/app/lib/api.server.ts";
import type { DailyPage, Idea } from "./contracts.ts";
import "./style.css";

export const handle = { tab: "featured", name: "选题" };
export const meta = () => [{ title: "今日选题 · 世界切片" }, { name: "robots", content: "noindex" }];
export async function loader({ request }: LoaderFunctionArgs) {
  const pathname = new URL(request.url).pathname;
  const page = await apiGet<DailyPage>("/api/creator/today", { signal: request.signal });
  return { ...page, view: pathname === "/queue" ? "saved" : pathname === "/signals" ? "signals" : "ideas" };
}

const bucketNames = { today: "今天可拍", prepare: "提前准备", evergreen: "常青选题" };
const time = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

async function post(path: string, body: object): Promise<void> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "操作失败，请重试");
  }
}

function IdeaCard({ idea, onDecision }: { idea: Idea; onDecision: (id: string, decision: Idea["decision"]) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: Idea["decision"]) => { setBusy(true); try { await onDecision(idea.id, decision); } finally { setBusy(false); } };
  return <article className="creator-card">
    <div className="creator-card-meta"><span className={`creator-bucket ${idea.bucket}`}>{bucketNames[idea.bucket]}</span><span>{idea.effort}制作</span><span>{idea.sources.length} 条来源</span></div>
    <h2>{idea.title}</h2>
    <p className="creator-angle">{idea.angle}</p>
    <p className="creator-why">{idea.whyNow}</p>
    <div className="creator-card-actions">
      <button type="button" className="creator-text-button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "收起选题 ↑" : "展开选题 ↗"}</button>
      <span className="creator-action-spacer" />
      <button type="button" disabled={busy} className={`creator-save ${idea.decision === "saved" ? "is-saved" : ""}`} onClick={() => void decide(idea.decision === "saved" ? "new" : "saved")}>{idea.decision === "saved" ? "已加入待拍 ✓" : "＋ 加入待拍"}</button>
      <button type="button" disabled={busy} className="creator-skip" onClick={() => void decide("dismissed")}>暂不感兴趣</button>
    </div>
    {expanded && <div className="creator-details">
      <section><h3>开头怎么进</h3><blockquote>{idea.hook}</blockquote></section>
      <section><h3>画面怎么做</h3><ol>{idea.visuals.map((visual, i) => <li key={i}>{visual}</li>)}</ol></section>
      <section><h3>制作窗口</h3><p>{idea.window}</p></section>
      {idea.verify.length > 0 && <section><h3>开拍前核实</h3><ul>{idea.verify.map((fact, i) => <li key={i}>{fact}</li>)}</ul></section>}
      <section><h3>热点入口</h3><ul className="creator-citations">{idea.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><span>{source.source}{source.sourceDate ? ` · ${source.sourceDate}` : ""}{source.rank ? ` · 第 ${source.rank} 名` : ""}</span></li>)}</ul></section>
    </div>}
  </article>;
}

export default function CreatorDaily() {
  const initial = useLoaderData<typeof loader>();
  const [page, setPage] = useState(initial);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState("全部");
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<{ id: string; decision: Idea["decision"] } | null>(null);
  const pendingAfter = useRef(initial.latestRun?.id ?? 0);
  useEffect(() => { setPage(initial); setPending(false); setFilter("全部"); setQuery(""); }, [initial]);
  const running = page.latestRun && ["collecting", "generating"].includes(page.latestRun.status) && Date.now() - Date.parse(page.latestRun.started_at) < 1_200_000;
  useEffect(() => {
    if (!pending && !running) return;
    const controller = new AbortController();
    const started = Date.now();
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/creator/today", { signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json() as DailyPage;
        if (!active) return;
        setPage(previous => ({ ...next, view: previous.view }));
        if (next.latestRun && ["complete", "failed", "collected"].includes(next.latestRun.status) && (!pending || next.latestRun.id > pendingAfter.current)) {
          setPending(false); setFeedback(next.latestRun.status === "complete" ? "选题已更新" : next.latestRun.error ?? "线索已更新");
        } else if (Date.now() - started > 360_000) { setPending(false); setFeedback("更新仍在后台执行，稍后刷新查看"); }
      } catch (error) { if (!controller.signal.aborted && active) setFeedback("连接中断，正在重新读取进度"); }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, [pending, Boolean(running)]);

  const refresh = async () => { pendingAfter.current = page.latestRun?.id ?? 0; setPending(true); setFeedback("正在读取最新线索…"); try { await post("/api/creator/refresh", {}); } catch (error) { setPending(false); setFeedback((error as Error).message); } };
  const decide = async (id: string, decision: Idea["decision"]) => {
    try {
      const previous = [...(page.edition?.ideas ?? []), ...page.saved].find(idea => idea.id === id)?.decision ?? "new";
      await post("/api/creator/decision", { id, decision });
      const response = await fetch("/api/creator/today");
      if (!response.ok) throw new Error("已保存，刷新页面查看");
      const next = await response.json() as DailyPage;
      setPage(current => ({ ...next, view: current.view }));
      setUndo({ id, decision: previous });
      setFeedback(decision === "saved" ? "已加入待拍" : decision === "dismissed" ? "已跳过这条选题" : "已移出待拍");
    } catch (error) { setFeedback((error as Error).message); }
  };
  const ideas = (page.view === "saved" ? page.saved : page.edition?.ideas ?? []).filter(idea => idea.decision !== "dismissed");
  const shown = ideas.filter(idea => filter === "全部" || bucketNames[idea.bucket] === filter);
  const statuses = page.sources;
  const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${page.date}T12:00:00+08:00`));
  const sourceNames = [...new Set(page.signals.map(signal => signal.source))];
  const signals = page.signals.filter(signal => (filter === "全部" || signal.source === filter) && `${signal.title} ${signal.summary}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="creator-page">
    <header className="creator-header"><div><p className="creator-date">{date}</p><h1>{page.view === "saved" ? "待拍选题" : page.view === "signals" ? "热点线索" : "今天，拍什么"}</h1></div><button type="button" className="creator-primary" disabled={pending || Boolean(running)} onClick={() => void refresh()}>{pending || running ? "更新中…" : "更新选题"}</button></header>
    <nav className="creator-view-tabs" aria-label="创作导航"><Link to="/ideas" aria-current={page.view === "ideas" ? "page" : undefined}>今日选题</Link><Link to="/queue" aria-current={page.view === "saved" ? "page" : undefined}>待拍 <span>{page.saved.length}</span></Link><Link to="/signals" aria-current={page.view === "signals" ? "page" : undefined}>线索 <span>{page.signals.length}</span></Link></nav>
    {feedback && <div className="creator-feedback" role="status"><span>{feedback}</span>{undo && <button type="button" onClick={() => { const action = undo; setUndo(null); void decide(action.id, action.decision); }}>撤销</button>}</div>}
    {page.latestRun?.status === "failed" && !pending && <div className="creator-error" role="alert">本次更新失败：{page.latestRun.error}</div>}
    {page.view === "ideas" && page.edition && <section className="creator-editor-note"><span className="creator-note-mark" aria-hidden="true">／</span><div><p>{page.edition.lead}</p><small>{page.edition.date === page.date ? "今日" : page.edition.date} · {time(page.edition.generatedAt)} 更新</small></div></section>}
    {page.view !== "signals" ? <>
      {ideas.length > 0 && <div className="creator-filter" aria-label="选题类型">{["全部", "今天可拍", "提前准备", "常青选题"].map(label => <button type="button" key={label} className={filter === label ? "active" : ""} onClick={() => setFilter(label)}>{label}</button>)}</div>}
      {shown.map(idea => <IdeaCard key={idea.id} idea={idea} onDecision={decide} />)}
      {shown.length === 0 && <div className="creator-empty"><span aria-hidden="true">◒</span><h2>{page.view === "saved" ? "还没有待拍选题" : page.edition ? "这组暂时没有合适的题" : "还没有今日选题"}</h2>{page.view === "saved" ? <Link to="/ideas">去挑选题 ↗</Link> : !page.edition ? <button type="button" disabled={pending || Boolean(running)} onClick={() => void refresh()}>生成今日选题 ↗</button> : <button type="button" onClick={() => setFilter("全部")}>查看全部推荐 ↗</button>}</div>}
      {page.view === "ideas" && Boolean(page.edition?.watch.length) && <section className="creator-watch"><h2>先留个眼</h2>{page.edition!.watch.map(item => <div key={item.signal.id}><a href={item.signal.url} target="_blank" rel="noreferrer">{item.signal.title} ↗</a><p>{item.reason}</p></div>)}</section>}
    </> : <section className="creator-signals"><div className="creator-search"><input type="search" aria-label="搜索热点线索" placeholder="搜索线索" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="筛选信源" value={filter} onChange={event => setFilter(event.target.value)}><option>全部</option>{sourceNames.map(source => <option key={source}>{source}</option>)}</select></div>{signals.map(signal => <article key={signal.id}><div className="creator-signal-meta">{signal.source}{signal.rank ? ` · 第 ${signal.rank} 名` : ""}{signal.sourceDate ? ` · ${signal.sourceDate}` : ""}</div><a href={signal.url} target="_blank" rel="noreferrer">{signal.title} ↗</a>{signal.summary && <p>{signal.summary}</p>}</article>)}{signals.length === 0 && <p className="creator-empty">暂无匹配线索</p>}</section>}
    <footer className="creator-footer"><details><summary>信源 {statuses.filter(source => source.ok).length}/{statuses.length || "—"} · 今日模型调用 {page.usage.calls}/{page.usage.maxCalls}</summary><ul>{statuses.map(source => <li key={source.id}><span>{source.name}</span><span>{source.ok ? `${source.count} 条${source.feedDate ? ` · ${source.feedDate}` : ""}` : source.error}</span></li>)}</ul><p>已返回用量：输入 {page.usage.inputTokens.toLocaleString()} · 输出 {page.usage.outputTokens.toLocaleString()} token</p></details><a href="/admin">管理 ↗</a></footer>
  </div>;
}
