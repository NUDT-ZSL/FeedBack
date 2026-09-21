import "./styles.css";
import * as THREE from "three";
import { SceneView } from "./sceneView.js";
import {
  INVALID_REASONS,
  createAnnotation,
  createPart,
  evaluateAnnotation,
  getPartById,
  getPartWorldMatrix,
  validateBoxAnchor,
  updateAnnotationOffset,
  updateAnnotationText,
  wouldCreatePartCycle,
} from "./core.js";

const state = {
  parts: [],
  annotations: [],
  selectedPartId: null,
  selectedAnnotationId: null,
  transformMode: "translate",
};

const els = {};
for (const id of [
  "viewport", "scene", "leaders", "labelLayer", "invalidLayer", "statusBar",
  "addPart", "importParts", "exportScene", "importFile", "annotateMode", "resetCamera",
  "partList", "partEditor", "annotationList", "annotationEditor",
]) {
  els[id] = document.getElementById(id);
}

const labelElements = new Map();
const lineElements = new Map();
const anchorElements = new Map();
const invalidElements = new Map();

const view = new SceneView({
  canvas: els.scene,
  viewport: els.viewport,
  onPickSurface: handlePickSurface,
  onSelectPart: handleSelectPart,
  onTransformPart: handleTransformPart,
});

loadInitialScene();
bindUi();
syncSceneData();
renderPanels();
requestAnimationFrame(frame);

function defaultScene() {
  const base = createPart({ name: "主梁", position: [0, 0.6, 0], size: [4.4, 0.55, 0.75], color: "#4f8dd6" });
  const bracket = createPart({
    name: "安装支架",
    parentId: base.id,
    position: [-1.25, 0.48, 0],
    rotationDeg: [0, 18, 0],
    size: [0.62, 0.95, 0.5],
    color: "#d48a3c",
  });
  const plate = createPart({ name: "端板", position: [2.15, 0.62, 0], rotationDeg: [0, -12, 0], size: [0.24, 1.1, 1.1], color: "#53b58b" });
  const parts = [base, bracket, plate];
  const annotations = [
    createAnnotation({ partId: base.id, anchor: [0.5, 0.5, 0.5], text: "主梁检测点\n表面防腐区域", offset: { x: 28, y: -30 } }),
    createAnnotation({ partId: bracket.id, anchor: [0.5, 0.24, 0], text: "支架铰接孔", offset: { x: 26, y: 18 } }),
    createAnnotation({ partId: plate.id, anchor: [0, 0.5, 0.12], text: "端板连接面", offset: { x: -128, y: -24 } }),
  ];
  return { parts, annotations };
}

function loadInitialScene() {
  try {
    const saved = localStorage.getItem("anchored-annotation-scene");
    if (saved) {
      const parsed = JSON.parse(saved);
      state.parts = parsed.parts?.map(createPart) ?? [];
      state.annotations = parsed.annotations ?? [];
    } else {
      Object.assign(state, defaultScene());
    }
  } catch (error) {
    console.warn("无法读取已保存场景，已载入示例。", error);
    Object.assign(state, defaultScene());
  }
}

function persistScene() {
  localStorage.setItem("anchored-annotation-scene", JSON.stringify({
    parts: state.parts,
    annotations: state.annotations,
  }));
}

