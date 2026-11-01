// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { NAV, subjectAfter, withSubject } from "@aihot/site";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconDoc, IconFlame, IconGrid, IconHeart, IconHistory, IconList, IconMessage, IconPlug, IconUser,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "内容",
    items: [
      { to: "/ideas", label: "今日选题", icon: IconBolt, end: true },
      { to: "/queue", label: "待拍", icon: IconBookmark },
      { to: "/signals", label: "热点线索", icon: IconList },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/admin", label: "管理后台", icon: IconGrid },
    ],
  },
];

/** Whether an engine page is a way in from the navigation (site.ts NAV.hidden); a hidden page still opens. */
export const inNav = (to: string) => !(NAV.hidden as readonly string[]).includes(to);

const UP = {
  "/hot": { name: "热点榜", back: "热点", tab: "hot" },
  "/topics": { name: "主题", back: "全部主题", tab: "me" },
} as const;

/**
 * Where pages under a navigation entry lead back up to: the entry, or 精选 in its place while the site hides
 * it. `name` is for breadcrumbs and desktop back links (热点榜), `back` for the phone bar (热点), `tab` the
 * phone tab it sits under, `crumbs` its breadcrumb after the site's home.
 */
export function navUp(entry: keyof typeof UP): { to: string; name: string; back: string; tab: TabKey; crumbs: Array<{ name: string; path: string }> } {
  if (!inNav(entry)) return { to: "/", name: "精选", back: "精选", tab: "featured", crumbs: [] };
  return { to: entry, ...UP[entry], crumbs: [{ name: UP[entry].name, path: entry }] };
}

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多; a module naming a section
 * that is already there adds to it.
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const [content, ...rest] = SECTIONS;
  const more = rest.pop()!;
  const sections = [content!, ...rest].map((s) => ({ ...s, items: s.items.filter((i) => inNav(i.to)) }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) section.items.push(...m.sidebar.items);
    else sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
  }
  return [...sections, more];
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 全部 lives beside 精选 as a switch, 热点 and 日报 are tabs, and "我的" at /more holds
 * 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "hot"
  | "daily"
  | "me"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/ideas", label: "选题", icon: IconBolt },
  { key: "hot", to: "/signals", label: "线索", icon: IconList },
  { key: "daily", to: "/queue", label: "待拍", icon: IconBookmark },
  { key: "me", to: "/admin", label: "管理", icon: IconGrid },
];

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1).filter((t) => inNav(t.to)), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
