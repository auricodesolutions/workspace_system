"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, FolderKanban, Plus, Wallet } from "lucide-react";
import { authFetch, getSession } from "@/lib/auth";

type Client = { id: string; name: string };
type Project = { id: string; code: string; name: string; description?: string; status: string; priority: string; startDate?: string; dueDate?: string; budget?: string; taskCostTotal: string; client?: Client; _count: { tasks: number } };
const statuses = ["PLANNING", "ACTIVE", "COMPLETED", "CANCELLED"];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]); const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const [projectResponse, clientResponse] = await Promise.all([authFetch("/projects"), authFetch("/projects/clients")]); if (projectResponse.ok) setProjects(await projectResponse.json()); if (clientResponse.ok) setClients(await clientResponse.json()); }, []);
  useEffect(() => { const session = getSession(); if (!session) return void window.location.replace("/login"); if (!session.user.roles.includes("ADMIN")) return void window.location.replace("/employee"); const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); setSaving(true); setMessage("");
    const body = { name: form.get("name"), description: form.get("description") || undefined, clientId: form.get("clientId") || undefined, priority: form.get("priority"), startDate: form.get("startDate") ? new Date(String(form.get("startDate"))).toISOString() : undefined, dueDate: form.get("dueDate") ? new Date(String(form.get("dueDate"))).toISOString() : undefined, budget: form.get("budget") ? Number(form.get("budget")) : undefined };
    const response = await authFetch("/projects", { method: "POST", body: JSON.stringify(body) });
    if (response.ok) { formElement.reset(); setMessage("Project created successfully."); await load(); } else { const data = await response.json(); setMessage(Array.isArray(data.message) ? data.message.join(", ") : data.message); } setSaving(false);
  }
  async function updateStatus(id: string, status: string) { const response = await authFetch(`/projects/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); if (response.ok) await load(); }
  return <main className="min-h-screen bg-[#f3f6f4] p-5 md:p-8"><div className="mx-auto max-w-7xl">
    <Link href="/admin" className="mb-6 flex w-fit items-center gap-2 text-sm font-semibold text-[#176b5b]"><ArrowLeft size={16}/> Command Center</Link>
    <div className="mb-7"><p className="text-sm font-semibold text-[#176b5b]">OPERATIONS</p><h1 className="mt-1 text-3xl font-bold">Projects</h1><p className="mt-2 text-sm text-[#6d7975]">Create projects, connect clients, manage deadlines, and follow delivery status.</p></div>
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <section className="card h-fit p-6"><div className="mb-5 flex items-center gap-2 font-bold"><Plus size={19} className="text-[#176b5b]"/> New project</div><form className="space-y-4" onSubmit={submit}>
        <label className="block text-xs font-bold">PROJECT NAME<input required minLength={3} name="name" className="mt-2 w-full rounded-lg border border-[#dbe2df] p-3 text-sm font-normal outline-none focus:border-[#176b5b]" placeholder="e.g. ABC Website Redesign"/></label>
        <label className="block text-xs font-bold">CLIENT<select name="clientId" className="mt-2 w-full rounded-lg border border-[#dbe2df] bg-white p-3 text-sm font-normal"><option value="">Internal / no client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="block text-xs font-bold">DESCRIPTION<textarea name="description" className="mt-2 min-h-20 w-full rounded-lg border border-[#dbe2df] p-3 text-sm font-normal outline-none focus:border-[#176b5b]"/></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">START<input name="startDate" type="date" className="mt-2 w-full rounded-lg border border-[#dbe2df] p-3 text-sm font-normal"/></label><label className="block text-xs font-bold">DEADLINE<input name="dueDate" type="date" className="mt-2 w-full rounded-lg border border-[#dbe2df] p-3 text-sm font-normal"/></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-bold">PRIORITY<select name="priority" defaultValue="MEDIUM" className="mt-2 w-full rounded-lg border border-[#dbe2df] bg-white p-3 text-sm font-normal"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label className="block text-xs font-bold">BUDGET<input name="budget" type="number" min="0" step="0.01" className="mt-2 w-full rounded-lg border border-[#dbe2df] p-3 text-sm font-normal" placeholder="LKR"/></label></div>
        {message && <div className="rounded-lg bg-[#eef7f3] p-3 text-xs font-semibold text-[#176b5b]">{message}</div>}<button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#176b5b] py-3 text-sm font-bold text-white disabled:opacity-60"><Plus size={17}/>{saving ? "Creating..." : "Create project"}</button>
      </form></section>
      <section className="card overflow-hidden"><div className="flex items-center border-b border-[#e7ebe9] p-5"><div className="flex items-center gap-2 font-bold"><FolderKanban size={19} className="text-[#176b5b]"/> Project portfolio</div><span className="ml-auto rounded-full bg-[#edf4f1] px-2.5 py-1 text-xs font-bold text-[#176b5b]">{projects.length}</span></div>
        <div className="divide-y divide-[#e7ebe9]">{projects.map((project) => <article key={project.id} className="p-5 hover:bg-[#fafcfa]"><div className="flex flex-col gap-4 md:flex-row md:items-start"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e8f2ee] text-[#176b5b]"><FolderKanban size={20}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#176b5b]">{project.code}</span><span className={`rounded px-2 py-0.5 text-[9px] font-bold ${project.priority === "CRITICAL" ? "bg-red-50 text-red-700" : project.priority === "HIGH" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}>{project.priority}</span></div><h2 className="mt-1 font-bold">{project.name}</h2><p className="mt-1 text-xs text-[#78847f]">{project.client?.name ?? "Internal project"}</p><div className="mt-3 flex flex-wrap gap-4 text-xs text-[#65716d]"><span className="flex items-center gap-1.5"><CalendarDays size={14}/>{project.dueDate ? `Due ${new Date(project.dueDate).toLocaleDateString()}` : "No deadline"}</span><span className="flex items-center gap-1.5"><Wallet size={14}/>{project.budget ? `Rs. ${Number(project.budget).toLocaleString()}` : "No budget"}</span><span>{project._count.tasks} tasks</span></div></div><select value={project.status} onChange={(event) => void updateStatus(project.id, event.target.value)} className="rounded-lg border border-[#dbe2df] bg-white px-3 py-2 text-xs font-bold">{statuses.map((status) => <option key={status}>{status.replaceAll("_", " ")}</option>)}</select></div></article>)}{!projects.length && <div className="p-10 text-center text-sm text-[#78847f]">No projects yet. Create your first project.</div>}</div>
      </section>
    </div>
    {projects.length > 0 && <section className="card mt-6 p-5"><div className="mb-3 text-sm font-bold">Open project details</div><div className="flex flex-wrap gap-2">{projects.map((project) => <Link key={project.id} href={`/admin/projects/${project.id}`} className="rounded-lg border border-[#dbe2df] bg-white px-3 py-2 text-xs font-semibold text-[#176b5b] hover:border-[#176b5b]">{project.code} · {project.name}</Link>)}</div></section>}
  </div></main>;
}
