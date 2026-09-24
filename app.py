from __future__ import annotations

import json
import traceback
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from review_core import (
    ReviewItem,
    ReviewStore,
    build_schedule,
    format_datetime,
    import_rows,
    item_from_dict,
    manually_update_item,
    now_local,
    record_answer,
    schedule_item,
)


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "review_data.json"
SAMPLE_FILE = DATA_DIR / "sample_items.csv"


class ItemDialog(tk.Toplevel):
    """Create or edit one item. Blank next-review means derive it."""

    def __init__(self, parent: tk.Tk, item: ReviewItem | None = None):
        super().__init__(parent)
        self.result_item: ReviewItem | None = None
        self.editing = item
        self.title("编辑学习条目" if item else "新增学习条目")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()

        self.title_var = tk.StringVar(value=item.title if item else "")
        self.mastery_var = tk.StringVar(value=str(item.mastery if item else 50))
        self.importance_var = tk.StringVar(value=str(item.importance if item else 3))
        self.last_var = tk.StringVar(value=item.last_reviewed if item else "")
        self.next_var = tk.StringVar(value=item.next_review if item else "")

        frame = ttk.Frame(self, padding=16)
        frame.grid(row=0, column=0, sticky="nsew")
        frame.columnconfigure(1, weight=1)

        ttk.Label(frame, text="标题").grid(row=0, column=0, sticky="w", pady=4)
        ttk.Entry(frame, textvariable=self.title_var, width=44).grid(row=1, column=0, columnspan=2, sticky="ew")

        ttk.Label(frame, text="内容 / 提示").grid(row=2, column=0, sticky="w", pady=(10, 4))
        self.content_text = tk.Text(frame, width=44, height=5, wrap="word")
        self.content_text.grid(row=3, column=0, columnspan=2, sticky="ew")
        if item:
            self.content_text.insert("1.0", item.content)

        metrics = ttk.Frame(frame)
        metrics.grid(row=4, column=0, columnspan=2, sticky="ew", pady=10)
        ttk.Label(metrics, text="掌握程度 0-100").grid(row=0, column=0, sticky="w")
        ttk.Spinbox(metrics, from_=0, to=100, textvariable=self.mastery_var, width=7).grid(row=0, column=1, padx=(6, 18))
        ttk.Label(metrics, text="重要度 1-5").grid(row=0, column=2, sticky="w")
        ttk.Spinbox(metrics, from_=1, to=5, textvariable=self.importance_var, width=7).grid(row=0, column=3, padx=6)

        ttk.Label(frame, text="上次复习时间").grid(row=5, column=0, sticky="w", pady=4)
        ttk.Entry(frame, textvariable=self.last_var).grid(row=6, column=0, columnspan=2, sticky="ew")
        ttk.Label(frame, text="下次复习时间（留空则自动推导）").grid(row=7, column=0, sticky="w", pady=(10, 4))
        ttk.Entry(frame, textvariable=self.next_var).grid(row=8, column=0, columnspan=2, sticky="ew")

        ttk.Label(frame, text="备注").grid(row=9, column=0, sticky="w", pady=(10, 4))
        self.notes_text = tk.Text(frame, width=44, height=3, wrap="word")
        self.notes_text.grid(row=10, column=0, columnspan=2, sticky="ew")
        if item:
            self.notes_text.insert("1.0", item.notes)

        ttk.Label(
            frame,
            text="时间格式：YYYY-MM-DD 或 YYYY-MM-DD HH:MM。修改掌握度会重建该条目的记忆强度。",
            foreground="#555",
            wraplength=390,
        ).grid(row=11, column=0, columnspan=2, sticky="w", pady=(10, 0))

        buttons = ttk.Frame(frame)
        buttons.grid(row=12, column=0, columnspan=2, sticky="e", pady=(14, 0))
        ttk.Button(buttons, text="取消", command=self.destroy).grid(row=0, column=0, padx=6)
        ttk.Button(buttons, text="保存", command=self._save).grid(row=0, column=1)
        self.bind("<Return>", lambda _event: self._save())
        self.bind("<Escape>", lambda _event: self.destroy())
        self.wait_window()

    def _save(self) -> None:
        try:
            values = {
                "title": self.title_var.get(),
                "content": self.content_text.get("1.0", "end").strip(),
                "mastery": self.mastery_var.get(),
                "importance": self.importance_var.get(),
                "last_reviewed": self.last_var.get().strip(),
                "next_review": self.next_var.get().strip(),
                "notes": self.notes_text.get("1.0", "end").strip(),
            }
            if self.editing:
                self.result_item = self.editing
                manually_update_item(self.result_item, values, now_local())
            else:
                self.result_item = item_from_dict(values)
            self.destroy()
        except Exception as exc:
            messagebox.showerror("无法保存", str(exc), parent=self)


class ReviewApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("本地遗忘曲线复习规划")
        self.geometry("1120x720")
        self.minsize(960, 620)
        self.store: ReviewStore | None = None
        self.current_item_id: str | None = None
        self.queue: list = []
        self.view_var = tk.StringVar(value="今日待复习")
        self.status_var = tk.StringVar()
        self._init_store()
        self._build_layout()
        self.refresh_schedule(select_first=True)

    def _init_store(self) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        if not DATA_FILE.exists() and SAMPLE_FILE.exists():
            rows = import_rows(SAMPLE_FILE)
            self.store = ReviewStore(DATA_FILE)
            self.store.upsert_rows(rows, replace=True)
        else:
            self.store = ReviewStore(DATA_FILE)

    def _build_layout(self) -> None:
        style = ttk.Style(self)
        style.configure("Risk.TButton", foreground="#8a1f11")
        style.configure("Good.TButton", foreground="#14532d")

        root = ttk.Frame(self, padding=12)
        root.pack(fill="both", expand=True)
        header = ttk.Frame(root)
        header.pack(fill="x")
        ttk.Label(header, text="今日复习安排", font=("Microsoft YaHei UI", 18, "bold")).pack(side="left")
        view_combo = ttk.Combobox(
            header, textvariable=self.view_var, width=16, state="readonly",
            values=("今日待复习", "今日全部（含已完成）", "全部条目"),
        )
        view_combo.pack(side="left", padx=18)
        view_combo.bind(
            "<<ComboboxSelected>>",
            lambda _event: self.refresh_schedule(select_first=True),
        )
        ttk.Button(header, text="新增", command=self.add_item).pack(side="right", padx=4)
        ttk.Button(header, text="导入", command=self.import_items).pack(side="right", padx=4)
        ttk.Button(header, text="导出备份", command=self.export_items).pack(side="right", padx=4)
        ttk.Button(header, text="载入示例", command=self.load_samples).pack(side="right", padx=4)

        paned = ttk.PanedWindow(root, orient="horizontal")
        paned.pack(fill="both", expand=True, pady=10)

        left = ttk.Frame(paned)
        right = ttk.Frame(paned)
        paned.add(left, weight=2)
        paned.add(right, weight=3)

        columns = ("order", "title", "mastery", "importance", "retention", "next", "priority")
        headings = ("#", "条目", "掌握", "重要", "留存率", "下次复习", "紧迫分")
        widths = (36, 230, 55, 55, 75, 135, 70)
        self.tree = ttk.Treeview(left, columns=columns, show="headings", selectmode="browse")
        for column, heading, width in zip(columns, headings, widths):
            self.tree.heading(column, text=heading)
            self.tree.column(column, width=width, anchor="center")
        self.tree.column("title", anchor="w")
        self.tree.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=scrollbar.set)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        self.tree.bind("<<TreeviewSelect>>", self.on_select)

        detail_outer = ttk.Frame(right, padding=(14, 0, 0, 0))
        detail_outer.pack(fill="both", expand=True)
        self.detail = tk.Text(detail_outer, wrap="word", height=13, state="disabled", padx=10, pady=10)
        self.detail.pack(fill="x")
        self.feedback = tk.Text(detail_outer, wrap="word", height=9, state="disabled", padx=10, pady=10)
        self.feedback.pack(fill="both", expand=True, pady=(10, 0))

        actions = ttk.Frame(detail_outer)
        actions.pack(fill="x", pady=10)
        self.correct_button = ttk.Button(actions, text="答对（记忆可靠）", style="Good.TButton", command=lambda: self.answer(True))
        self.correct_button.pack(side="left")
        self.wrong_button = ttk.Button(actions, text="答错 / 想不起来", style="Risk.TButton", command=lambda: self.answer(False))
        self.wrong_button.pack(side="left", padx=8)
        ttk.Button(actions, text="手动编辑", command=self.edit_selected).pack(side="right", padx=4)
        ttk.Button(actions, text="删除", command=self.delete_selected).pack(side="right", padx=4)

        ttk.Label(root, textvariable=self.status_var, foreground="#444").pack(fill="x")

    def _set_text(self, widget: tk.Text, text: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")

    def refresh_schedule(self, select_first: bool = False, feedback: str = "") -> None:
        assert self.store is not None
        current = now_local()
        view = self.view_var.get()
        if view == "全部条目":
            entries = sorted(
                (schedule_item(item, current) for item in self.store.list_items()),
                key=lambda entry: (-entry.priority, entry.item.title),
            )
        else:
            entries = build_schedule(
                self.store.list_items(),
                current,
                include_completed=view.startswith("今日全部"),
            )
        self.queue = entries
        for old in self.tree.get_children():
            self.tree.delete(old)
        for index, entry in enumerate(entries, start=1):
            item = entry.item
            self.tree.insert(
                "", "end", iid=item.id,
                values=(
                    index, item.title, item.mastery, item.importance,
                    f"{entry.retention:.0%}", item.next_review or "今天",
                    f"{entry.priority:.1f}",
                ),
            )

        pending_entries = build_schedule(self.store.list_items(), current, False)
        pending = sum(1 for entry in pending_entries if entry.due_at <= current)
        completed = sum(1 for entry in build_schedule(self.store.list_items(), current, True) if entry.completed_today)
        self.status_var.set(
            f"本地数据：{DATA_FILE}｜当前 {current.strftime('%Y-%m-%d %H:%M')}｜"
            f"今日待完成 {pending} 条，已完成 {completed} 条。"
        )
        target_id = self.current_item_id if self.current_item_id in self.tree.get_children() else None
        if select_first and not target_id and entries:
            target_id = entries[0].item.id
        if target_id:
            self.tree.selection_set(target_id)
            self.tree.see(target_id)
        self.show_selected(feedback)

    def on_select(self, _event: object | None = None) -> None:
        selected = self.tree.selection()
        if selected:
            self.current_item_id = selected[0]
        self.show_selected()

    def _selected_item(self) -> ReviewItem | None:
        assert self.store is not None
        selected = self.tree.selection()
        if not selected:
            return None
        return self.store.items.get(selected[0])

    def show_selected(self, feedback: str = "") -> None:
        item = self._selected_item()
        if item is None:
            self._set_text(self.detail, "今日没有待复习条目，或请从“全部条目”中选择内容。")
            self._set_text(self.feedback, feedback)
            self.correct_button.state(["disabled"])
            self.wrong_button.state(["disabled"])
            return
        self.correct_button.state(["!disabled"])
        self.wrong_button.state(["!disabled"])
        entry = schedule_item(item, now_local())
        streak = (
            f"连续答对 {item.correct_streak}" if item.correct_streak
            else f"连续答错 {item.wrong_streak}" if item.wrong_streak else "暂无连续趋势"
        )
        text = (
            f"标题：{item.title}\n\n"
            f"内容 / 提示：\n{item.content or '（无）'}\n\n"
            f"掌握程度：{item.mastery}/100\n"
            f"重要度：{item.importance}/5（目标留存率 {entry.target:.0%}）\n"
            f"记忆强度：{item.stability_days:.1f} 天\n"
            f"当前估计留存率：{entry.retention:.0%}\n"
            f"上次复习：{item.last_reviewed or '从未复习'}\n"
            f"下次复习：{item.next_review or '今天'} {'（手动指定）' if item.manual_next else '（自动推导）'}\n"
            f"作答趋势：{streak}；累计复习 {item.total_reviews} 次\n\n"
            f"为什么排在前面：\n{entry.reason}"
        )
        self._set_text(self.detail, text)
        self._set_text(self.feedback, feedback)

    def answer(self, correct: bool) -> None:
        item = self._selected_item()
        if item is None or self.store is None:
            messagebox.showinfo("请选择条目", "请先在左侧选择一条今日复习内容。")
            return
        try:
            _, explanation = record_answer(item, correct, now_local())
            self.store.update_item(item)
            self.view_var.set("今日全部（含已完成）")
            self.refresh_schedule(
                feedback=("✅ 作答正确，已拉长间隔\n\n" if correct else "⚠️ 作答错误，已缩短间隔\n\n")
                + explanation["reason"]
            )
        except Exception as exc:
            messagebox.showerror("复习结果未保存", f"{exc}\n\n{traceback.format_exc()}")

    def add_item(self) -> None:
        try:
            dialog = ItemDialog(self, None)
            item = dialog.result_item
            if item and self.store:
                self.store.add_item(item)
                self.current_item_id = item.id
                self.refresh_schedule(feedback="条目已新增，并已根据初始掌握程度推导安排。")
        except Exception as exc:
            messagebox.showerror("新增失败", str(exc))

    def edit_selected(self) -> None:
        item = self._selected_item()
        if item is None:
            messagebox.showinfo("请选择条目", "请先选择要调整的条目。")
            return
        try:
            dialog = ItemDialog(self, item)
            if dialog.result_item and self.store:
                self.store.update_item(item)
                self.refresh_schedule(feedback="手动修改已保存：只重新计算这一条目，其他条目的排序与时间保持不变。")
        except Exception as exc:
            messagebox.showerror("修改失败", str(exc))

    def delete_selected(self) -> None:
        item = self._selected_item()
        if item is None or self.store is None:
            return
        if messagebox.askyesno("确认删除", f"确定删除「{item.title}」吗？此操作只会影响该条目。"):
            self.store.delete_item(item.id)
            self.current_item_id = None
            self.refresh_schedule(feedback="条目已删除，其他条目未改变。")

    def import_items(self) -> None:
        assert self.store is not None
        path = filedialog.askopenfilename(
            title="导入学习条目",
            filetypes=(("CSV 或 JSON", "*.csv *.json"), ("所有文件", "*.*")),
        )
        if not path:
            return
        try:
            rows = import_rows(path)
            replace = messagebox.askyesno(
                "导入方式",
                "选择“是”将替换全部本地条目；选择“否”将按 id 合并/新增，保留其他条目。",
            )
            count, total = self.store.upsert_rows(rows, replace=replace)
            self.current_item_id = None
            self.refresh_schedule(feedback=f"已导入 {count} 条，当前共有 {total} 条；今日安排已重新推导。")
        except Exception as exc:
            messagebox.showerror("导入失败", str(exc))

    def export_items(self) -> None:
        assert self.store is not None
        path = filedialog.asksaveasfilename(
            title="导出本地备份",
            defaultextension=".json",
            initialfile="review_backup.json",
            filetypes=(("JSON", "*.json"),),
        )
        if not path:
            return
        try:
            payload = {"version": 1, "exported_at": format_datetime(now_local()),
                       "items": [vars(item) for item in self.store.list_items()]}
            Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            messagebox.showinfo("导出完成", f"备份已保存到：\n{path}")
        except Exception as exc:
            messagebox.showerror("导出失败", str(exc))

    def load_samples(self) -> None:
        assert self.store is not None
        replace = messagebox.askyesno(
            "载入示例",
            "选择“是”将用示例替换当前数据；选择“否”将把示例合并进当前数据。",
        )
        try:
            rows = import_rows(SAMPLE_FILE)
            count, total = self.store.upsert_rows(rows, replace=replace)
            self.current_item_id = None
            self.refresh_schedule(feedback=f"示例已载入：{count} 条，当前共有 {total} 条。")
        except Exception as exc:
            messagebox.showerror("示例载入失败", str(exc))


def main() -> None:
    app = ReviewApp()
    app.mainloop()


if __name__ == "__main__":
    main()
