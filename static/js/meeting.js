// meeting.js
// UI + layout + minimal plumbing. No networking here.
// RTC code plugs in via window.RTC_BRIDGE and window.ChatSendAdapter.
console.log('------------------------ meeting.js (fixed version) ---------------------------');

// ---------- Config / State ----------
const State = {
  HostName: localStorage.getItem("connectly.name") || (window.CONNECTLY && window.CONNECTLY.host_name) || "Host",
  tilesPerPage: 1,
  participants: [],
  chat: [],
  idleTimer: null,
  ctrlVisible: true,
  currentLayout: Number(localStorage.getItem("meeting.layout") || 1),
};

// ---------- RTC Bridge ----------
window.RTC_BRIDGE = {
  upsertParticipant(p) {
    const i = State.participants.findIndex((x) => x.id === p.id);
    if (i >= 0) State.participants[i] = { ...State.participants[i], ...p };
    else State.participants.push(p);
    renderAll();
    refreshParticipantsOffcanvas();
  },
  removeParticipant(id) {
    State.participants = State.participants.filter((x) => x.id !== id);
    renderAll();
    refreshParticipantsOffcanvas();
  },
  attachStreamTo(id, stream) {
    const tile = document.querySelector(`.tile[data-pid="${id}"]`);
    const mount = tile && tile.querySelector(".media-slot");
    if (!mount) return;

    let video = mount.querySelector("video");
    if (!video) {
      video = document.createElement("video");
      video.setAttribute("playsinline", "true");
      video.setAttribute("autoplay", "true");
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = "contain";
      video.style.background = "transparent";

      const isSelf = !!State.participants.find(p => p.id === id && p.self);
      if (isSelf) video.muted = true;

      mount.appendChild(video);
    }
    video.srcObject = stream;

    const ensurePlay = () => { try { video.play(); } catch (_) {} };
    (video.readyState >= 2) ? ensurePlay() : video.onloadedmetadata = ensurePlay;

    const isSelf = !!State.participants.find(p => p.id === id && p.self);
    if (!isSelf) {
      let audio = mount.querySelector("audio");
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        mount.appendChild(audio);
      }
      audio.srcObject = stream;
    }

    const vtrack = stream.getVideoTracks()[0];
    const updateCamClass = () => {
      if (!tile) return;
      const on = vtrack && vtrack.enabled && stream.getVideoTracks().length > 0;
      tile.classList.toggle("cam-on", !!on);
    };
    updateCamClass();
    if (vtrack) {
      vtrack.onmute = updateCamClass;
      vtrack.onunmute = updateCamClass;
      vtrack.onended = updateCamClass;
      vtrack.addEventListener("ended", updateCamClass);
    }
  },

  // simplified: do NOT re-render on toggles
  setSelfDeviceFlags({ camOn, micOn }) {
    const self = State.participants.find((p) => p.self);
    if (self) {
      if (typeof camOn === "boolean") {
        self.cam = camOn ? "on" : "off";
        const tile = document.querySelector(`.tile[data-pid="${self.id || 'self'}"]`);
        if (tile) tile.classList.toggle("cam-on", camOn);
      }
      if (typeof micOn === "boolean") {
        self.mic = micOn ? "on" : "off";
      }
    }
  },

  toast(msg) { toast(msg); },
  systemChat(text) { pushChat({ system: true, text }); },
  addChat(from, text) { pushChat({ from, text }); }
};

window.ChatSendAdapter = window.ChatSendAdapter || null;

// ---------- Bootstrap ----------
document.addEventListener("DOMContentLoaded", () => {
  initAbout();
  initMorePopover();
  initControls();
  initIdleFade();
  initLayoutModal();
  initParticipantsOffcanvas();
  initChat();
  renderAll();
  wireGlobalActivity();
});

// ---------- About modal ----------
function initAbout() {
  const hostEl = document.getElementById("about-host");
  if (hostEl) hostEl.textContent = State.HostName;
}

// ---------- Grid render ----------
function renderAll(layout = State.currentLayout || 1) {
  const perPage = layout * layout;
  const chunks = chunk(State.participants, perPage);
  const inner = document.getElementById("carousel-inner");
  if (!inner) return;
  inner.innerHTML = "";

  chunks.forEach((group, idx) => {
    const item = document.createElement("div");
    item.className = "carousel-item h-100" + (idx === 0 ? " active" : "");
    const grid = document.createElement("div");
    grid.className = `slide-grid layout-${layout}`;
    group.forEach((p) => grid.appendChild(renderTile(p)));
    item.appendChild(grid);
    inner.appendChild(item);
  });

  renderIndicators(chunks.length);

  // reattach self stream if layout rebuilt
  if (window.RTC_BRIDGE && typeof window.RTC_BRIDGE.attachStreamTo === "function") {
    const self = State.participants.find(p => p.self);
    if (self && window.localStream) {
      setTimeout(() => window.RTC_BRIDGE.attachStreamTo(self.id, window.localStream), 200);
    }
  }
}


