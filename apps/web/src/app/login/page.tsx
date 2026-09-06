"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { API_URL, getSession, saveSession } from "@/lib/auth";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@aurilink.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { const session = getSession(); if (session) window.location.replace(session.user.roles.includes("ADMIN") ? "/admin" : "/employee"); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch(`${API_URL}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Login failed");
      saveSession(data.accessToken, data.user);
      window.location.replace(data.redirectTo);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to log in"); } finally { setLoading(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[#eef3f0] p-5">
    <div className="grid w-full max-w-[940px] overflow-hidden rounded-[28px] border border-[#dfe7e3] bg-white shadow-[0_24px_70px_rgba(20,53,46,.12)] md:grid-cols-[.9fr_1.1fr]">
      <section className="hidden bg-[#12372f] p-10 text-white md:flex md:flex-col">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#d8a64c] text-xl font-black text-[#12372f]">A</div><div><div className="font-bold tracking-wider">AURILINK</div><div className="text-[10px] tracking-[.18em] text-white/50">BUSINESS PLATFORM</div></div></div>
        <div className="my-auto"><BriefcaseBusiness size={34} className="mb-5 text-[#d8a64c]"/><h1 className="text-3xl font-bold leading-tight">Everything your team needs, in one place.</h1><p className="mt-4 text-sm leading-6 text-white/60">Manage daily work, clients, projects and finances without missing what matters.</p></div>
        <p className="text-xs text-white/35">Aurilink Digital · Auricode Solutions</p>
      </section>
      <section className="p-7 sm:p-12">
        <div className="mb-9 md:hidden"><div className="text-lg font-black text-[#176b5b]">AURILINK</div><div className="text-[10px] tracking-widest text-[#78847f]">BUSINESS PLATFORM</div></div>
        <p className="text-sm font-semibold text-[#176b5b]">Welcome back</p><h2 className="mt-2 text-3xl font-bold">Sign in to continue</h2><p className="mt-2 text-sm text-[#73807b]">Use your company account to access your workspace.</p>
        <form className="mt-8 space-y-5" onSubmit={submit}>
          <label className="block"><span className="mb-2 block text-xs font-bold text-[#46524e]">EMAIL ADDRESS</span><div className="relative"><Mail size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#84908b]"/><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-[#dbe3df] py-3 pl-10 pr-3 text-sm outline-none focus:border-[#176b5b]" required/></div></label>
          <label className="block"><span className="mb-2 block text-xs font-bold text-[#46524e]">PASSWORD</span><div className="relative"><LockKeyhole size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#84908b]"/><input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-[#dbe3df] py-3 pl-10 pr-11 text-sm outline-none focus:border-[#176b5b]" required/><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#78847f]">{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
          <div className="-mt-2 text-right"><Link href="/forgot-password" className="text-xs font-semibold text-[#176b5b] hover:underline">Forgot password?</Link></div>
          {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#176b5b] py-3.5 text-sm font-bold text-white hover:bg-[#115548] disabled:opacity-60">{loading ? "Signing in..." : "Sign in"}<ArrowRight size={17}/></button>
        </form>
        <div className="mt-7 rounded-xl bg-[#f4f7f5] p-4 text-xs leading-5 text-[#66736e]"><strong>Employee demo:</strong> employee@aurilink.local<br/>Password: Employee123!</div>
      </section>
    </div>
  </main>;
}
