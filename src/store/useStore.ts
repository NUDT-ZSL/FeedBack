import { create } from "zustand";
import { persist } from "zustand/middleware";
import { computeAll, recomputeScoped, verifyConsistency } from "@/engine/compute";
import { sampleDataset, uid } from "@/engine/sample";
import type {
  Book,
  Channel,
  Dataset,
  Placement,
  Result,
  Sale,
  Slot,
} from "@/engine/types";

interface VerifyState {
  checkedAt: string;
  diffs: string[];
}

interface State {
  ds: Dataset;
  result: Result;
  verify: VerifyState | null;
  addBook: (b: Omit<Book, "id">) => void;
  updateBook: (b: Book) => void;
  removeBook: (id: string) => void;
  addSlot: (name: string) => void;
  removeSlot: (id: string) => void;
  addPlacement: (p: Omit<Placement, "id">) => void;
  removePlacement: (id: string) => void;
  addSale: (s: Omit<Sale, "id">) => void;
  updateSale: (s: Sale) => void;
  removeSale: (id: string) => void;
  resolve: (saleId: string, pick: number) => void;
  loadSample: () => void;
  clearAll: () => void;
  importDataset: (raw: string) => { ok: boolean; error?: string };
  exportDataset: () => string;
  runVerify: () => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ds: sampleDataset,
      result: computeAll(sampleDataset),
      verify: null,

      addBook: (b) => {
        const book: Book = { ...b, id: uid("book") };
        const ds = { ...get().ds, books: [...get().ds.books, book] };
        set({ ds, result: computeAll(ds), verify: null });
      },
      updateBook: (book) => {
        const ds = {
          ...get().ds,
          books: get().ds.books.map((b) => (b.id === book.id ? book : b)),
        };
        set({ ds, result: computeAll(ds), verify: null });
      },
      removeBook: (id) => {
        const ds: Dataset = {
          ...get().ds,
          books: get().ds.books.filter((b) => b.id !== id),
          placements: get().ds.placements.filter((p) => p.bookId !== id),
          sales: get().ds.sales.filter((s) => s.bookId !== id),
          resolutions: Object.fromEntries(
            Object.entries(get().ds.resolutions).filter(([saleId]) =>
              get().ds.sales.some((s) => s.id === saleId && s.bookId !== id)
            )
          ),
        };
        set({ ds, result: computeAll(ds), verify: null });
      },

      addSlot: (name) => {
        const slot: Slot = { id: uid("slot"), name };
        const ds = { ...get().ds, slots: [...get().ds.slots, slot] };
        set({ ds, result: computeAll(ds), verify: null });
      },
      removeSlot: (id) => {
        const ds: Dataset = {
          ...get().ds,
          slots: get().ds.slots.filter((s) => s.id !== id),
          placements: get().ds.placements.filter((p) => p.slotId !== id),
        };
        set({ ds, result: computeAll(ds), verify: null });
      },

      addPlacement: (p) => {
        const placement: Placement = { ...p, id: uid("pl") };
        const ds = { ...get().ds, placements: [...get().ds.placements, placement] };
        set({ ds, result: computeAll(ds), verify: null });
      },
      removePlacement: (id) => {
        const ds = {
          ...get().ds,
          placements: get().ds.placements.filter((p) => p.id !== id),
        };
        set({ ds, result: computeAll(ds), verify: null });
      },

      addSale: (s) => {
        const sale: Sale = { ...s, id: uid("sale") };
        const ds = { ...get().ds, sales: [...get().ds.sales, sale] };
        set({ ds, result: computeAll(ds), verify: null });
      },
      updateSale: (sale) => {
        const ds = {
          ...get().ds,
          sales: get().ds.sales.map((s) => (s.id === sale.id ? sale : s)),
        };
        const nextResolutions = { ...ds.resolutions };
        delete nextResolutions[sale.id];
        ds.resolutions = nextResolutions;
        set({ ds, result: computeAll(ds), verify: null });
      },
      removeSale: (id) => {
        const ds: Dataset = {
          ...get().ds,
          sales: get().ds.sales.filter((s) => s.id !== id),
        };
        delete ds.resolutions[id];
        set({ ds, result: computeAll(ds), verify: null });
      },

      resolve: (saleId, pick) => {
        const prevDs = get().ds;
        const ds = { ...prevDs, resolutions: { ...prevDs.resolutions, [saleId]: pick } };
        const scoped = recomputeScoped(get().result, ds, [saleId]);
        const full = computeAll(ds);
        const diffs = verifyConsistency(scoped, full);
        set({
          ds,
          result: diffs.length === 0 ? scoped : full,
          verify: {
            checkedAt: new Date().toISOString(),
            diffs: diffs.length === 0 ? [] : [`局部重算不一致，已自动整体重算：${diffs.join("、")}`],
          },
        });
      },

      loadSample: () =>
        set({ ds: sampleDataset, result: computeAll(sampleDataset), verify: null }),
      clearAll: () => {
        const empty: Dataset = { books: [], slots: [], placements: [], sales: [], resolutions: {} };
        set({ ds: empty, result: computeAll(empty), verify: null });
      },
      importDataset: (raw) => {
        try {
          const parsed = JSON.parse(raw) as Dataset;
          if (!parsed || !Array.isArray(parsed.books) || !Array.isArray(parsed.sales))
            throw new Error("缺少 books/sales 字段");
          const ds: Dataset = {
            books: parsed.books,
            slots: parsed.slots ?? [],
            placements: parsed.placements ?? [],
            sales: parsed.sales,
            resolutions: parsed.resolutions ?? {},
          };
          for (const s of ds.sales) {
            if (!s.channel || typeof s.qty !== "number" || typeof s.price !== "number")
              throw new Error("销售流水字段不完整");
          }
          set({ ds, result: computeAll(ds), verify: null });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
      exportDataset: () => JSON.stringify(get().ds, null, 2),
      runVerify: () => {
        const full = computeAll(get().ds);
        const diffs = verifyConsistency(get().result, full);
        set({
          result: full,
          verify: { checkedAt: new Date().toISOString(), diffs },
        });
      },
    }),
    {
      name: "song-bookshop-v1",
      partialize: (s) => ({ ds: s.ds }),
      onRehydrateStorage: () => (state) => {
        if (state) state.result = computeAll(state.ds);
      },
    }
  )
);

export const channelColor: Record<Channel, string> = {
  店内零售: "#51a8b8",
  批发: "#db5a6b",
  预订: "#c8a951",
};
