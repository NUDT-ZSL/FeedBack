"""时间轴画布：标尺、锚点标记、片段条。支持点击选择与拖拽锚点。"""
import tkinter as tk

STATUS_COLOR = {"ok": "#4caf50", "conflict": "#ff9800",
                "untrusted": "#e53935"}


class TimelineCanvas(tk.Canvas):
    def __init__(self, master, on_select_segment=None, on_select_anchor=None,
                 on_move_anchor=None, **kw):
        super().__init__(master, bg="#1e1e1e", highlightthickness=0, **kw)
        self.on_select_segment = on_select_segment
        self.on_select_anchor = on_select_anchor
        self.on_move_anchor = on_move_anchor
        self.engine = None
        self.px_per_sec = 2.0
        self.left = 60
        self.seg_y, self.seg_h = 46, 22
        self._drag_anchor = None
        self.bind("<Button-1>", self._click)
        self.bind("<B1-Motion>", self._drag)
        self.bind("<ButtonRelease-1>", self._release)

    def set_engine(self, engine):
        self.engine = engine
        self.redraw()

    def _x(self, t):
        return self.left + t * self.px_per_sec

    def _t(self, x):
        return max(0.0, (x - self.left) / self.px_per_sec)

    def redraw(self):
        self.delete("all")
        eng = self.engine
        if not eng:
            return
        dur = eng.media.duration
        w = self._x(dur) + 40
        self.config(scrollregion=(0, 0, w, 120))
        # 标尺
        step = 60 if dur > 300 else 10
        t = 0.0
        while t <= dur:
            x = self._x(t)
            self.create_line(x, 28, x, 34, fill="#888")
            self.create_text(x, 18, text=f"{int(t//60)}:{int(t%60):02d}",
                             fill="#aaa", font=("Consolas", 8))
            t += step
        self.create_line(self._x(0), 34, self._x(dur), 34, fill="#888")
        # 片段条（对齐后位置）
        self._bars = {}
        for seg in eng.segments:
            r = eng.results[seg.id]
            if r.aligned_start is None:
                x0, x1 = self._x(seg.start), self._x(seg.end)
                dash = (3, 2)
            else:
                x0, x1 = self._x(r.aligned_start), self._x(r.aligned_end)
                dash = None
            color = STATUS_COLOR[r.status]
            bid = self.create_rectangle(x0, self.seg_y, max(x1, x0 + 3),
                                        self.seg_y + self.seg_h,
                                        fill=color, outline="", dash=dash,
                                        tags=(f"seg:{seg.id}",))
            self._bars[bid] = seg.id
            self.create_text(x0 + 3, self.seg_y + self.seg_h / 2,
                             text=seg.id, anchor="w", fill="#111",
                             font=("Consolas", 8), tags=(f"seg:{seg.id}",))
        # 锚点
        self._anchors = {}
        for a in eng.anchors.values():
            x = self._x(a.media_time)
            tid = self.create_polygon(x, 36, x - 6, 24, x + 6, 24,
                                      fill="#03a9f4", outline="",
                                      tags=(f"anchor:{a.id}",))
            self.create_text(x, 12, text=f"{a.id} {a.label}",
                             fill="#03a9f4", font=("Consolas", 8),
                             tags=(f"anchor:{a.id}",))
            self.create_line(x, 36, x, self.seg_y + self.seg_h,
                             fill="#03a9f4", dash=(2, 3),
                             tags=(f"anchor:{a.id}",))
            self._anchors[tid] = a.id

    def _hit(self, event, prefix):
        x = self.canvasx(event.x)
        for item in self.find_overlapping(x - 3, event.y - 3,
                                          x + 3, event.y + 3):
            for tag in self.gettags(item):
                if tag.startswith(prefix):
                    return tag.split(":", 1)[1]
        return None

    def _click(self, event):
        aid = self._hit(event, "anchor:")
        if aid and self.on_select_anchor:
            self._drag_anchor = aid
            self.on_select_anchor(aid)
            return
        sid = self._hit(event, "seg:")
        if sid and self.on_select_segment:
            self.on_select_segment(sid)

    def _drag(self, event):
        if self._drag_anchor and self.engine:
            t = self._t(self.canvasx(event.x))
            self.engine.anchors[self._drag_anchor].media_time = t
            self.redraw()

    def _release(self, event):
        if self._drag_anchor and self.on_move_anchor:
            t = self._t(self.canvasx(event.x))
            self.on_move_anchor(self._drag_anchor, t)
        self._drag_anchor = None
