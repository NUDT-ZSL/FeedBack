/* 运维日志链可信性核查 - 前端逻辑 */
(function () {
  var state = null;
  var selectedSeq = null;

  var STATUS_TEXT = { ok: "通过", mismatch: "不一致", suspicious: "可疑", affected: "受影响" };
  var VERDICT_TEXT = {
    confirmed_tampered: "确认被篡改", accepted: "接受现状",
    false_alarm: "误报", pending: "待调查"
  };

  function $(id) { return document.getElementById(id); }

  function api(path, payload) {
    if (payload === undefined) {
      return fetch(path).then(function (r) { return r.json(); });
    }
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function shortHash(h) {
    if (!h) return "(缺失)";
    return h.length > 16 ? h.slice(0, 12) + "…" : h;
  }

  function renderSummary(report) {
    $("summary").classList.remove("hidden");
    $("sum-total").textContent = "共 " + report.total + " 条";
    $("sum-ok").textContent = "通过 " + report.counts.ok;
    $("sum-mismatch").textContent = "不一致 " + report.counts.mismatch;
    $("sum-suspicious").textContent = "可疑 " + report.counts.suspicious;
    $("sum-affected").textContent = "受影响 " + report.counts.affected;
    if (report.first_bad_seq !== null) {
      var r = report.affected_range;
      $("sum-range").textContent = "首个断点 seq=" + report.first_bad_seq +
        "，影响范围 seq " + r.from_seq + " ~ " + r.to_seq + "（" + r.count + " 条）";
      $("btn-first-bad").disabled = false;
    } else {
      $("sum-range").textContent = "链条完整，未发现断点";
      $("btn-first-bad").disabled = true;
    }
    var incr = "本次重算 " + report.recomputed + " 条";
    if (report.reused) incr += "，复用 " + report.reused + " 条结论";
    if (report.matches_full === true) incr += "；与全量校验一致 ✓";
    if (report.matches_full === false) incr += "；与全量校验不一致 ✗";
    $("sum-incr").textContent = incr;
  }

  function renderTable(report) {
    var tbody = $("chain-body");
    tbody.innerHTML = "";
    var onlyBad = $("filter-bad").checked;
    report.results.forEach(function (res) {
      if (onlyBad && res.status === "ok") return;
      var tr = document.createElement("tr");
      tr.className = "st-" + res.status;
      tr.dataset.seq = res.seq;
      if (res.seq === selectedSeq) tr.classList.add("selected");
      var adj = res.adjudication ? VERDICT_TEXT[res.adjudication.verdict] : "";
      if (res.adjudication_stale) adj += "（依据已变化）";
      tr.innerHTML =
        "<td>" + (res.seq === null ? "?" : res.seq) + "</td>" +
        "<td>" + (res.time || "") + "</td>" +
        "<td>" + (res.source || "") + "</td>" +
        '<td class="body"></td>' +
        "<td>" + (res.prev_seq !== null && res.prev_seq !== undefined ? res.prev_seq : "—") + "</td>" +
        '<td class="hash">' + shortHash(res.actual_checksum) + "</td>" +
        '<td class="status">' + STATUS_TEXT[res.status] + "</td>" +
        "<td>" + adj + "</td>";
      tr.children[3].textContent = res.body || "(无法解析)";
      tr.onclick = function () { selectRecord(res.seq); };
      tbody.appendChild(tr);
    });
    $("chain-table").classList.remove("hidden");
  }

  function render(report) {
    renderSummary(report);
    renderTable(report);
  }

  function loadState(s) {
    if (s.error) { alert(s.error); return; }
    state = s;
    if (s.loaded) render(s.report);
  }

  function selectRecord(seq) {
    selectedSeq = seq;
    api("/api/record?seq=" + seq).then(function (d) {
      if (d.error) { alert(d.error); return; }
      showDetail(d);
      renderTable(state.report);
    });
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showDetail(d) {
    $("detail").classList.remove("hidden");
    var res = d.result;
    $("detail-title").textContent = "记录 seq=" + d.record.seq +
      "（第 " + (res.index + 1) + " 行）";
    var st = $("detail-status");
    st.textContent = STATUS_TEXT[res.status];
    st.className = "badge st-" + res.status;
    $("detail-raw").textContent = JSON.stringify(d.record.raw || d.record, null, 2);
    $("detail-expected").textContent = res.expected_checksum || "(无法计算)";
    $("detail-expected").className =
      res.expected_checksum && res.expected_checksum !== res.actual_checksum ? "bad" : "good";
    $("detail-actual").textContent = res.actual_checksum || "(缺失)";
    $("detail-actual").className =
      res.expected_checksum && res.expected_checksum !== res.actual_checksum ? "bad" : "";
    var ul = $("detail-reasons");
    ul.innerHTML = "";
    (res.reasons.length ? res.reasons : ["未发现异常"]).forEach(function (r) {
      var li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
    $("detail-impact").textContent = d.impact;
    var adj = d.adjudication;
    $("adj-current").textContent = adj
      ? "当前裁决：" + VERDICT_TEXT[adj.verdict] + "（" + adj.updated_at + "）" +
        (adj.note ? " 备注：" + adj.note : "")
      : "尚未裁决";
    if (adj) {
      $("adj-verdict").value = adj.verdict;
      $("adj-note").value = adj.note || "";
    }
    $("edit-body").value = d.record.body || "";
    $("edit-seq").value = d.record.seq === null ? "" : d.record.seq;
    $("edit-checksum").value = "";
    $("edit-recompute").checked = false;
    $("edit-recompute-chain").checked = false;
    $("edit-result").textContent = "";
  }

  // ---- 事件 ----
  $("btn-sample").onclick = function () {
    api("/api/sample", {}).then(loadState);
  };
  $("btn-load").onclick = function () {
    var path = $("load-path").value.trim();
    if (!path) { alert("请输入文件路径"); return; }
    api("/api/load", { path: path }).then(loadState);
  };
  $("btn-verify").onclick = function () {
    api("/api/verify/full", {}).then(loadState);
  };
  $("btn-first-bad").onclick = function () {
    var seq = state.report.first_bad_seq;
    if (seq === null || seq === undefined) return;
    selectRecord(seq);
    var row = document.querySelector('tr[data-seq="' + seq + '"]');
    if (row) row.scrollIntoView({ block: "center" });
  };
  $("filter-bad").onchange = function () {
    if (state && state.report) renderTable(state.report);
  };
  $("detail-close").onclick = function () {
    $("detail").classList.add("hidden");
    selectedSeq = null;
    if (state && state.report) renderTable(state.report);
  };
  $("adj-save").onclick = function () {
    if (selectedSeq === null) return;
    api("/api/adjudicate", {
      seq: selectedSeq,
      verdict: $("adj-verdict").value,
      note: $("adj-note").value
    }).then(function (resp) {
      if (resp.error) { alert(resp.error); return; }
      loadState(resp.state);
      selectRecord(selectedSeq);
    });
  };
  $("edit-save").onclick = function () {
    if (selectedSeq === null) return;
    var payload = { seq: selectedSeq };
    var body = $("edit-body").value;
    var newSeq = $("edit-seq").value;
    var checksum = $("edit-checksum").value.trim();
    if (body !== "") payload.body = body;
    if (newSeq !== "" && Number(newSeq) !== selectedSeq) {
      payload.new_seq = Number(newSeq);
    }
    if (checksum !== "") payload.checksum = checksum;
    payload.recompute = $("edit-recompute").checked;
    payload.recompute_chain = $("edit-recompute-chain").checked;
    api("/api/record/update", payload).then(function (report) {
      if (report.error) { alert(report.error); return; }
      state.report = report;
      render(report);
      var info = "增量重算 " + report.recomputed + " 条，复用 " +
        (report.reused || 0) + " 条；与全量校验" +
        (report.matches_full ? "一致 ✓" : "不一致 ✗");
      $("edit-result").textContent = info;
      if (payload.new_seq !== undefined) selectedSeq = payload.new_seq;
      selectRecord(selectedSeq);
    });
  };

  // 初始状态
  api("/api/state").then(loadState);
})();
