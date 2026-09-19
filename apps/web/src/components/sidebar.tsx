"use client";

import {
  BarChart3, BriefcaseBusiness, Building2, CalendarDays, ChevronDown,
  CircleDollarSign, ClipboardList, ContactRound, FolderKanban, LayoutDashboard, ListTodo,
  FileText, KeyRound, Package, ScrollText, Settings, UsersRound, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavIcon = typeof LayoutDashboard;
type NavItem = { label: string; icon: NavIcon; href: string };

const groups: { label: string; items: NavItem[] }[] = [
  { label: "WORKSPACE", items: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/admin" }, { label: "My Tasks", icon: ClipboardList, href: "/admin/my-tasks" }, { label: "Calendar", icon: CalendarDays, href: "/calendar" }, { label: "Personal To-do", icon: ListTodo, href: "/todo" }, { label: "My Wallet", icon: CircleDollarSign, href: "/wallet" },
  ]},
  { label: "WORK", items: [
    { label: "All Work", icon: BriefcaseBusiness, href: "/admin/work-management" }, { label: "Weekly Meetings", icon: CalendarDays, href: "/meetings" }, { label: "Task Types", icon: ListTodo, href: "/admin/task-types" },
  ]},
  { label: "CUSTOMERS", items: [
    { label: "Clients", icon: ContactRound, href: "/admin/clients" }, { label: "Projects", icon: FolderKanban, href: "/admin/modules/projects" }, { label: "Renewals", icon: CalendarDays, href: "/admin/renewals" },
  ]},
  { label: "FINANCE", items: [
    { label: "Sales", icon: BriefcaseBusiness, href: "/admin/sales" }, { label: "Quotations", icon: FileText, href: "/admin/quotations" }, { label: "Invoices", icon: FileText, href: "/admin/invoices" }, { label: "Bank & Cash", icon: CircleDollarSign, href: "/admin/accounts" }, { label: "Team Wallets", icon: CircleDollarSign, href: "/admin/wallets" }, { label: "Assets", icon: Package, href: "/admin/assets" },
  ]},
  { label: "ADMINISTRATION", items: [
    { label: "Users", icon: UsersRound, href: "/admin/users" }, { label: "Reports", icon: BarChart3, href: "/admin/reports" }, { label: "Audit Log", icon: ScrollText, href: "/admin/audit" },
  ]},
];

export function Sidebar({ open, onClose, user, inboxCount = 0 }: { open: boolean; onClose: () => void; user?: { firstName: string; lastName: string; jobTitle?: string }; inboxCount?: number }) {
  const pathname = usePathname();
  const fullName = user ? `${user.firstName} ${user.lastName}` : "Account";
  const initials = user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "A";
  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-30 flex w-[268px] flex-col border-r border-[#253d38] bg-[#122d28] text-white transition-transform lg:translate-x-0",
      open ? "translate-x-0" : "-translate-x-full",
    )}>
      <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#d8a64c] text-lg font-bold text-[#122d28]">A</div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-wide">AURILINK</div>
          <div className="text-[11px] tracking-[.16em] text-white/55">BUSINESS PLATFORM</div>
        </div>
        <button className="ml-auto lg:hidden" onClick={onClose} aria-label="Close menu"><X size={20} /></button>
      </div>

      <div className="px-4 pt-4">
        <button className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[.06] p-3 text-left">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#2d7163]"><Building2 size={16}/></div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-white/45">Business unit</div>
            <div className="truncate text-sm font-medium">Aurilink Digital</div>
          </div>
          <ChevronDown size={15} className="text-white/50"/>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[.16em] text-white/35">{group.label}</div>
            <div className="space-y-1">
              {group.items.map(({ label, icon: Icon, href }) => {
                const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
                return (
                <Link href={href} key={label} className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                  active ? "bg-[#d8a64c] font-semibold text-[#172d28]" : "text-white/68 hover:bg-white/[.06] hover:text-white",
                )}>
                  <Icon size={18}/><span>{label}</span>
                  {label === "All Work" && inboxCount > 0 && <span className="ml-auto rounded-full bg-[#da5151] px-2 py-0.5 text-[10px] font-bold text-white">{inboxCount > 99 ? "99+" : inboxCount}</span>}
                </Link>
              )})}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <Link href="/admin/settings" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/60"><Settings size={18}/>Settings</Link>
        <Link href="/admin/change-password" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/60"><KeyRound size={18}/>Change password</Link>
        <div className="mt-2 flex items-center gap-3 rounded-xl bg-white/[.04] p-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#d9eae5] text-xs font-bold text-[#17584c]">{initials}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{fullName}</div><div className="text-[11px] text-white/40">{user?.jobTitle || "Team member"}</div></div>
        </div>
      </div>
    </aside>
  );
}
