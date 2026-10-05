import { useRef, useState } from 'react';
import { Download, Upload, BookCopy, Eraser, ShieldCheck } from 'lucide-react';
import { useShopStore } from '@/store/useShopStore';

export default function DataPanel() {
  const exportData = useShopStore((s) => s.exportData);
  const importData = useShopStore((s) => s.importData);
  const loadSample = useShopStore((s) => s.loadSample);
  const clearAll = useShopStore((s) => s.clearAll);
  const verify = useShopStore((s) => s.verify);
  const recalculate = useShopStore((s) => s.recalculate);
  const lastVerify = useShopStore((s) => s.lastVerify);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>('');

  const doExport = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `书坊经营数据-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('已导出 JSON 文件。');
  };

  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importData(String(reader.result));
      setMessage(res.ok ? `导入成功：${file.name}` : `导入失败：${res.error}`);
    };
    reader.readAsText(file);
  };

  const btn =
    'flex items-center gap-2 rounded border border-[#5d4037] bg-[#fffdf5] px-4 py-2 text-sm font-bold text-[#3e2723] transition hover:bg-[#c8a951] active:scale-95';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 font-serif text-lg font-bold text-[#5d4037]">本地数据（离线可用）</h2>
        <div className="flex flex-wrap gap-3">
          <button className={btn} onClick={doExport}>
            <Download size={16} /> 导出 JSON
          </button>
          <button className={btn} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> 导入 JSON
          </button>
          <button className={btn} onClick={() => { loadSample(); setMessage('已载入样例数据。'); }}>
            <BookCopy size={16} /> 载入样例数据
          </button>
          <button
            className={btn}
            onClick={() => {
              if (window.confirm('确定清空全部书籍、流水、换位与裁决记录？')) {
                clearAll();
                setMessage('已清空全部数据。');
              }
            }}
          >
            <Eraser size={16} /> 清空数据
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) doImport(file);
            e.target.value = '';
          }}
        />
        {message && <p className="mt-3 text-sm text-[#6d5a40]">{message}</p>}
        <p className="mt-3 text-xs text-[#8d6e4a]">
          数据自动保存在浏览器 localStorage，并可导出为 JSON 文件备份或迁移；全程不访问任何外部接口。
        </p>
      </div>

      <div className="rounded-lg border border-[#8d6e4a] bg-[#fffdf5] p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-bold text-[#5d4037]">
          <ShieldCheck size={18} /> 推演一致性
        </h2>
        <p className="mb-3 text-sm text-[#6d5a40]">
          裁决归属后系统只对受影响的书与时段做增量重算；此处可校验当前结果与整体重算是否完全一致。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={btn}
            onClick={() => {
              const ok = verify();
              setMessage(ok ? '校验通过：与整体重算结果一致。' : '校验未通过：结果与整体重算不一致！');
            }}
          >
            <ShieldCheck size={16} /> 校验一致性
          </button>
          <button
            className={btn}
            onClick={() => {
              recalculate();
              setMessage('已执行整体重算。');
            }}
          >
            整体重算
          </button>
          {lastVerify && (
            <span
              className={`rounded px-2 py-1 text-sm ${
                lastVerify.ok ? 'bg-[#eef4e3] text-[#3e6b3e]' : 'bg-[#fbe4e6] text-[#a03040]'
              }`}
            >
              最近校验：{lastVerify.ok ? '一致' : '不一致'}（
              {new Date(lastVerify.at).toLocaleTimeString('zh-CN')}）
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
