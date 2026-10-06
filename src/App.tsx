import { AdjudicateStep } from "./components/AdjudicateStep.js";
import { ConclusionStep } from "./components/ConclusionStep.js";
import { ConfigStep } from "./components/ConfigStep.js";
import { EntryStep } from "./components/EntryStep.js";
import { InferenceStep } from "./components/InferenceStep.js";
import { useWorkshop } from "./store.js";

const STEPS = ["录入", "配置", "推演", "裁决", "查看结论"] as const;

export default function App() {
  const { wizardStep, setWizardStep, result } = useWorkshop();
  const conflicts = result.conflicts.length;
  return (
    <>
      <header className="topbar">
        <h1>古代玉器作坊</h1>
        <span className="sub">解玉砂配比 × 工序依赖 · 可复算推演链路</span>
      </header>
      <nav className="steps-nav">
        {STEPS.map((label, i) => (
          <button
            key={label}
            className={i === wizardStep ? "active" : ""}
            onClick={() => setWizardStep(i)}
          >
            {i + 1}. {label}
            {i === 3 && conflicts > 0 ? `（${conflicts}）` : ""}
          </button>
        ))}
      </nav>
      <main>
        {wizardStep === 0 && <EntryStep />}
        {wizardStep === 1 && <ConfigStep />}
        {wizardStep === 2 && <InferenceStep />}
        {wizardStep === 3 && <AdjudicateStep />}
        {wizardStep === 4 && <ConclusionStep />}
        <div className="btn-row" style={{ justifyContent: "space-between" }}>
          <button className="btn ghost" disabled={wizardStep === 0} onClick={() => setWizardStep(wizardStep - 1)}>
            ← 上一步
          </button>
          <button className="btn" disabled={wizardStep === STEPS.length - 1} onClick={() => setWizardStep(wizardStep + 1)}>
            下一步 →
          </button>
        </div>
      </main>
    </>
  );
}
