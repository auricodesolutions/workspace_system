"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Bell, CalendarDays, CheckCircle2, ChevronRight,
  CircleDollarSign, Clock3, FileText, FolderKanban, LogOut, Menu, Plus, Search, UsersRound,
} from "lucide-react";
import { Sidebar } from "./sidebar";
import { authFetch, getSession, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";

const attentions = [
  { icon: Clock3, color: "#d94747", bg: "#fff0f0", title: "4 overdue tasks", detail: "2 are blocking active projects", action: "Review tasks" },
  { icon: CheckCircle2, color: "#287766", bg: "#eaf5f1", title: "0 tasks pending acceptance", detail: "Completed work awaiting review", action: "Review completions" },
  { icon: CircleDollarSign, color: "#8055b8", bg: "#f5effb", title: "3 overdue invoices", detail: "Outstanding invoice balances", action: "View invoices" },
  { icon: AlertTriangle, color: "#d17127", bg: "#fff5e9", title: "2 projects at risk", detail: "Deadlines within 7 days", action: "View projects" },
];

const tasks = [
  { title: "Review homepage design — ABC Hotel", meta: "Website Redesign · Due 10:30 AM", priority: "HIGH", tone: "#df7b24" },
  { title: "Send September invoice — XYZ Foods", meta: "Finance · Due 12:00 PM", priority: "CRITICAL", tone: "#d94747" },
  { title: "Approve campaign content calendar", meta: "September Campaign · Due 2:00 PM", priority: "MEDIUM", tone: "#c49923" },
  { title: "Weekly project review", meta: "Internal · Due 4:00 PM", priority: "LOW", tone: "#34886f" },
];

type DashboardSummary = {
  attention: { overdueTasks?: number; overdueInvoices?: number; pendingApprovals?: number; pendingAcceptance?: number; atRiskProjects?: number };
  metrics: { activeProjects?: number; tasksToday?: number; activeUsers?: number; outstandingLkr?: number; overdueLkr?: number; employeePayableLkr?: number; clientReceivableLkr?: number; accountBalanceLkr?: number };
  tasks?: { id: string; title: string; project: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; dueDate: string | null }[];
  renewals?: { id: string; name: string; project: string; client: string; amount: number; dueDate: string; daysBefore: number }[];
};

const formatLkr = (value = 0) => value >= 1000 ? `Rs. ${(value / 1000).toFixed(value % 1000 ? 1 : 0)}K` : `Rs. ${value.toLocaleString()}`;

function Metric({ icon: Icon, label, value, helper, accent }: { icon: typeof FolderKanban; label: string; value: string; helper: string; accent: string }) {
  return <div className="card p-5">
    <div className="mb-5 flex items-start justify-between">
      <div><div className="text-[12px] font-semibold uppercase tracking-[.1em] text-[#7b8783]">{label}</div><div className="mt-2 text-[29px] font-bold tracking-tight">{value}</div></div>
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${accent}18`, color: accent }}><Icon size={20}/></div>
    </div>
    <div className="text-xs text-[#76827e]">{helper}</div>
  </div>;
}

export function Dashboard() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [firstName, setFirstName] = useState("Admin");
  const [sidebarUser, setSidebarUser] = useState<{ firstName: string; lastName: string; jobTitle?: string }>();
  const [dateLabels, setDateLabels] = useState({ short: "Today", long: "Today" });
  useEffect(() => {
    const session = getSession();
    if (!session) { window.location.replace("/login"); return; }
    if (!session.user.roles.includes("ADMIN")) { window.location.replace("/employee"); return; }
    const timer = window.setTimeout(() => {
      setFirstName(session.user.firstName);
      setSidebarUser(session.user);
      const now = new Date();
      setDateLabels({ short: now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }), long: now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
    }, 0);
    authFetch("/dashboard/summary?businessUnit=ALD")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Dashboard API unavailable")))
      .then(setSummary)
      .catch(() => setSummary(null));
    return () => window.clearTimeout(timer);
  }, []);
  const liveAttentions = attentions.map((item, index) => ({ ...item, title: [
    `${summary?.attention.overdueTasks ?? 0} overdue tasks`,
    `${summary?.attention.pendingAcceptance ?? 0} tasks pending acceptance`,
    `${summary?.attention.overdueInvoices ?? 0} overdue invoices`,
    `${summary?.attention.atRiskProjects ?? 0} projects at risk`,
  ][index], detail: index === 1 ? "Completed work awaiting review" : index === 2 ? `${formatLkr(summary?.metrics.overdueLkr)} overdue` : item.detail }));
  const liveTasks = summary?.tasks?.map((task) => ({
    title: task.title,
    meta: `${task.project} · ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}`,
    priority: task.priority,
    tone: { LOW: "#34886f", MEDIUM: "#c49923", HIGH: "#df7b24", CRITICAL: "#d94747" }[task.priority],
  })) ?? tasks;
  return <div className="min-h-screen">
    <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} user={sidebarUser} inboxCount={summary?.attention.pendingAcceptance ?? 0} />
    {menuOpen && <button aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)}/>} 
    <main className="lg:pl-[268px]">
      <header className="sticky top-0 z-10 flex h-[76px] items-center border-b border-[#e2e7e4] bg-white/95 px-5 backdrop-blur md:px-8">
        <button className="mr-3 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={22}/></button>
        <div className="relative hidden w-full max-w-[360px] sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9692]" size={17}/>
          <input className="w-full rounded-xl border border-[#e0e5e2] bg-[#f8faf9] py-2.5 pl-10 pr-4 text-sm outline-none focus:border-[#277665]" placeholder="Search clients, projects, tasks..." />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg border border-[#e2e6e4] px-3 py-2 text-xs font-medium text-[#596661] md:flex"><CalendarDays size={15}/> {dateLabels.short}</div>
          <button className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#e2e6e4]"><Bell size={18}/><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#d94e4e] ring-2 ring-white"/></button>
          <button onClick={logout} className="grid h-10 w-10 place-items-center rounded-xl border border-[#e2e6e4] text-[#65716d]" title="Sign out"><LogOut size={17}/></button>
          <button onClick={() => router.push("/admin/tasks")} className="flex items-center gap-2 rounded-xl bg-[#176b5b] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#125a4d]"><Plus size={17}/> <span className="hidden sm:inline">Quick add</span></button>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] p-5 md:p-8">
        <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><div className="mb-1 text-sm font-medium text-[#277464]">{dateLabels.long}</div><h1 className="text-3xl font-bold tracking-tight md:text-[34px]">Good morning, {firstName}.</h1><p className="mt-2 text-sm text-[#687570]">Here&apos;s what needs your attention across Aurilink Digital today.</p></div>
          <button onClick={() => router.push("/admin/tasks")} className="flex w-fit items-center gap-2 text-sm font-semibold text-[#176b5b]">View weekly overview <ArrowRight size={16}/></button>
        </div>

        <section className="card mb-5 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#ecefed] px-5 py-4"><div className="flex items-center gap-2.5"><AlertTriangle size={18} className="text-[#d64d47]"/><h2 className="font-bold">Needs your attention</h2><span className="rounded-full bg-[#fff0ef] px-2 py-0.5 text-[11px] font-bold text-[#ca4641]">LIVE</span></div><button onClick={() => router.push("/admin/tasks")} className="hidden text-xs font-semibold text-[#176b5b] sm:block">Open Action Center</button></div>
          <div className="grid md:grid-cols-2 xl:grid-cols-4">
            {liveAttentions.map((item, index) => <button onClick={() => router.push(index === 2 ? "/admin/invoices" : index === 3 ? "/admin/modules/projects" : "/admin/tasks")} key={item.action} className={`flex items-start gap-3 p-5 text-left hover:bg-[#fafbfa] ${index ? "border-t md:border-l md:border-t-0" : ""} border-[#edf0ee]`}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: item.bg, color: item.color }}><item.icon size={18}/></div>
              <div><div className="text-sm font-bold">{item.title}</div><div className="mt-1 text-xs text-[#7a8681]">{item.detail}</div><div className="mt-3 flex items-center gap-1 text-xs font-semibold" style={{ color: item.color }}>{item.action}<ChevronRight size={13}/></div></div>
            </button>)}
          </div>
        </section>

        {!!summary?.renewals?.length && <section className="card mb-5 overflow-hidden border-l-4 border-l-orange-500"><div className="flex items-center border-b border-[#ecefed] px-5 py-4"><Bell size={18} className="mr-2 text-orange-600"/><div><h2 className="font-bold">Upcoming renewals</h2><p className="text-xs text-[#7a8681]">Client services approaching their next billing date</p></div><button onClick={() => router.push("/admin/renewals")} className="ml-auto text-xs font-bold text-[#176b5b]">Manage renewals</button></div><div className="grid gap-px bg-[#edf0ee] md:grid-cols-2 xl:grid-cols-4">{summary.renewals.slice(0, 4).map((renewal) => <button key={renewal.id} onClick={() => router.push("/admin/renewals")} className="bg-white p-4 text-left hover:bg-[#fffaf4]"><div className="text-xs font-bold text-orange-700">{renewal.daysBefore} DAY REMINDER</div><div className="mt-1 truncate text-sm font-semibold">{renewal.client} · {renewal.name}</div><div className="mt-2 text-xs text-[#7a8681]">{new Date(renewal.dueDate).toLocaleDateString()} · Rs. {renewal.amount.toLocaleString()}</div></button>)}</div></section>}

        <div className="metric-grid mb-5">
          <Metric icon={FolderKanban} label="Active projects" value={String(summary?.metrics.activeProjects ?? 0)} helper={`${summary?.attention.atRiskProjects ?? 0} at risk`} accent="#176b5b"/>
          <Metric icon={CheckCircle2} label="Pending acceptance" value={String(summary?.attention.pendingAcceptance ?? 0)} helper={`${summary?.metrics.tasksToday ?? 0} tasks due today`} accent="#3976a8"/>
          <Metric icon={CircleDollarSign} label="Available funds" value={formatLkr(summary?.metrics.accountBalanceLkr)} helper={`${formatLkr(summary?.metrics.employeePayableLkr)} owed to employees`} accent="#d17b29"/>
          <Metric icon={UsersRound} label="Client receivable" value={formatLkr(summary?.metrics.clientReceivableLkr)} helper={`${summary?.metrics.activeUsers ?? 0} active team members`} accent="#8055b8"/>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.45fr_.8fr]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#ecefed] px-5 py-4"><div><h2 className="font-bold">My work today</h2><p className="mt-1 text-xs text-[#7a8681]">Priority assignments</p></div><button onClick={() => router.push("/admin/tasks")} className="text-xs font-semibold text-[#176b5b]">Open tasks</button></div>
            <div className="h-1 bg-[#edf0ee]"><div className="h-full w-1/2 bg-[#2a806d]"/></div>
            <div className="divide-y divide-[#edf0ee]">
              {liveTasks.map((task) => <div key={task.title} className="flex items-center gap-3 px-5 py-4">
                <button aria-label={`Complete ${task.title}`} className="h-5 w-5 shrink-0 rounded-full border-2 border-[#cbd3d0] hover:border-[#287766]"/>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{task.title}</div><div className="mt-1 text-xs text-[#7a8681]">{task.meta}</div></div>
                <span className="hidden rounded-md px-2 py-1 text-[9px] font-bold tracking-wider sm:block" style={{ color: task.tone, backgroundColor: `${task.tone}13` }}>{task.priority}</span>
              </div>)}
            </div>
            <button onClick={() => router.push("/admin/tasks")} className="flex w-full items-center justify-center gap-2 border-t border-[#edf0ee] py-3.5 text-xs font-semibold text-[#176b5b]"><Plus size={15}/> Assign a task</button>
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#ecefed] px-5 py-4"><div><h2 className="font-bold">Team workload</h2><p className="mt-1 text-xs text-[#7a8681]">This week&apos;s capacity</p></div><button onClick={() => router.push("/admin/modules/team")} className="text-xs font-semibold text-[#176b5b]">View team</button></div>
            <div className="space-y-5 p-5">
              {[['Kasun Perera','Developer',80,'32 / 40h','#287766'],['Nimali Silva','Designer',120,'48 / 40h','#d14e48'],['Ruwan Jay','Marketing',60,'24 / 40h','#3976a8'],['Amaya Fernando','Account Manager',92,'37 / 40h','#d17b29']].map(([name, role, percent, hours, color]) => <div key={name as string}>
                <div className="mb-2 flex items-center"><div className="mr-3 grid h-8 w-8 place-items-center rounded-full bg-[#e8efec] text-[10px] font-bold text-[#286656]">{(name as string).split(' ').map(x => x[0]).join('')}</div><div><div className="text-xs font-bold">{name as string}</div><div className="text-[10px] text-[#87928e]">{role as string}</div></div><div className="ml-auto text-xs font-semibold" style={{color: color as string}}>{hours as string}</div></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0ee]"><div className="h-full rounded-full" style={{ width: `${Math.min(percent as number,100)}%`, backgroundColor: color as string }}/></div>
              </div>)}
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>;
}
