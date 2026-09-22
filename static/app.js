let state = null;
let impact = null;
let failTaskId = null;

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!response.ok) {
    alert((data.issues || []).map(x => x.message).join("\n") || data.error || "操作失败");
    throw new Error(data.error || response.statusText);
  }
  return data;
}

async function refresh() {
  const response = await fetch("/api/state");
  state = await response.json();
  render();
}

function fmtMinute(value) {
  const day = Math.floor(value / 1440) + 1;
  const minute = value % 1440;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `D${day} ${hh}:${mm}`;
}

function render() {
  $("clock").textContent = `第 ${state.now} 分钟`;
  $("makespan").textContent = `基线总工期 ${fmtMinute(state.baseline_makespan)}`;
  $("toggleSim").textContent = state.sim_running ? "暂停时钟" : "继续时钟";
  renderMachines();
  renderMaterials();
  renderTasks();
  renderEvents();
  const badge = $("orderBadge");
  badge.textContent = state.order_matches_baseline ? "完成顺序与基线一致" : "尚有未完成/顺序待校验";
  badge.className = "badge " + (state.order_matches_baseline && state.remaining_tasks.length === 0 ? "ok" : "bad");
}

function renderMachines() {
  $("machines").innerHTML = state.machines.map(machine => `
    <div class="machine-card ${machine.paused ? "paused" : ""}">
      <h3><span>${esc(machine.name)}</span><span>${machine.paused ? "已暂停" : "可调度"}</span></h3>
      <div class="machine-meta">
        ${esc(machine.id)} · ${machine.windows.map(w => `${fmtMinute(w.start).slice(4)}-${fmtMinute(w.end).slice(4)}`).join("，")}
        <br>当前：${machine.current_task ? esc(machine.current_task) : "空闲"}
      </div>
      <button onclick="toggleMachine('${machine.id}', ${!machine.paused})">
        ${machine.paused ? "恢复" : "暂停"}
      </button>
    </div>`).join("");
}

function renderMaterials() {
  const current = $("materialSelect").value;
  $("materialSelect").innerHTML = state.materials.map(m =>
    `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.id)} ${esc(m.version)})</option>`).join("");
  if (current) $("materialSelect").value = current;
}

function renderTasks() {
  const labels = { waiting: "等待", running: "进行", blocked: "受阻", failed: "失败", completed: "完成" };
  $("tasks").innerHTML = state.tasks.map(task => `
    <tr>
      <td>${task.logical_index + 1}</td>
      <td><strong>${esc(task.name)}</strong><div class="dep">${esc(task.task_id)} · 重试 ${task.attempts}</div></td>
      <td>
        <span class="status ${task.status}">${labels[task.status]}</span>
        ${task.stale ? `<span class="stale-note ${task.stale_accepted ? "accepted" : ""}">
          ${task.stale_accepted ? "已接受旧结果" : "素材/上游结果过期"}<br>${esc((task.stale_reasons || []).join("；"))}
        </span>` : ""}
        ${task.blocked_by.length ? `<span class="dep">受阻于：${task.blocked_by.map(esc).join("，")}</span>` : ""}
        ${task.last_error ? `<span class="stale-note">${esc(task.last_error)}</span>` : ""}
      </td>
      <td>${esc(task.machine_id || "—")}</td>
      <td>${task.duration} 分</td>
      <td>${task.depends_on.length ? task.depends_on.map(esc).join("，") : "—"}</td>
      <td>${task.materials.map(esc).join("，") || "—"}<div class="dep">${Object.entries(task.material_versions).map(([k,v]) => `${esc(k)}:${esc(v)}`).join("，")}</div></td>
      <td>${esc(task.baseline_machine)}<div class="dep">${fmtMinute(task.baseline_start)} → ${fmtMinute(task.baseline_end)}</div></td>
      <td>${actions(task)}</td>
    </tr>`).join("");
}

