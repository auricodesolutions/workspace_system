import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

const names: Record<string, string> = { "crm-clients": "CRM & Clients", projects: "Projects", team: "Team", sales: "Sales", finance: "Finance", assets: "Assets", reports: "Reports", settings: "Settings" };

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const name = names[slug] ?? "Module";
  return <main className="grid min-h-screen place-items-center bg-[#f3f6f4] p-5"><section className="card max-w-lg p-9 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#e7f2ee] text-[#176b5b]"><Construction size={25}/></div><h1 className="mt-5 text-2xl font-bold">{name}</h1><p className="mt-3 text-sm leading-6 text-[#6e7a76]">This module is connected in the navigation and is scheduled for the next implementation phase. Task management and role dashboards are already functional.</p><Link href="/admin" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#176b5b] px-5 py-3 text-sm font-bold text-white"><ArrowLeft size={16}/> Back to Command Center</Link></section></main>;
}
