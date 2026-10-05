import { useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { btnCls, Card } from "@/components/ui";

export default function DataPage() {
  const { ds, result, verify, exportDataset, importDataset, loadSample, clearAll, runVerify } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doExport = () => {
    const blob = new Blob([exportDataset()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `song-bookshop-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImportFile = async (file: File) => {
    const raw = await file.text();
    const r = importDataset(raw);
    setMsg(r.ok ? { ok: true, text: "导入成功，已重新推演。" } : { ok: false, text: `导入失败：${r.error}` });
  };

  return (
    <div className="space-y-4">
      <Card title="本地导入 / 导出（全部数据存于浏览器本地，离线可跑）">
        <div className="flex flex-wrap gap-2">
          <button className={btnCls} onClick={doExport}>导出 JSON</button>
          <button className={btnCls} onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImportFile(f);
              e.target.value = "";
            }}
          />
          <button
            className={btnCls}
            onClick={() => {
              if (confirm("载入内置样例将覆盖当前数据，继续？")) loadSample();
            }}
          >
            载入样例数据
          </button>
          <button
            className={btnCls}
            onClick={() => {
              if (confirm("清空全部书籍、陈列与流水？")) clearAll();
            }}
          >
            清空数据
          </button>
        </div>
        {msg && (
          <p className={`mt-2 text-sm ${msg.ok ? "text-[#6b8e23]" : "text-[#a94442]"}`}>{msg.text}</p>
        )}
      </Card>

      <Card title="推演一致性校验（局部重算 vs 整体重算）">
        <p className="mb-2 text-sm text-[#7a5c3e]">
          每次裁决只重算受影响的书与时段。点击按钮以整体重算结果逐项核对，结果应完全一致。
        </p>
        <div className="flex items-center gap-3">
          <button
            className={btnCls}
            onClick={() => {
              runVerify();
            }}
          >
            运行校验
          </button>
          {verify && (
            <span className={`text-sm ${verify.diffs.length === 0 ? "text-[#6b8e23]" : "text-[#a94442]"}`}>
              {verify.diffs.length === 0
                ? `✓ 一致（${new Date(verify.checkedAt).toLocaleTimeString("zh-CN")}）`
                : `✗ ${verify.diffs.join("、")}`}
            </span>
          )}
        </div>
      </Card>

      <Card title="当前数据快照（可直接复制备份或粘贴回导入）">
        <textarea
          readOnly
          className="h-64 w-full rounded border border-[#c9b48a] bg-[#fffdf5] p-2 font-mono text-xs"
          value={JSON.stringify(ds, null, 2)}
          onFocus={(e) => e.target.select()}
        />
      </Card>
    </div>
  );
}
