"""主窗口：时间轴 + 片段列表 + 详情/裁决面板，改动实时反映。"""
import os
import tkinter as tk
from tkinter import filedialog, ttk
from .engine import AlignmentEngine
from .io import load_project, save_project
from .timeline import STATUS_COLOR, TimelineCanvas

STATUS_TEXT = {"ok": "正常", "conflict": "矛盾", "untrusted": "不可信"}


class AlignerApp(tk.Tk):
    def __init__(self, project_path=None):
        super().__init__()
        self.title("字幕对齐推演工具（离线）")
        self.geometry("1180x720")
        self.project_path = project_path
        self.engine = None
        self._build_ui()
        if project_path and os.path.exists(project_path):
            self.open_project(project_path)

    # ---------- 界面 ----------
    def _build_ui(self):
        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=6, pady=4)
        ttk.Button(bar, text="打开项目…", command=self._open_dialog).pack(side="left")
        ttk.Button(bar, text="保存项目…", command=self._save_dialog).pack(side="left", padx=4)
        ttk.Button(bar, text="整体重推", command=self._full_recompute).pack(side="left", padx=4)
        self.status_var = tk.StringVar(value="未载入项目")
        ttk.Label(bar, textvariable=self.status_var).pack(side="left", padx=12)

        paned = ttk.PanedWindow(self, orient="horizontal")
        paned.pack(fill="both", expand=True, padx=6)

        left = ttk.Frame(paned)
        paned.add(left, weight=3)
        cols = ("status", "offset", "drift", "cum", "source", "text")
        heads = ("状态", "偏移s", "漂移s", "累计漂移", "来源", "文本")
        self.tree = ttk.Treeview(left, columns=cols, show="tree headings",
                                 height=14)
        self.tree.heading("#0", text="片段")
        self.tree.column("#0", width=70)
        for c, h in zip(cols, heads):
            self.tree.heading(c, text=h)
            self.tree.column(c, width=90 if c != "text" else 220)
        self.tree.tag_configure("ok", foreground="#2e7d32")
        self.tree.tag_configure("conflict", foreground="#e65100")
        self.tree.tag_configure("untrusted", foreground="#c62828")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)

        right = ttk.Notebook(paned)
        paned.add(right, weight=2)
        self.detail = tk.Text(right, wrap="word", height=18,
                              font=("Microsoft YaHei UI", 10))
        right.add(self.detail, text="依据与矛盾")
        self.detail.tag_config("h", font=("Microsoft YaHei UI", 10, "bold"))
        self.detail.tag_config("warn", foreground="#c62828")
        self.ops = ttk.Frame(right)
        right.add(self.ops, text="操作")

        bottom = ttk.Frame(self)
        bottom.pack(fill="x", padx=6, pady=4)
        self.timeline = TimelineCanvas(
            bottom, height=110,
            on_select_segment=self._focus_segment,
            on_select_anchor=self._focus_anchor,
            on_move_anchor=self._anchor_moved)
        sb = ttk.Scrollbar(bottom, orient="horizontal",
                           command=self.timeline.xview)
        self.timeline.configure(xscrollcommand=sb.set)
        self.timeline.pack(fill="x")
        sb.pack(fill="x")

    # ---------- 项目载入/保存 ----------
    def _open_dialog(self):
        p = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if p:
            self.open_project(p)

    def _save_dialog(self):
        if not self.engine:
            return
        p = filedialog.asksaveasfilename(defaultextension=".json")
        if p:
            save_project(p, self.engine.media, self.engine.segments,
                         list(self.engine.anchors.values()),
                         self.engine.resolutions)
            self.status_var.set(f"已保存 {p}")

    def open_project(self, path):
        media, segs, anchors = load_project(path)
        self.engine = AlignmentEngine(media, segs, anchors)
        self.project_path = path
        self.refresh(f"已载入 {os.path.basename(path)}")

    def _full_recompute(self):
        if self.engine:
            self.engine.recompute_all()
            self.refresh("已整体重推")

    # ---------- 刷新 ----------
    def refresh(self, msg=""):
        eng = self.engine
        if not eng:
            return
        self.tree.delete(*self.tree.get_children())
        for seg in eng.segments:
            r = eng.results[seg.id]
            fmt = lambda v: "" if v is None else f"{v:+.2f}"
            self.tree.insert("", "end", iid=seg.id, text=seg.id,
                             values=(STATUS_TEXT[r.status], fmt(r.offset),
                                     fmt(r.drift), fmt(r.cumulative_drift),
                                     seg.source, seg.text[:30]),
                             tags=(r.status,))
        n_conf = sum(1 for c in eng.conflicts.values() if not c.resolution)
        n_un = sum(1 for r in eng.results.values()
                   if r.status == "untrusted")
        self.status_var.set(
            f"{msg}  共{len(eng.segments)}段 | 未决矛盾 {n_conf} | 不可信 {n_un}")
        self.timeline.redraw()

    # ---------- 选择与详情 ----------
    def _on_tree_select(self, _event):
        sel = self.tree.selection()
        if sel:
            self._show_segment(sel[0])

    def _focus_segment(self, seg_id):
        self.tree.selection_set(seg_id)
        self.tree.see(seg_id)
        self._show_segment(seg_id)

    def _focus_anchor(self, anchor_id):
        self._show_anchor(anchor_id)

    def _show_segment(self, seg_id):
        eng = self.engine
        seg = next(s for s in eng.segments if s.id == seg_id)
        r = eng.results[seg_id]
        d = self.detail
        d.delete("1.0", "end")
        d.insert("end", f"{seg.id}  [{STATUS_TEXT[r.status]}]\n", "h")
        d.insert("end", f"文本：{seg.text}\n来源：{seg.source}\n")
        d.insert("end", f"标称：{seg.start:.3f} ~ {seg.end:.3f}s\n")
        if r.aligned_start is not None:
            d.insert("end", f"对齐：{r.aligned_start:.3f} ~ "
                            f"{r.aligned_end:.3f}s  偏移 {r.offset:+.3f}s\n")
        if r.drift is not None:
            d.insert("end", f"漂移 {r.drift:+.3f}s，累计漂移 "
                            f"{r.cumulative_drift:+.3f}s\n")
        d.insert("end", "\n依据：\n", "h")
        for e in r.evidences:
            off = "" if e.offset is None else f"（偏移 {e.offset:+.3f}s）"
            d.insert("end", f"  [{e.kind}] {e.description}{off}\n")
        if r.conflict_ids:
            d.insert("end", "\n涉及矛盾（双方依据均保留）：\n", "h")
            for cid in r.conflict_ids:
                c = eng.conflicts.get(cid)
                if not c:
                    continue
                d.insert("end", f"  ● {c.description}\n", "warn")
                for e in c.evidences:
                    off = "" if e.offset is None else f" {e.offset:+.3f}s"
                    d.insert("end", f"      - {e.description}{off}\n")
                d.insert("end", f"      裁决：{c.resolution or '未裁决'}\n")
        self._build_ops(seg_id=seg_id)

    def _show_anchor(self, anchor_id):
        a = self.engine.anchors[anchor_id]
        d = self.detail
        d.delete("1.0", "end")
        d.insert("end", f"锚点 {a.id}  {a.label}\n", "h")
        d.insert("end", f"媒体时刻：{a.media_time:.3f}s\n")
        users = [s.id for s in self.engine.segments if s.anchor_id == anchor_id]
        d.insert("end", f"引用片段：{', '.join(users) or '（无）'}\n")
        self._build_ops(anchor_id=anchor_id)

    # ---------- 操作面板 ----------
    def _build_ops(self, seg_id=None, anchor_id=None):
        for w in self.ops.winfo_children():
            w.destroy()
        eng = self.engine
        if not eng:
            return
        if seg_id:
            r = eng.results[seg_id]
            row = 0
            for cid in r.conflict_ids:
                c = eng.conflicts.get(cid)
                if not c or c.kind != "anchor_vs_context":
                    continue
                ttk.Label(self.ops, text=f"裁决 {cid}：").grid(
                    row=row, column=0, sticky="w", padx=6, pady=4)
                ttk.Button(self.ops, text="采信锚点",
                           command=lambda i=cid: self._resolve(i, "anchor")
                           ).grid(row=row, column=1, padx=4)
                ttk.Button(self.ops, text="采信上下文",
                           command=lambda i=cid: self._resolve(i, "context")
                           ).grid(row=row, column=2, padx=4)
                row += 1
            if row == 0:
                ttk.Label(self.ops, text="该片段没有可裁决的矛盾。"
                              ).grid(row=0, column=0, padx=6, pady=6)
        if anchor_id:
            a = eng.anchors[anchor_id]
            ttk.Label(self.ops, text=f"锚点 {a.id} 媒体时刻（秒）："
                      ).grid(row=0, column=0, padx=6, pady=6, sticky="w")
            var = tk.StringVar(value=f"{a.media_time:.3f}")
            ent = ttk.Entry(self.ops, textvariable=var, width=10)
            ent.grid(row=0, column=1)
            ttk.Button(self.ops, text="应用",
                       command=lambda: self._apply_anchor(anchor_id, var.get())
                       ).grid(row=0, column=2, padx=4)

    # ---------- 引擎交互（增量更新） ----------
    def _resolve(self, conflict_id, choice):
        affected = self.engine.resolve_conflict(conflict_id, choice)
        self.refresh(f"裁决 {conflict_id} → {choice}，"
                     f"增量更新 {len(affected)} 段")
        if self.tree.selection():
            self._show_segment(self.tree.selection()[0])

    def _apply_anchor(self, anchor_id, text):
        try:
            t = float(text)
        except ValueError:
            self.status_var.set("时刻格式无效")
            return
        affected = self.engine.update_anchor(anchor_id, t)
        self.refresh(f"锚点 {anchor_id} → {t:.3f}s，增量更新 {len(affected)} 段")
        self._show_anchor(anchor_id)

    def _anchor_moved(self, anchor_id, t):
        affected = self.engine.update_anchor(anchor_id, round(t, 3))
        self.refresh(f"拖拽锚点 {anchor_id} → {t:.2f}s，"
                     f"增量更新 {len(affected)} 段")