function renderTile(p) {
  const tile = document.createElement("div");
  tile.className = "tile" + (p.cam === "on" ? " cam-on" : "");
  tile.dataset.pid = p.id;

  const ratio = document.createElement("div");
  ratio.className = "ratio";
  ratio.style.setProperty("--bs-aspect-ratio", getAspectRatio());

  const slot = document.createElement("div");
  slot.className = "w-100 h-100 d-flex align-items-center justify-content-center media-slot";
  ratio.appendChild(slot);

  const label = document.createElement("div");
  label.className = "name-tag d-inline-block text-truncate";
  label.textContent = p.name;

  tile.appendChild(ratio);
  tile.appendChild(label);
  return tile;
}

function getAspectRatio() {
  return window.matchMedia("(max-width: 768px)").matches ? "100%" : "56.25%";
}

function renderIndicators(n) {
  const wrap = document.getElementById("page-indicators");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "dash" + (i === 0 ? " active" : "");
    d.dataset.targetIndex = i;
    d.addEventListener("click", () => gotoSlide(i));
    wrap.appendChild(d);
  }
  const carouselEl = document.getElementById("meeting-carousel");
  if (carouselEl && !carouselEl.dataset._wired) {
    carouselEl.dataset._wired = "1";
    carouselEl.addEventListener("slid.bs.carousel", (ev) => {
      const idx = ev.to;
      [...wrap.children].forEach((el, j) => el.classList.toggle("active", j === idx));
    });
  }
}

function gotoSlide(idx) {
  const el = document.getElementById("meeting-carousel");
  const carousel = bootstrap.Carousel.getOrCreateInstance(el);
  carousel.to(idx);
}

// ---------- Popover ----------
function initMorePopover() {
  const btn = document.getElementById("btn-more");
  if (!btn) return;
  new bootstrap.Popover(btn, {
    html: true,
    placement: "top",
    customClass: "more-pop",
    container: "body",
    content: () => {
      const targetId = btn.getAttribute("data-for");
      const menu = document.querySelector(`.popover-menu[data-for="${targetId}"]`);
      if (menu) {
        const clone = menu.cloneNode(true);
        clone.classList.remove("d-none");
        clone.querySelectorAll("li").forEach((li) => {
          li.addEventListener("click", () => bootstrap.Popover.getInstance(btn)?.hide());
        });
        return clone;
      }
      return "No options";
    }
  });
}

// ---------- Controls ----------
function initControls() {
  bindToggle("btn-mic", "mic");
  bindToggle("btn-cam", "cam");
  bindToggle("btn-share", "share");
  bindToggle("btn-hand", "hand");

  const leaveBtn = document.getElementById("btn-leave");
  if (leaveBtn && !leaveBtn.dataset._wired) {
    leaveBtn.dataset._wired = "1";
    leaveBtn.addEventListener("click", () => {
      try { history.replaceState(null, "", "/"); } catch (e) {}
      location.href = "/";
    });
  }
}

function bindToggle(id, key) {
  const el = document.getElementById(id);
  if (!el || el.dataset._wired) return;
  el.dataset._wired = "1";
  el.addEventListener("click", () => {
    if (el.classList.contains("disabled")) return;

    const on = !el.classList.contains("is-on");
    el.classList.toggle("is-on", on);
    el.classList.toggle("is-off", !on);
    el.setAttribute("aria-pressed", String(on));

    if (key === "mic") {
      el.innerHTML = on
        ? `<i class="fa-solid fa-microphone"></i>`
        : `<i class="fa-solid fa-microphone-slash"></i>`;
    }
    if (key === "cam") {
      el.innerHTML = on
        ? `<i class="fa-solid fa-video"></i>`
        : `<i class="fa-solid fa-video-slash"></i>`;
      const self = State.participants.find((p) => p.self);
      if (self) {
        self.cam = on ? "on" : "off";
        const tile = document.querySelector(`.tile[data-pid="${self.id || 'self'}"]`);
        if (tile) tile.classList.toggle("cam-on", on);
      }
    }
    if (key === "hand" && on) {
      window.RTC_BRIDGE && window.RTC_BRIDGE.systemChat("You raised hand");
    }
  });
}

