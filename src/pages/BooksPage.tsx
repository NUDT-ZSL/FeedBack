import { useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { CATEGORIES, type Book, type Category } from "@/engine/types";
import { fmtTime } from "@/engine/compute";
import { btnCls, btnDangerCls, Card, inputCls, Td, Th, fmtWen } from "@/components/ui";

const empty = {
  title: "",
  format: "",
  category: "经" as Category,
  costPrice: 0,
  listPrice: 0,
  initialStock: 0,
};

export default function BooksPage() {
  const { ds, result, addBook, updateBook, removeBook } = useStore();
  const [form, setForm] = useState<Omit<Book, "id"> & { id?: string }>(empty);

  const rows = useMemo(
    () =>
      ds.books.map((b) => ({ book: b, stat: result.bookStats[b.id] })).sort((a, b) =>
        a.book.id.localeCompare(b.book.id)
      ),
    [ds.books, result.bookStats]
  );

  const submit = () => {
    if (!form.title.trim()) return;
    if (form.id) {
      updateBook({ ...(form as Book) });
    } else {
      addBook({ ...form, title: form.title.trim() });
    }
    setForm(empty);
  };

  return (
    <div className="space-y-4">
      <Card title={form.id ? `编辑书籍：${form.title}` : "录入书籍"}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[#7a5c3e]">
            书名
            <input
              className={`${inputCls} ml-1 w-36`}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="text-xs text-[#7a5c3e]">
            版式
            <input
              className={`${inputCls} ml-1 w-28`}
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value })}
            />
          </label>
          <label className="text-xs text-[#7a5c3e]">
            类别
            <select
              className={`${inputCls} ml-1`}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[#7a5c3e]">
            进价
            <input
              type="number"
              className={`${inputCls} ml-1 w-24`}
              value={form.costPrice}
              onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
            />
          </label>
          <label className="text-xs text-[#7a5c3e]">
            售价
            <input
              type="number"
              className={`${inputCls} ml-1 w-24`}
              value={form.listPrice}
              onChange={(e) => setForm({ ...form, listPrice: Number(e.target.value) })}
            />
          </label>
          <label className="text-xs text-[#7a5c3e]">
            初始库存
            <input
              type="number"
              className={`${inputCls} ml-1 w-24`}
              value={form.initialStock}
              onChange={(e) => setForm({ ...form, initialStock: Number(e.target.value) })}
            />
          </label>
          <button className={btnCls} onClick={submit}>
            {form.id ? "保存修改" : "录入"}
          </button>
          {form.id && (
            <button className={btnCls} onClick={() => setForm(empty)}>
              取消
            </button>
          )}
        </div>
      </Card>

      <Card title={`书籍列表与库存（共 ${rows.length} 种）`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>书名</Th>
                <Th>版式</Th>
                <Th>类别</Th>
                <Th className="text-right">进价</Th>
                <Th className="text-right">售价</Th>
                <Th className="text-right">初始库存</Th>
                <Th className="text-right">当前库存</Th>
                <Th className="text-right">净销量</Th>
                <Th>售罄时点</Th>
                <Th className="text-right">营收</Th>
                <Th className="text-right">利润</Th>
                <Th>异常</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ book, stat }) => (
                <tr key={book.id} className={stat && stat.stock <= 0 ? "bg-[#f9e8e4]" : ""}>
                  <Td className="font-medium">{book.title}</Td>
                  <Td>{book.format}</Td>
                  <Td>{book.category}</Td>
                  <Td className="text-right">{fmtWen(book.costPrice)}</Td>
                  <Td className="text-right">{fmtWen(book.listPrice)}</Td>
                  <Td className="text-right">{book.initialStock}</Td>
                  <Td className="text-right font-semibold">{stat ? stat.stock : book.initialStock}</Td>
                  <Td className="text-right">{stat ? stat.soldQty : 0}</Td>
                  <Td>{stat && stat.soldOutAt ? fmtTime(stat.soldOutAt) : "未售罄"}</Td>
                  <Td className="text-right">{stat ? fmtWen(stat.revenue) : "—"}</Td>
                  <Td className="text-right">{stat ? fmtWen(stat.profit) : "—"}</Td>
                  <Td>
                    {stat && stat.anomalyCount > 0 ? (
                      <span className="rounded bg-[#d32f2f] px-1.5 py-0.5 text-xs text-white">
                        {stat.anomalyCount}
                      </span>
                    ) : (
                      <span className="text-xs text-[#9c8a68]">正常</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <button
                        className={btnDangerCls}
                        onClick={() => setForm({ ...book })}
                      >
                        编辑
                      </button>
                      <button
                        className={btnDangerCls}
                        onClick={() => {
                          if (confirm(`删除《${book.title}》？相关陈列与流水将一并删除。`))
                            removeBook(book.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <Td className="py-6 text-center text-[#9c8a68]">尚无书籍，请先录入</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
