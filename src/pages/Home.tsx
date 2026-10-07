import { useMemo, useState } from "react";
import { LayoutEngine } from "@/layout/incremental.ts";
import { exportLayoutJson, renderSvg } from "@/layout/render.ts";
import type { Block, Constraint, UpdateResult } from "@/layout/types.ts";

const BLOCKS: Block[] = [
  { id: "A", width: 10, height: 10, rotatable: false, xRange: { min: 0, max: 10 }, yRange: { min: 0, max: 10 } },
  { id: "B", width: 10, height: 10, rotatable: false, xRange: { min: 5, max: 15 }, yRange: { min: 0, max: 10 } },
  { id: "C", width: 10, height: 10, rotatable: false, xRange: { min: 0, max: 20 }, yRange: { min: 0, max: 10 } },
  { id: "D", width: 8, height: 8, rotatable: true, xRange: { min: 0, max: 30 }, yRange: { min: 12, max: 30 } },
];

const CONSTRAINTS: Constraint[] = [
  { id: "m1", type: "mutex", a: "A", b: "C" },
  { id: "m2", type: "mutex", a: "B", b: "C" },
  { id: "adCD", type: "adjacent", a: "C", b: "D", axis: "y", gap: 2 },
];

export default function Home() {
  const [engine] = useState(() => new LayoutEngine({ blocks: BLOCKS, constraints: CONSTRAINTS }));
  const [result, setResult] = useState<UpdateResult>(() => engine.solve());
  const [log, setLog] = useState<string[]>(["initial full solve"]);

  const blocks = useMemo(() => engine.getBlocks(), [engine, result]);
  const constraints = useMemo(() => engine.getConstraints(), [engine, result]);

  const run = (label: string, apply: () => UpdateResult) => {
    const r = apply();
    setResult(r);
    setLog((prev) => [
      `${label}: scope=${r.scope} status=${r.status} affected=[${r.affectedBlockIds.join(",")}] consistent=${r.consistentWithFullSolve}`,
      ...prev,
    ].slice(0, 6));
  };

  const svg = renderSvg(blocks, constraints, result.placements);
  const json = exportLayoutJson(blocks, constraints, result.placements);

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-gray-200 p-8 font-mono">
      <h1 className="text-xl text-[#e94560] mb-4">Offline Layout Inference</h1>
      <div className="flex gap-6 flex-wrap">
        <div className="bg-[#0f3460] p-4 rounded">
          <div className="text-sm mb-2">
            status: <span className="text-[#e94560]">{result.status}</span> | scope: {result.scope}
          </div>
          <div
            className="bg-white rounded p-2"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <div className="flex gap-2 mt-3 flex-wrap">
            {result.conflicts.length > 0 &&
              result.conflicts.flatMap((cf) =>
                cf.blockers.map((bl) => (
                  <button
                    key={bl.constraintId}
                    className="px-2 py-1 bg-[#e94560] text-white rounded text-xs"
                    onClick={() =>
                      run(`waive mutex ${bl.constraintId}`, () =>
                        engine.update({ waiveMutex: [bl.constraintId] }),
                      )
                    }
                  >
                    waive {bl.constraintId} ({cf.blockId} vs {bl.other})
                  </button>
                )),
              )}
            <button
              className="px-2 py-1 bg-[#43a685] text-white rounded text-xs"
              onClick={() =>
                run("shrink A range", () =>
                  engine.update({ blocks: [{ id: "A", xRange: { min: 0, max: 8 } }] }),
                )
              }
            >
              edit block A
            </button>
            <button
              className="px-2 py-1 bg-[#4a90d9] text-white rounded text-xs"
              onClick={() => {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "layout.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              export json (offline)
            </button>
          </div>
        </div>
        <pre className="text-xs bg-[#0f3460] p-4 rounded max-h-96 overflow-auto flex-1 min-w-80">
          {log.join("\n")}
        </pre>
      </div>
    </div>
  );
}
