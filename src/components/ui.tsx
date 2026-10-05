import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputCls =
  "rounded border border-[#c9b48a] bg-[#fffdf5] px-2 py-1 text-sm text-[#3e2f23] focus:outline-none focus:ring-1 focus:ring-[#b36d61]";
export const btnCls =
  "rounded border border-[#8d6e4a] bg-[#f0e2c0] px-3 py-1 text-sm text-[#5d4037] hover:bg-[#e6d3a8] active:scale-95 transition";
export const btnDangerCls =
  "rounded border border-[#a94442] bg-[#f6e0de] px-2 py-0.5 text-xs text-[#a94442] hover:bg-[#efd0cd]";

export function Card(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-[#d8c49a] bg-[#fdf6e3] p-4 shadow-sm", props.className)}>
      {props.title && (
        <h3 className="mb-3 border-b border-[#e0cfa5] pb-2 text-base font-semibold text-[#5d4037]">
          {props.title}
        </h3>
      )}
      {props.children}
    </div>
  );
}

export function Th(props: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-[#d8c49a] bg-[#f3e8cd] px-2 py-1.5 text-left text-xs font-semibold text-[#6d4c41]",
        props.className
      )}
    >
      {props.children}
    </th>
  );
}

export function Td(props: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-[#eee0bd] px-2 py-1.5 text-sm text-[#3e2f23]", props.className)}>
      {props.children}
    </td>
  );
}

export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export const fmtWen = (n: number) => `${n.toLocaleString("zh-CN")} 文`;