function bindUi() {
  els.annotateMode.addEventListener("change", () => {
    view.setAnnotateMode(els.annotateMode.checked);
    handleSelectPart(null);
  });
  els.addPart.addEventListener("click", () => {
    const part = createPart({
      name: `部件 ${state.parts.length + 1}`,
      position: [(Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2],
      size: [0.8 + Math.random() * 0.7, 0.8 + Math.random() * 0.7, 0.8 + Math.random() * 0.7],
      color: ["#4f8dd6", "#d48a3c", "#53b58b", "#9b6de0"][state.parts.length % 4],
    });
    mutateScene((draft) => draft.parts.push(part));
    els.annotateMode.checked = false;
    view.setAnnotateMode(false);
    handleSelectPart(part.id);
  });
  els.resetCamera.addEventListener("click", () => view.resetCamera());
  els.importParts.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", handleImport);
  els.exportScene.addEventListener("click", handleExport);
  window.addEventListener("resize", () => view.resize());
}

function mutateScene(mutator, rebuildPanels = true) {
  const previousPartIds = new Set(state.parts.map((part) => part.id));
  const previousParents = new Map(state.parts.map((part) => [part.id, part.parentId]));
  const draft = {
    parts: state.parts.map((part) => ({ ...part, position: [...part.position], rotationDeg: [...part.rotationDeg], size: [...part.size] })),
    annotations: state.annotations.map((annotation) => ({ ...annotation, anchor: [...annotation.anchor], offset: { ...annotation.offset } })),
  };
  mutator(draft);
  state.parts = draft.parts;
  state.annotations = draft.annotations;
  syncSceneData(previousPartIds, previousParents);
  if (rebuildPanels) renderPanels();
  else renderPartList();
  persistScene();
}

function syncSceneData(previousPartIds = null, previousParents = null) {
  const structureChanged = !previousPartIds ||
    previousPartIds.size !== state.parts.length ||
    state.parts.some((part) => !previousPartIds.has(part.id) || previousParents.get(part.id) !== part.parentId);
  if (structureChanged) view.setParts(state.parts);
  else view.syncTransforms(state.parts);
  view.setAnnotateMode(els.annotateMode.checked);
  if (!els.annotateMode.checked && state.selectedPartId) view.selectPart(state.selectedPartId, state.transformMode);
}

function handlePickSurface(partId, localAnchor) {
  const part = getPartById(state.parts, partId);
  const rounded = localAnchor.map((value) => Number(value.toFixed(5)));
  const annotation = createAnnotation({
    partId,
    anchor: rounded,
    text: `${part?.name ?? "部件"}标注 ${state.annotations.length + 1}`,
  });
  mutateScene((draft) => draft.annotations.push(annotation));
  state.selectedAnnotationId = annotation.id;
  renderPanels();
}

function handleSelectPart(partId) {
  state.selectedPartId = partId;
  if (!partId) view.detachTransform();
  else if (!els.annotateMode.checked) view.selectPart(partId, state.transformMode);
  renderPanels();
}

function handleTransformPart(partId, transform) {
  const part = getPartById(state.parts, partId);
  if (!part) return;
  part.position = transform.position.map(Number);
  part.rotationDeg = transform.rotationDeg.map(Number);
  part.size = (transform.size ?? part.size).map(Number);
  renderPartEditorValues();
  persistScene();
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const sourceParts = Array.isArray(parsed) ? parsed : parsed.parts;
      const sourceAnnotations = Array.isArray(parsed) ? [] : parsed.annotations;
      if (!Array.isArray(sourceParts) || !Array.isArray(sourceAnnotations)) {
        throw new Error("JSON 必须包含 parts 与 annotations 数组");
      }
      const parts = sourceParts.map(createPart);
      const partIds = new Set(parts.map((part) => part.id));
      const annotations = sourceAnnotations.map((annotation) => {
        const created = createAnnotation({
          partId: annotation.partId,
          anchor: vectorInput(annotation.anchor),
          text: annotation.text,
          offset: annotation.offset,
        });
        return {
          ...annotation,
          id: annotation.id ?? created.id,
          createdAt: annotation.createdAt ?? created.createdAt,
          partId: annotation.partId,
          anchor: created.anchor,
          text: created.text,
          offset: created.offset,
        };
      });
      mutateScene((draft) => {
        draft.parts = parts;
        draft.annotations = annotations;
      });
      state.selectedPartId = null;
      state.selectedAnnotationId = null;
      renderPanels();
      setStatus(`已导入 ${parts.length} 个部件、${annotations.length} 条标注；失效标注会保留显示。`);
    } catch (error) {
      setStatus(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function handleExport() {
  const data = JSON.stringify({ parts: state.parts, annotations: state.annotations }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "anchored-annotation-scene.json";
  link.click();
  URL.revokeObjectURL(url);
}

function deletePart(partId) {
  mutateScene((draft) => {
    draft.parts = draft.parts.filter((part) => part.id !== partId);
    for (const part of draft.parts) {
      if (part.parentId === partId) part.parentId = null;
    }
  });
  handleSelectPart(null);
}

function deleteAnnotation(annotationId) {
  mutateScene((draft) => {
    draft.annotations = draft.annotations.filter((annotation) => annotation.id !== annotationId);
  });
  if (state.selectedAnnotationId === annotationId) state.selectedAnnotationId = null;
  renderPanels();
}

function setStatus(message) {
  els.statusBar.textContent = message;
}

function vectorInput(value, fallback = [0.5, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const result = value.map(Number);
  return result.every(Number.isFinite) ? result : fallback;
}

function getAnnotationInvalidReason(annotation) {
  const part = getPartById(state.parts, annotation.partId);
  if (!part) return "missing-part";
  if (!Array.isArray(annotation.anchor) || annotation.anchor.length !== 3) return "out-of-bounds";
  const sizeError = validateBoxAnchor(part.size, annotation.anchor);
  if (sizeError && sizeError !== null) return sizeError;
  const chain = getPartWorldMatrix(state.parts, part.id);
  return chain.error;
}

function renderPartEditorValues() {
  const part = getPartById(state.parts, state.selectedPartId);
  if (!part || els.partEditor.hidden) return;
  for (const key of ["x", "y", "z", "rx", "ry", "rz", "sx", "sy", "sz"]) {
    const source = key.startsWith("r") ? part.rotationDeg : key.startsWith("s") ? part.size : part.position;
    const index = ["x", "rx", "sx"].includes(key) ? 0 : ["y", "ry", "sy"].includes(key) ? 1 : 2;
    const input = els.partEditor.querySelector(`[data-field="${key}"]`);
    if (input && document.activeElement !== input) input.value = Number(source[index].toFixed(4));
  }
}

function renderPanels() {
  renderPartList();
  renderPartEditor();
  renderAnnotationList();
  renderAnnotationEditor();
}

function renderPartList() {
  els.partList.innerHTML = "";
  for (const part of state.parts) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = annotation.id;
    button.className = `item${state.selectedPartId === part.id ? " selected" : ""}`;
    const count = state.annotations.filter((annotation) => annotation.partId === part.id).length;
    button.innerHTML = `<span class="item-main"><span class="item-name"></span><span class="item-sub"></span></span><span class="badge"></span>`;
    button.querySelector(".item-name").textContent = part.name;
    button.querySelector(".item-sub").textContent = `位置 ${fmtVec(part.position)} · 尺寸 ${fmtVec(part.size)}`;
    button.querySelector(".badge").textContent = `${count} 标注`;
    button.addEventListener("click", () => {
      els.annotateMode.checked = false;
      view.setAnnotateMode(false);
      handleSelectPart(part.id);
    });
    els.partList.append(button);
  }
}

function renderPartEditor() {
  const part = getPartById(state.parts, state.selectedPartId);
  els.partEditor.hidden = !part;
  if (!part) return;
  els.partEditor.innerHTML = `
    <label class="wide">名称<input data-field="name" value="${escapeAttribute(part.name)}"></label>
    <label>X 位置<input data-field="x" type="number" step="0.1"></label>
    <label>Y 位置<input data-field="y" type="number" step="0.1"></label>
    <label>Z 位置<input data-field="z" type="number" step="0.1"></label>
    <label>X 旋转°<input data-field="rx" type="number" step="5"></label>
    <label>Y 旋转°<input data-field="ry" type="number" step="5"></label>
    <label>Z 旋转°<input data-field="rz" type="number" step="5"></label>
    <label>宽 X<input data-field="sx" type="number" min="0.01" step="0.1"></label>
    <label>高 Y<input data-field="sy" type="number" min="0.01" step="0.1"></label>
    <label>深 Z<input data-field="sz" type="number" min="0.01" step="0.1"></label>
    <label class="wide">父级
      <select data-field="parentId">
        <option value="">场景根级</option>
        ${state.parts.filter((candidate) => !wouldCreatePartCycle(state.parts, part.id, candidate.id)).map((candidate) =>
          `<option value="${candidate.id}" ${candidate.id === part.parentId ? "selected" : ""}>${escapeHtml(candidate.name)}</option>`).join("")}
      </select>
    </label>
    <label class="wide">颜色<input data-field="color" type="color" value="${part.color}"></label>
    <div class="editor-actions">
      <button type="button" data-action="translate">移动</button>
      <button type="button" data-action="rotate">旋转</button>
      <button type="button" data-action="scale">缩放</button>
      <button type="button" class="danger" data-action="delete">删除部件</button>
    </div>`;
  renderPartEditorValues();
  els.partEditor.querySelectorAll("input,select").forEach((input) => {
    input.addEventListener("input", () => updatePartFromEditor(part.id));
    input.addEventListener("change", () => updatePartFromEditor(part.id));
  });
  els.partEditor.querySelector('[data-action="translate"]').addEventListener("click", () => {
    state.transformMode = "translate";
    view.setTransformMode("translate");
  });
  els.partEditor.querySelector('[data-action="rotate"]').addEventListener("click", () => {
    state.transformMode = "rotate";
    view.setTransformMode("rotate");
  });
  els.partEditor.querySelector('[data-action="scale"]').addEventListener("click", () => {
    state.transformMode = "scale";
    view.setTransformMode("scale");
  });
  els.partEditor.querySelector('[data-action="delete"]').addEventListener("click", () => deletePart(part.id));
}

function updatePartFromEditor(partId) {
  const editor = els.partEditor;
  const read = (field) => Number(editor.querySelector(`[data-field="${field}"]`).value);
  mutateScene((draft) => {
    const part = getPartById(draft.parts, partId);
    if (!part) return;
    part.name = editor.querySelector('[data-field="name"]').value;
    part.position = [read("x"), read("y"), read("z")];
    part.rotationDeg = [read("rx"), read("ry"), read("rz")];
    part.size = [Math.max(0.01, read("sx")), Math.max(0.01, read("sy")), Math.max(0.01, read("sz"))];
    part.color = editor.querySelector('[data-field="color"]').value;
    part.parentId = editor.querySelector('[data-field="parentId"]').value || null;
  }, false);
  state.selectedPartId = partId;
  view.selectPart(partId, state.transformMode);
}

function renderAnnotationList() {
  els.annotationList.innerHTML = "";
  for (const annotation of state.annotations) {
    const part = getPartById(state.parts, annotation.partId);
    const reason = getAnnotationInvalidReason(annotation);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item${state.selectedAnnotationId === annotation.id ? " selected" : ""}${reason ? " invalid" : ""}`;
    button.innerHTML = `<span class="item-main"><span class="item-name"></span><span class="item-sub"></span></span><span class="badge ${reason ? "bad" : ""}"></span>`;
    button.querySelector(".item-name").textContent = annotation.text.split("\n")[0] || "空白标注";
    button.querySelector(".item-sub").textContent = reason
      ? INVALID_REASONS[reason]
      : `${part.name} · 局部锚点 ${fmtVec(annotation.anchor)}`;
    button.querySelector(".badge").textContent = reason ? "失效" : "有效";
    button.addEventListener("click", () => {
      state.selectedAnnotationId = annotation.id;
      renderAnnotationEditor();
      renderAnnotationList();
    });
    els.annotationList.append(button);
  }
}

function renderAnnotationEditor() {
  const annotation = state.annotations.find((item) => item.id === state.selectedAnnotationId);
  els.annotationEditor.hidden = !annotation;
  if (!annotation) return;
  const part = getPartById(state.parts, annotation.partId);
  els.annotationEditor.innerHTML = `
    <label class="wide">文字<textarea data-field="text"></textarea></label>
    <label>X 微调（像素）<input data-field="offsetX" type="number" step="1"></label>
    <label>Y 微调（像素）<input data-field="offsetY" type="number" step="1"></label>
    <label class="wide">局部锚点 X<input data-field="anchorX" type="number" step="0.01" ${part ? "" : "disabled"}></label>
    <label>局部锚点 Y<input data-field="anchorY" type="number" step="0.01" ${part ? "" : "disabled"}></label>
    <label>局部锚点 Z<input data-field="anchorZ" type="number" step="0.01" ${part ? "" : "disabled"}></label>
    <div class="wide hint">锚点始终存储在部件局部坐标系；旋转、缩放或移动部件后会沿变换链重新投影。</div>
    <div class="editor-actions">
      <button type="button" class="danger" data-action="delete">删除标注</button>
    </div>`;
  const text = els.annotationEditor.querySelector('[data-field="text"]');
  text.value = annotation.text;
  els.annotationEditor.querySelector('[data-field="offsetX"]').value = annotation.offset.x;
  els.annotationEditor.querySelector('[data-field="offsetY"]').value = annotation.offset.y;
  els.annotationEditor.querySelector('[data-field="anchorX"]').value = annotation.anchor[0];
  els.annotationEditor.querySelector('[data-field="anchorY"]').value = annotation.anchor[1];
  els.annotationEditor.querySelector('[data-field="anchorZ"]').value = annotation.anchor[2];
  text.addEventListener("input", () => {
    state.annotations = state.annotations.map((item) =>
      item.id === annotation.id ? updateAnnotationText(item, text.value) : item);
    const item = els.annotationList.querySelector(`[data-id="${CSS.escape(annotation.id)}"]`);
    if (item) item.querySelector(".item-name").textContent = text.value.split("\n")[0] || "空白标注";
    persistScene();
  });
  ["offsetX", "offsetY"].forEach((field, index) => {
    els.annotationEditor.querySelector(`[data-field="${field}"]`).addEventListener("input", (event) => {
      const current = state.annotations.find((item) => item.id === annotation.id);
      const x = field === "offsetX" ? Number(event.target.value) : current.offset.x;
      const y = field === "offsetY" ? Number(event.target.value) : current.offset.y;
      state.annotations = state.annotations.map((item) =>
        item.id === annotation.id ? updateAnnotationOffset(item, x, y) : item);
      persistScene();
    });
  });
  ["anchorX", "anchorY", "anchorZ"].forEach((field, index) => {
    els.annotationEditor.querySelector(`[data-field="${field}"]`).addEventListener("change", (event) => {
      const current = state.annotations.find((item) => item.id === annotation.id);
      const anchor = [...current.anchor];
      anchor[index] = Number(event.target.value);
      mutateScene((draft) => {
        const target = draft.annotations.find((item) => item.id === annotation.id);
        if (target) target.anchor = anchor;
      });
      state.selectedAnnotationId = annotation.id;
    });
  });
  els.annotationEditor.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAnnotation(annotation.id));
}

function frame() {
  const viewport = view.update();
  renderAnnotationOverlays(viewport);
  requestAnimationFrame(frame);
}

function renderAnnotationOverlays(viewport) {
  const matrixCache = new Map();
  const activeIds = new Set();
  const invalidToasts = new Set();
  let invalidCount = 0;

  for (const annotation of state.annotations) {
    activeIds.add(annotation.id);
    const result = evaluateAnnotation(annotation, state.parts, view.camera, viewport, matrixCache);
    if (result.reason) invalidCount += 1;

    if (["missing-part", "missing-parent", "cycle", "bad-size"].includes(result.reason)) {
      showInvalidToast(annotation, result.reason);
      invalidToasts.add(annotation.id);
      hideProjection(annotation.id);
      continue;
    }

    const projection = result.screenAnchor;
    if (!projection || projection.behindCamera || !projection.visible) {
      hideProjection(annotation.id);
      continue;
    }

    result.occluded = result.valid && view.isAnchorOccluded(result.worldAnchor, annotation.partId);
    const label = ensureLabel(annotation);
    const line = ensureLine(annotation);
    const anchor = ensureAnchorMarker(annotation);
    const labelWidth = label.offsetWidth || 90;
    const labelHeight = label.offsetHeight || 34;
    const labelX = projection.x + annotation.offset.x;
    const labelY = projection.y + annotation.offset.y;
    const endX = THREE.MathUtils.clamp(labelX + labelWidth / 2, projection.x, projection.x + (annotation.offset.x >= 0 ? -2 : 2));
    const endY = THREE.MathUtils.clamp(labelY + labelHeight / 2, projection.y, projection.y + (annotation.offset.y >= 0 ? -2 : 2));

    label.querySelector(".text").textContent = annotation.text || "空白标注";
    label.querySelector(".chip").textContent = result.reason
      ? `失效：${INVALID_REASONS[result.reason]}`
      : `${result.part.name} · (${annotation.anchor.map((value) => value.toFixed(2)).join(", ")})`;
    label.className = [
      "annotation-label",
      state.selectedAnnotationId === annotation.id ? "selected" : "",
      result.occluded ? "occluded" : "",
      result.reason ? "invalid" : "",
      result.valid && !result.facingCamera ? "behind" : "",
    ].join(" ").trim();
    label.style.transform = `translate3d(${labelX - labelWidth / 2}px, ${labelY - labelHeight / 2}px, 0)`;

    line.setAttribute("x1", projection.x);
    line.setAttribute("y1", projection.y);
    line.setAttribute("x2", endX);
    line.setAttribute("y2", endY);
    line.style.display = "block";
    line.style.stroke = result.reason ? "#ff6274" : result.occluded ? "#8ea0b8" : "#6fb0ff";
    line.style.strokeDasharray = result.reason || result.occluded ? "4 3" : "";
    line.setAttribute("marker-end", result.reason ? "" : "url(#arrow)");

    anchor.setAttribute("cx", projection.x);
    anchor.setAttribute("cy", projection.y);
    anchor.setAttribute("r", result.reason ? 6 : 4.5);
    anchor.style.display = "block";
    anchor.style.fill = result.reason ? "#ff6274" : "#ffd166";
    anchor.style.stroke = result.reason ? "#ffd7dc" : "#172033";
  }

  for (const id of [...labelElements.keys()]) if (!activeIds.has(id) || invalidToasts.has(id)) hideProjection(id);
  for (const id of [...invalidElements.keys()]) {
    if (!activeIds.has(id) || !invalidToasts.has(id)) {
      invalidElements.get(id)?.remove();
      invalidElements.delete(id);
    }
  }
  updateStatusCount(invalidCount);
}

function ensureLabel(annotation) {
  let label = labelElements.get(annotation.id);
  if (!label) {
    label = document.createElement("div");
    label.innerHTML = `<span class="text"></span><span class="anchor-chip chip"></span>`;
    label.addEventListener("pointerdown", (event) => event.stopPropagation());
    label.addEventListener("click", () => {
      state.selectedAnnotationId = annotation.id;
      renderAnnotationList();
      renderAnnotationEditor();
    });
    els.labelLayer.append(label);
    labelElements.set(annotation.id, label);
  }
  return label;
}

function ensureLine(annotation) {
  let line = lineElements.get(annotation.id);
  if (!line) {
    line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    els.leaders.append(line);
    lineElements.set(annotation.id, line);
  }
  return line;
}

function ensureAnchorMarker(annotation) {
  let marker = anchorElements.get(annotation.id);
  if (!marker) {
    marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    els.leaders.append(marker);
    anchorElements.set(annotation.id, marker);
  }
  return marker;
}

function showInvalidToast(annotation, reason) {
  let toast = invalidElements.get(annotation.id);
  if (!toast) {
    toast = document.createElement("button");
    toast.type = "button";
    toast.className = "invalid-toast";
    toast.innerHTML = `<span class="warning-dot"></span><span class="toast-text"></span>`;
    toast.addEventListener("click", () => {
      state.selectedAnnotationId = annotation.id;
      renderAnnotationList();
      renderAnnotationEditor();
    });
    els.invalidLayer.append(toast);
    invalidElements.set(annotation.id, toast);
  }
  toast.querySelector(".toast-text").textContent =
    `标注“${annotation.text.split("\n")[0] || "空白"}”失效：${INVALID_REASONS[reason]}`;
}

function hideProjection(id) {
  labelElements.get(id)?.style.setProperty("display", "none");
  lineElements.get(id)?.style.setProperty("display", "none");
  anchorElements.get(id)?.style.setProperty("display", "none");
}

let lastStatus = "";
function updateStatusCount(invalidCount) {
  const message = invalidCount
    ? `${invalidCount} 条标注失效：删除部件、锚点越界或离开表面时不会被静默丢弃。`
    : `${state.annotations.length} 条标注均沿当前部件变换链锚定。`;
  if (message !== lastStatus) {
    els.statusBar.textContent = message;
    lastStatus = message;
  }
}

function fmtVec(values) {
  return `(${values.map((value) => Number(value).toFixed(2)).join(", ")})`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
