"""Offline Tkinter desktop UI implemented with the Python standard library."""

import math
import tkinter as tk
from tkinter import messagebox, ttk

from .camera import Camera, project_annotations
from .geometry import transform_point
from .model import Transform, ValidationError
from .sample_data import build_sample_scene


STATUS_TEXT = {
    "visible": "Visible",
    "occluded": "Occluded",
    "offscreen": "Off-screen",
    "behind": "Behind camera",
}
STATUS_COLOR = {
    "visible": "#1a7f37",
    "occluded": "#b45309",
    "offscreen": "#9a3412",
    "behind": "#8a3ffc",
}


class ReviewApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Offline 3D Spatial Annotation Review")
        self.geometry("1280x800")
        self.minsize(1050, 650)
        self.scene = build_sample_scene()
        self.camera = Camera(target=(0.0, 0.45, 0.0), distance=9.0)
        self.selected_object = tk.StringVar()
        self.drag_start = None
        self.projected = []
        self._build_ui()
        self.refresh_all()

    def _build_ui(self):
        root = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        root.pack(fill=tk.BOTH, expand=True)
        left = ttk.Frame(root)
        root.add(left, weight=4)
        toolbar = ttk.Frame(left, padding=(8, 6))
        toolbar.pack(fill=tk.X)
        ttk.Button(toolbar, text="Reset camera", command=self.reset_camera).pack(side=tk.LEFT)
        ttk.Label(toolbar,
                  text="Left-drag orbit | Right-drag pan | Wheel zoom | green visible, orange occluded").pack(
            side=tk.LEFT, padx=12)
        self.view = tk.Canvas(left, bg="#f8fafc", highlightthickness=0)
        self.view.pack(fill=tk.BOTH, expand=True)
        self.view.bind("<ButtonPress-1>", self._begin_orbit)
        self.view.bind("<B1-Motion>", self._orbit)
        self.view.bind("<ButtonPress-3>", self._begin_pan)
        self.view.bind("<B3-Motion>", self._pan)
        self.view.bind("<MouseWheel>", self._zoom_windows)
        self.view.bind("<Button-4>", lambda _e: self._zoom(0.9))
        self.view.bind("<Button-5>", lambda _e: self._zoom(1.1))
        self.view.bind("<Configure>", lambda _e: self.update_screen())
        self.status = ttk.Label(left, text="", anchor=tk.W, padding=(8, 3))
        self.status.pack(fill=tk.X)

        right = ttk.Frame(root, padding=8)
        root.add(right, weight=3)
        notebook = ttk.Notebook(right)
        notebook.pack(fill=tk.BOTH, expand=True)
        self._build_object_tab(notebook)
        self._build_annotation_tab(notebook)
        self._build_relation_tab(notebook)
        self._build_conflict_tab(notebook)
        self._build_evidence_tab(notebook)

    def _build_object_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=6)
        notebook.add(tab, text="Objects")
        ttk.Label(tab, text="Object hierarchy", font=("Segoe UI", 10, "bold")).pack(anchor=tk.W)
        self.object_tree = ttk.Treeview(tab, columns=("size",), height=8, show="tree headings")
        self.object_tree.heading("#0", text="Object ID")
        self.object_tree.heading("size", text="Bounds size")
        self.object_tree.column("size", width=130, anchor=tk.E)
        self.object_tree.pack(fill=tk.X, pady=(4, 8))
        self.object_tree.bind("<<TreeviewSelect>>", lambda _e: self.on_object_select())

        add = ttk.LabelFrame(tab, text="Add object", padding=6)
        add.pack(fill=tk.X)
        self.new_obj_id = tk.StringVar()
        self.new_obj_parent = tk.StringVar(value="<root>")
        self.new_obj_size = tk.StringVar(value="1, 1, 1")
        for row, (label, var, width) in enumerate((
            ("ID", self.new_obj_id, 10), ("Parent", self.new_obj_parent, 12),
            ("Size x,y,z", self.new_obj_size, 18)
        )):
            ttk.Label(add, text=label).grid(row=0, column=row * 2, sticky=tk.W, padx=2)
            ttk.Entry(add, width=width, textvariable=var).grid(
                row=0, column=row * 2 + 1, padx=2)
        ttk.Button(add, text="Add", command=self.add_object).grid(row=0, column=6, padx=6)
        self.parent_combo_for_add = None

        form = ttk.LabelFrame(tab, text="Set absolute transform of selected object", padding=6)
        form.pack(fill=tk.X, pady=8)
        self.obj_vars = {}
        labels = (("tx", "X"), ("ty", "Y"), ("tz", "Z"),
                  ("rx", "Rot X"), ("ry", "Rot Y"), ("rz", "Rot Z"),
                  ("sx", "Scale X"), ("sy", "Scale Y"), ("sz", "Scale Z"))
        for row, (key, label) in enumerate(labels):
            ttk.Label(form, text=label).grid(row=row // 3, column=(row % 3) * 2,
                                             sticky=tk.W, padx=2, pady=2)
            var = tk.StringVar()
            self.obj_vars[key] = var
            ttk.Entry(form, width=8, textvariable=var).grid(
                row=row // 3, column=(row % 3) * 2 + 1, padx=2, pady=2)
        ttk.Button(form, text="Apply transform", command=self.apply_transform).grid(
            row=3, column=0, columnspan=3, sticky=tk.W, pady=(5, 0))

        move = ttk.LabelFrame(tab, text="Reparent selected object", padding=6)
        move.pack(fill=tk.X)
        self.new_parent = tk.StringVar(value="<root>")
        self.parent_combo = ttk.Combobox(move, textvariable=self.new_parent, state="readonly")
        self.parent_combo.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(move, text="Reparent", command=self.reparent_selected).pack(side=tk.LEFT, padx=6)
        ttk.Button(tab, text="Delete selected object and its children",
                   command=self.delete_selected).pack(anchor=tk.W, pady=8)

    def _build_annotation_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=6)
        notebook.add(tab, text="Annotations")
        columns = ("id", "source", "object", "screen", "state", "valid", "body")
        self.ann_tree = ttk.Treeview(tab, columns=columns, show="headings", height=14)
        headings = {
            "id": "Ann", "source": "Source", "object": "Object",
            "screen": "Screen x,y (px)", "state": "Visibility",
            "valid": "State", "body": "Body"
        }
        widths = {"id": 55, "source": 95, "object": 90, "screen": 130,
                  "state": 95, "valid": 70, "body": 260}
        for key in columns:
            self.ann_tree.heading(key, text=headings[key])
            self.ann_tree.column(key, width=widths[key], stretch=(key == "body"))
        self.ann_tree.pack(fill=tk.BOTH, expand=True)
        self.ann_tree.tag_configure("invalid", foreground="#991b1b")
        self.ann_tree.tag_configure("conflict", background="#fff7ed")
        self.ann_tree.tag_configure("occluded", foreground="#b45309")
        self.ann_tree.tag_configure("offscreen", foreground="#9a3412")
        self.ann_tree.tag_configure("behind", foreground="#7e22ce")

        add = ttk.LabelFrame(tab,
                             text="Add annotation; contradictory same ID is retained as a conflict",
                             padding=6)
        add.pack(fill=tk.X, pady=(8, 0))
        self.new_ann_id = tk.StringVar()
        self.new_ann_object = tk.StringVar()
        self.new_ann_source = tk.StringVar(value="manual_review")
        self.new_ann_anchor = tk.StringVar(value="0.5, 0.5, 0.5")
        self.new_ann_body = tk.StringVar()
        for i, (label, var, width) in enumerate((
            ("ID", self.new_ann_id, 7), ("Object", self.new_ann_object, 10),
            ("Source", self.new_ann_source, 13),
            ("Local anchor x,y,z", self.new_ann_anchor, 18)
        )):
            ttk.Label(add, text=label).grid(row=0, column=i * 2, sticky=tk.W, padx=2)
            ttk.Entry(add, width=width, textvariable=var).grid(
                row=0, column=i * 2 + 1, padx=2, pady=2)
        ttk.Label(add, text="Body").grid(row=1, column=0, sticky=tk.W, padx=2)
        ttk.Entry(add, textvariable=self.new_ann_body).grid(
            row=1, column=1, columnspan=5, sticky=tk.EW, padx=2, pady=2)
        ttk.Button(add, text="Add", command=self.add_annotation).grid(
            row=0, column=8, rowspan=2, padx=8)

    def _build_relation_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=6)
        notebook.add(tab, text="Relations")
        ttk.Label(tab, text="Current relations (blue = reference, red = attachment)").pack(anchor=tk.W)
        self.relation_list = tk.Listbox(tab, height=8)
        self.relation_list.pack(fill=tk.X, pady=5)
        box = ttk.LabelFrame(tab, text="Declare relation (cycles and missing targets are rejected)",
                             padding=6)
        box.pack(fill=tk.X)
        self.rel_from = tk.StringVar()
        self.rel_from_source = tk.StringVar()
        self.rel_to = tk.StringVar()
        self.rel_to_source = tk.StringVar()
        self.rel_kind = tk.StringVar(value="reference")
        for row, (label, var) in enumerate((
            ("From annotation", self.rel_from), ("From source", self.rel_from_source),
            ("To annotation", self.rel_to), ("To source", self.rel_to_source)
        )):
            ttk.Label(box, text=label).grid(row=row, column=0, sticky=tk.W, padx=2, pady=2)
            ttk.Entry(box, textvariable=var, width=24).grid(row=row, column=1, sticky=tk.EW)
        ttk.Label(box, text="Kind").grid(row=0, column=2, padx=4)
        ttk.Combobox(box, textvariable=self.rel_kind, values=("reference", "attachment"),
                     state="readonly", width=12).grid(row=0, column=3)
        ttk.Button(box, text="Declare", command=self.add_relation).grid(
            row=1, column=2, columnspan=2, padx=4)

    def _build_conflict_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=6)
        notebook.add(tab, text="Conflicts")
        self.conflict_text = tk.Text(tab, wrap=tk.WORD, bg="#fffaf0")
        self.conflict_text.pack(fill=tk.BOTH, expand=True)
        self.conflict_text.configure(state=tk.DISABLED)

    def _build_evidence_tab(self, notebook):
        tab = ttk.Frame(notebook, padding=6)
        notebook.add(tab, text="Evidence / Rejections")
        self.evidence_text = tk.Text(tab, wrap=tk.WORD)
        self.evidence_text.pack(fill=tk.BOTH, expand=True)
        self.evidence_text.configure(state=tk.DISABLED)

    # Camera controls
    def reset_camera(self):
        self.camera = Camera(target=(0.0, 0.45, 0.0), distance=9.0)
        self.refresh_all()

    def _begin_orbit(self, event):
        self.drag_start = (event.x, event.y)

    def _orbit(self, event):
        if not self.drag_start:
            return
        x0, y0 = self.drag_start
        self.camera.orbit((event.x - x0) * 0.01, (event.y - y0) * 0.01)
        self.drag_start = (event.x, event.y)
        self.update_screen()

    def _begin_pan(self, event):
        self.drag_start = (event.x, event.y)

    def _pan(self, event):
        if not self.drag_start:
            return
        x0, y0 = self.drag_start
        scale = self.camera.distance / 650.0
        self.camera.pan((event.x - x0) * scale, -(event.y - y0) * scale)
        self.drag_start = (event.x, event.y)
        self.update_screen()

    def _zoom_windows(self, event):
        self._zoom(0.9 if event.delta > 0 else 1.1)

    def _zoom(self, factor):
        self.camera.zoom(factor)
        self.update_screen()

    def update_screen(self):
        self.refresh_view()
        if hasattr(self, "ann_tree"):
            self.refresh_annotation_table()

    # Refresh and rendering
    def refresh_all(self):
        self.refresh_object_tree()
        self.refresh_view()
        self.refresh_annotation_table()
        self.refresh_relation_list()
        self.refresh_conflicts()
        self.refresh_evidence()

    def refresh_object_tree(self):
        selected = self.selected_object.get()
        self.object_tree.delete(*self.object_tree.get_children())
        inserted = {}

        def insert(obj_id):
            if obj_id in inserted:
                return inserted[obj_id]
            obj = self.scene.objects[obj_id]
            parent = ""
            if obj.parent_id and obj.parent_id in self.scene.objects:
                parent = insert(obj.parent_id)
            size = ", ".join(f"{v:.2f}" for v in obj.size)
            inserted[obj_id] = self.object_tree.insert(
                parent, tk.END, text=obj_id, values=(size,), iid=obj_id)
            return inserted[obj_id]

        for obj_id in self.scene.object_order:
            insert(obj_id)
        for child in self.object_tree.get_children():
            self.expand_tree(child)
        if selected in self.scene.objects:
            self.object_tree.selection_set(selected)
        values = ["<root>"] + list(self.scene.objects.keys())
        self.parent_combo["values"] = values
        if self.new_parent.get() not in values:
            self.new_parent.set("<root>")

    def expand_tree(self, item):
        self.object_tree.item(item, open=True)
        for child in self.object_tree.get_children(item):
            self.expand_tree(child)

    def on_object_select(self):
        selection = self.object_tree.selection()
        if not selection:
            return
        self.selected_object.set(selection[0])
        self.new_ann_object.set(selection[0])
        tr = self.scene.objects[selection[0]].transform
        values = {
            "tx": tr.translation[0], "ty": tr.translation[1], "tz": tr.translation[2],
            "rx": math.degrees(tr.rotation_xyz[0]),
            "ry": math.degrees(tr.rotation_xyz[1]),
            "rz": math.degrees(tr.rotation_xyz[2]),
            "sx": tr.scale[0], "sy": tr.scale[1], "sz": tr.scale[2],
        }
        for key, value in values.items():
            self.obj_vars[key].set(f"{value:.3g}")

    def refresh_annotation_table(self):
        self.ann_tree.delete(*self.ann_tree.get_children())
        width = max(self.view.winfo_width(), 100)
        height = max(self.view.winfo_height(), 100)
        self.projected = project_annotations(self.scene, self.camera, width, height)
        for p in self.projected:
            screen = "—" if p.screen is None else f"{p.screen[0]:.1f}, {p.screen[1]:.1f}"
            tags = []
            if p.invalid:
                tags.append("invalid")
            if p.conflict:
                tags.append("conflict")
            if p.visibility in ("occluded", "offscreen", "behind"):
                tags.append(p.visibility)
            self.ann_tree.insert("", tk.END, iid=f"{p.ann_id}|{p.source}", values=(
                p.ann_id, p.source, p.object_id, screen,
                STATUS_TEXT[p.visibility], "INVALID" if p.invalid else "valid", p.body
            ), tags=tuple(tags))
        counts = {key: sum(1 for p in self.projected if p.visibility == key)
                  for key in STATUS_TEXT}
        invalid = sum(1 for p in self.projected if p.invalid)
        self.status.configure(
            text=f"Visible {counts['visible']} | Occluded {counts['occluded']} | "
                 f"Off-screen {counts['offscreen']} | Behind {counts['behind']} | "
                 f"Invalid {invalid} | Conflicts {len(self.scene.conflicts)}")

    def refresh_relation_list(self):
        self.relation_list.delete(0, tk.END)
        for rel in self.scene.relations:
            self.relation_list.insert(
                tk.END,
                f"{rel.from_annotation}@{rel.from_source} --{rel.kind}--> "
                f"{rel.to_annotation}@{rel.to_source}")

    def refresh_view(self):
        if not hasattr(self, "view"):
            return
        canvas = self.view
        width, height = max(canvas.winfo_width(), 100), max(canvas.winfo_height(), 100)
        canvas.delete("all")
        for x in range(-6, 8, 2):
            self._line_world(canvas, width, height, (x, -0.02, -6), (x, -0.02, 6), "#e2e8f0")
        for z in range(-6, 8, 2):
            self._line_world(canvas, width, height, (-6, -0.02, z), (6, -0.02, z), "#e2e8f0")

        for obj_id, obj in self.scene.objects.items():
            sx, sy, sz = obj.size
            corners = [(x, y, z) for x in (0, sx) for y in (0, sy) for z in (0, sz)]
            points = []
            for corner in corners:
                world = transform_point(self.scene.world_matrix(obj_id), corner)
                points.append(self.camera.project_point(world, width, height))
            edges = ((0,1),(1,3),(3,2),(2,0),(4,5),(5,7),(7,6),(6,4),
                     (0,4),(1,5),(2,6),(3,7))
            color = "#0f766e" if obj_id == self.selected_object.get() else "#64748b"
            line_width = 2 if obj_id == self.selected_object.get() else 1
            for a, b in edges:
                if points[a] and points[b]:
                    canvas.create_line(points[a][0], points[a][1], points[b][0], points[b][1],
                                       fill=color, width=line_width)
            label = self.camera.project_point(
                transform_point(self.scene.world_matrix(obj_id), (sx / 2, sy, sz / 2)),
                width, height)
            if label:
                canvas.create_text(label[0], label[1] - 10, text=obj_id,
                                   fill="#334155", font=("Segoe UI", 8, "bold"))

        projected = project_annotations(self.scene, self.camera, width, height)
        self.projected = projected
        by_key = {(p.ann_id, p.source): p for p in projected}
        for rel in self.scene.relations:
            p1 = by_key.get((rel.from_annotation, rel.from_source))
            p2 = by_key.get((rel.to_annotation, rel.to_source))
            if p1 and p2 and p1.screen and p2.screen:
                canvas.create_line(
                    p1.screen[0], p1.screen[1], p2.screen[0], p2.screen[1],
                    fill="#6366f1" if rel.kind == "reference" else "#dc2626",
                    dash=(4, 3) if rel.kind == "reference" else (1, 2),
                    arrow=tk.LAST, width=1.5)
        for p in projected:
            self.draw_annotation(canvas, p)
        canvas.create_text(
            12, 12, anchor=tk.NW,
            text="Red X = invalid; yellow box = conflict; edge markers = outside/behind view",
            fill="#475569", font=("Segoe UI", 9))

    def _line_world(self, canvas, width, height, a, b, color):
        p1 = self.camera.project_point(a, width, height)
        p2 = self.camera.project_point(b, width, height)
        if p1 and p2:
            canvas.create_line(p1[0], p1[1], p2[0], p2[1], fill=color)

    def draw_annotation(self, canvas, p):
        x, y = p.edge_marker if p.screen is None or p.visibility == "offscreen" else p.screen
        color = STATUS_COLOR[p.visibility]
        if p.conflict:
            canvas.create_rectangle(x - 8, y - 8, x + 8, y + 8,
                                    outline="#ca8a04", width=2)
        if p.invalid:
            canvas.create_line(x - 7, y - 7, x + 7, y + 7, fill="#dc2626", width=2)
            canvas.create_line(x - 7, y + 7, x + 7, y - 7, fill="#dc2626", width=2)
        else:
            canvas.create_oval(x - 5, y - 5, x + 5, y + 5, fill=color, outline=color)
        label = f"{p.ann_id}@{p.source}"
        if p.visibility != "visible":
            label += f" [{STATUS_TEXT[p.visibility]}]"
        if p.invalid:
            label += " [INVALID]"
        canvas.create_text(x + 10, y - 10, text=label, anchor=tk.W,
                           fill="#111827", font=("Segoe UI", 8, "bold"))
        if p.visibility == "offscreen" and p.screen:
            sx, sy = p.screen
            canvas.create_line(x, y, x + max(-8, min(8, sx - x)),
                               y + max(-8, min(8, sy - y)),
                               fill=color, width=2, arrow=tk.LAST)

    def set_text(self, widget, content):
        widget.configure(state=tk.NORMAL)
        widget.delete("1.0", tk.END)
        widget.insert("1.0", content)
        widget.configure(state=tk.DISABLED)

    def refresh_conflicts(self):
        if not self.scene.conflicts:
            self.set_text(self.conflict_text, "No conflicts.\n")
            return
        lines = []
        for i, c in enumerate(self.scene.conflicts, 1):
            lines.append(f"{i}. {c.message}")
            for item in c.contents:
                anchor = tuple(round(v, 4) for v in item["local_anchor"])
                lines.append(
                    f"   - Source {item['source']}: object={item['object_id']}, "
                    f"anchor={anchor}, body={item['body']}")
            lines.append("")
        self.set_text(self.conflict_text, "\n".join(lines))

    def refresh_evidence(self):
        invalid = [s for s in self.scene.annotation_states() if not s.valid]
        if not invalid:
            self.set_text(self.evidence_text, "No invalid annotations.\n")
            return
        lines = []
        for state in invalid:
            ev = state.evidence
            lines.extend([
                f"Annotation {state.annotation.id}@{state.annotation.source} is INVALID",
                f"  Original object: {ev.object_id}; path: {' -> '.join(ev.object_path)}",
                f"  Original local anchor: {tuple(round(v, 4) for v in ev.local_anchor)}",
                f"  Frozen world anchor: {tuple(round(v, 4) for v in ev.world_anchor)}",
                f"  Reason/evidence: {ev.reason}", ""
            ])
        self.set_text(self.evidence_text, "\n".join(lines))

    # Mutations
    @staticmethod
    def parse_vec3(text, label):
        parts = [part.strip() for part in text.split(",")]
        if len(parts) != 3:
            raise ValueError(f"{label} must contain three numbers")
        return tuple(float(part) for part in parts)

    def show_error(self, exc):
        lines = [str(exc)]
        for issue in exc.issues:
            line = f"- {issue.get('location', '<unknown>')}: {issue.get('reason', '')}"
            if "value" in issue:
                line += f"; value={issue['value']!r}"
            if issue.get("chain"):
                chain = issue["chain"]
                chain_text = " -> ".join(chain) if isinstance(chain, list) else str(chain)
                line += f"; chain: {chain_text}"
            lines.append(line)
        messagebox.showerror("Operation rejected", "\n".join(lines))
        self.evidence_text.configure(state=tk.NORMAL)
        self.evidence_text.insert(tk.END, "REJECTED\n" + "\n".join(lines) + "\n\n")
        self.evidence_text.configure(state=tk.DISABLED)

    def add_object(self):
        try:
            parent = None if self.new_obj_parent.get() == "<root>" else self.new_obj_parent.get()
            size = self.parse_vec3(self.new_obj_size.get(), "Size")
            self.scene.add_object(self.new_obj_id.get().strip(), parent, Transform(), size)
        except ValidationError as exc:
            self.show_error(exc)
        except ValueError:
            messagebox.showerror("Invalid input", "Size must be x,y,z numeric values.")
            return
        self.new_obj_id.set("")
        self.refresh_all()

    def apply_transform(self):
        obj_id = self.selected_object.get()
        if obj_id not in self.scene.objects:
            messagebox.showinfo("Select object", "Select an object first.")
            return
        try:
            t = tuple(float(self.obj_vars[k].get()) for k in ("tx", "ty", "tz"))
            r = tuple(math.radians(float(self.obj_vars[k].get()))
                      for k in ("rx", "ry", "rz"))
            s = tuple(float(self.obj_vars[k].get()) for k in ("sx", "sy", "sz"))
            self.scene.set_object_transform(obj_id, Transform(t, r, s))
        except ValidationError as exc:
            self.show_error(exc)
            return
        except ValueError:
            messagebox.showerror("Invalid input", "All transform fields must be numeric.")
            return
        self.refresh_all()

    def reparent_selected(self):
        obj_id = self.selected_object.get()
        if obj_id not in self.scene.objects:
            messagebox.showinfo("Select object", "Select an object first.")
            return
        parent = None if self.new_parent.get() == "<root>" else self.new_parent.get()
        try:
            self.scene.reparent_object(obj_id, parent)
        except ValidationError as exc:
            self.show_error(exc)
            return
        self.refresh_all()

    def delete_selected(self):
        obj_id = self.selected_object.get()
        if obj_id not in self.scene.objects:
            messagebox.showinfo("Select object", "Select an object first.")
            return
        subtree = self.scene.subtree_ids(obj_id)
        if not messagebox.askyesno(
            "Confirm delete",
            f"Delete {', '.join(subtree)}? Annotations will be frozen and marked invalid."):
            return
        self.scene.delete_object(obj_id)
        self.selected_object.set("")
        self.refresh_all()

    def add_annotation(self):
        try:
            anchor = self.parse_vec3(self.new_ann_anchor.get(), "Local anchor")
            self.scene.add_annotation(
                self.new_ann_id.get().strip(),
                self.new_ann_object.get().strip(),
                anchor,
                self.new_ann_body.get().strip(),
                self.new_ann_source.get().strip() or "manual_review")
        except ValidationError as exc:
            self.show_error(exc)
            self.refresh_all()
            return
        except ValueError:
            messagebox.showerror("Invalid input", "Anchor must be three numeric values.")
            return
        self.new_ann_body.set("")
        self.refresh_all()

    def add_relation(self):
        try:
            self.scene.add_relation(
                self.rel_from.get().strip(),
                self.rel_to.get().strip(),
                self.rel_kind.get(),
                self.rel_from_source.get().strip() or None,
                self.rel_to_source.get().strip() or None)
        except ValidationError as exc:
            self.show_error(exc)
            return
        self.rel_from.set("")
        self.rel_to.set("")
        self.refresh_all()


def main():
    ReviewApp().mainloop()


if __name__ == "__main__":
    main()