// ---------- Layout modal ----------
function applyLayout(layout) {
  const root = document.getElementById("carousel-inner");
  if (!root) return;
  root.classList.remove("layout-1", "layout-2", "layout-3", "layout-4", "layout-5");
  root.classList.add(`layout-${layout}`);
  renderAll(layout);
}

function initLayoutModal() {
  const modalEl = document.getElementById("layout-modal");
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  let tempLayout = State.currentLayout || 1;

  modalEl.addEventListener("show.bs.modal", () => {
    tempLayout = Number(localStorage.getItem("meeting.layout") || State.currentLayout || 1);
    modalEl.querySelectorAll(".layout-opt").forEach((b, i) => {
      b.classList.toggle("active", i + 1 === tempLayout);
    });
  });

  modalEl.querySelector(".btn-cancel")?.addEventListener("click", () => {
    const savedLayout = Number(localStorage.getItem("meeting.layout") || 2);
    applyLayout(savedLayout);
    State.currentLayout = savedLayout;
    modal.hide();
  });

  modalEl.querySelectorAll(".layout-opt").forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      tempLayout = idx + 1;
      applyLayout(tempLayout);
      modalEl.querySelectorAll(".layout-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const saveBtn = document.getElementById("layout-save");
  if (saveBtn && !saveBtn.dataset._wired) {
    saveBtn.dataset._wired = "1";
    saveBtn.addEventListener("click", () => {
      State.currentLayout = tempLayout;
      localStorage.setItem("meeting.layout", State.currentLayout);
      modal.hide();
    });
  }
}

// ---------- Participants offcanvas ----------
function initParticipantsOffcanvas() { refreshParticipantsOffcanvas(); }
function refreshParticipantsOffcanvas() {
  const ul = document.getElementById("participants-list");
  if (!ul) return;
  ul.innerHTML = "";
  State.participants.forEach((p) => {
    const li = document.createElement("li");
    li.className = "list-group-item bg-dark text-light ul_list";
    li.textContent = p.name + (p.self ? " (you)" : "");
    ul.appendChild(li);
  });
}

// ---------- Chat ----------
function initChat() {
  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  if (!sendBtn || !input) return;

  if (!sendBtn.dataset._wired) {
    sendBtn.dataset._wired = "1";
    sendBtn.addEventListener("click", sendChat);
  }
  if (!input.dataset._wired) {
    input.dataset._wired = "1";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }
}
function sendChat() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const you = localStorage.getItem("connectly.name") || "You";
  if (window.ChatSendAdapter) {
    window.ChatSendAdapter(text, (msg) => pushChat(msg));
  } else {
    pushChat({ from: you, text });
  }
  input.value = "";
}
function pushChat(msg) {
  const id = State.chat.length ? State.chat[State.chat.length - 1].id + 1 : 1;
  State.chat.push({ ...msg, id });
  const log = document.getElementById("chat-log");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "mb-2 fade-in";
  if (msg.system) {
    div.innerHTML = `<div class="text-secondary small">${escapeHtml(msg.text)}</div>`;
  } else {
    div.innerHTML = `<div><strong>${escapeHtml(msg.from || "Anon")}</strong></div><div>${escapeHtml(msg.text)}</div>`;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------- Idle controls fade ----------
function initIdleFade() { resetIdleTimer(); }
function wireGlobalActivity() {
  ["mousemove", "mousedown", "keydown", "touchstart", "wheel"].forEach((evt) => {
    document.addEventListener(evt, () => {
      showControls();
      resetIdleTimer();
    }, { passive: true });
  });
}
function resetIdleTimer() {
  if (State.idleTimer) clearTimeout(State.idleTimer);
  State.idleTimer = setTimeout(() => hideControls(), 10000);
}
function hideControls() {
  const bar = document.getElementById("ctrl-bar");
  if (bar) bar.style.opacity = "0";
  State.ctrlVisible = false;
}
function showControls() {
  if (State.ctrlVisible) return;
  const bar = document.getElementById("ctrl-bar");
  if (bar) bar.style.opacity = "1";
  State.ctrlVisible = true;
}

// ---------- Helpers ----------
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function toast(msg) {
  let box = document.getElementById("meet-toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "meet-toasts";
    box.style.position = "fixed";
    box.style.top = "16px";
    box.style.right = "16px";
    box.style.zIndex = "2000";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.style.background = "#333";
  t.style.color = "#fff";
  t.style.padding = "10px 14px";
  t.style.marginBottom = "8px";
  t.style.borderRadius = "6px";
  t.style.boxShadow = "0 2px 8px rgba(0,0,0,.3)";
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