function actions(task) {
  if (task.status === "running") return `<button onclick="askFail('${task.task_id}')">模拟失败</button>`;
  if (task.status === "failed") return `<button onclick="retryTask('${task.task_id}')">重试</button>`;
  if (task.stale && !task.stale_accepted) return `<button onclick="acceptStale(['${task.task_id}'])">接受旧结果</button>`;
  return "—";
}

function renderEvents() {
  $("events").innerHTML = state.events.map(event => `
    <div class="event ${event.level}"><strong>${fmtMinute(event.time)}</strong> ${esc(event.message)}</div>
  `).join("");
}

window.toggleMachine = async (id, paused) => {
  await api("/api/machines/pause", { machine_id: id, paused });
  refresh();
};

window.askFail = (id) => {
  failTaskId = id;
  $("dialogTask").textContent = `将进行中的 ${id} 标记为失败；只有依赖它的后续任务会受阻。`;
  $("taskDialog").showModal();
};

window.retryTask = async (id) => {
  await api("/api/tasks/retry", { task_id: id });
  refresh();
};

window.acceptStale = async (ids) => {
  await api("/api/stale/accept", { task_ids: ids });
  impact = null;
  refresh();
};

$("confirmFail").addEventListener("click", async (event) => {
  event.preventDefault();
  if (failTaskId) {
    await api("/api/tasks/fail", { task_id: failTaskId, reason: $("failureReason").value });
    failTaskId = null;
    $("taskDialog").close();
    refresh();
  }
});

$("toggleSim").onclick = async () => {
  const next = await api("/api/sim", { running: !state.sim_running });
  state = next;
  render();
};
$("tickOnce").onclick = async () => {
  const next = await api("/api/sim", { running: false, tick: true });
  state = next;
  render();
};
$("resetQueue").onclick = async () => {
  await api("/api/reset", {});
  impact = null;
  refresh();
};

$("analyze").onclick = async () => {
  impact = await api("/api/materials/impact", {
    material_id: $("materialSelect").value,
    new_version: $("newVersion").value || "new",
  });
  renderImpact();
};

function renderImpact() {
  if (!impact) return;
  const tasksById = Object.fromEntries(state.tasks.map(t => [t.task_id, t]));
  $("impact").innerHTML = `
    <strong>${esc(impact.material_id)}：${esc(impact.old_version)} → ${esc(impact.new_version)}</strong><br>
    直接取用：${impact.direct_consumers.map(esc).join("，")}<br>
    受影响闭包：${impact.affected_tasks.map(esc).join("，") || "无"}<br>
    <div>${impact.affected_tasks.map(id => `
      <label class="task-option">
        <input type="checkbox" name="rerunTask" value="${esc(id)}" checked>
        <span>${esc(id)} · ${esc(tasksById[id]?.name || "")} · ${esc(tasksById[id]?.status || "")}</span>
      </label>`).join("")}</div>
    <div class="muted">选择一个已产出任务时，系统会自动纳入它的全部下游，避免新旧结果混用。</div>`;
}

function selectedImpactTasks() {
  return [...document.querySelectorAll("input[name='rerunTask']:checked")].map(x => x.value);
}

$("confirmRerun").onclick = async () => {
  if (!impact) { alert("请先分析素材影响"); return; }
  const result = await api("/api/materials/replace", {
    material_id: impact.material_id,
    new_version: impact.new_version,
    rerun: true,
    selected_tasks: selectedImpactTasks(),
  });
  impact = result.impact;
  refresh();
};

$("confirmKeep").onclick = async () => {
  if (!impact) { alert("请先分析素材影响"); return; }
  const result = await api("/api/materials/replace", {
    material_id: impact.material_id,
    new_version: impact.new_version,
    rerun: false,
  });
  impact = result.impact;
  refresh();
};

$("acceptStale").onclick = () => window.acceptStale(null);

$("manifestFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text());
    const result = await api("/api/load", { manifest });
    state = result.state;
    impact = null;
    render();
  } catch (error) {
    console.error(error);
  }
});

refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 900);
