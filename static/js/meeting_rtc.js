// static/js/meeting_rtc.js
// Full-mesh WebRTC signaling over Django Channels.
// - Reliable presence (join/leave) with clientId
// - No double chat echoes
// - Screen share toggle w/stop via toolbar or button
// - Basic, predictable logic (no prompts)
// - Clears meeting-specific storage on leave

(function(){
  const meetingCode = window.location.pathname.split("/")[2];
  const BR = window.RTC_BRIDGE;

  // ---- per-meeting storage helpers -----------------------------------------
  const MKEY = (k) => `CONNECTLY:${meetingCode}:${k}`;
  const getName = () => localStorage.getItem("connectly.name") || "Anon";
  const isHost = (localStorage.getItem("connectly.is_host") === "1");
  const prevClientId = sessionStorage.getItem(MKEY("clientId"));
  const selfId = Math.random().toString(36).slice(2);
  sessionStorage.setItem(MKEY("clientId"), selfId);

  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  let WS = null;

  const peers = new Map(); // peerId -> { pc }
  let localStream = null;
  let currentVideoTrack = null;
  let currentAudioTrack = null;
  let screenSharing = false;

  // ---- Boot ----------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    await initLocalMedia();
    connectWS();
    bindDeviceControls();
    bindShareControl();
    bindHandControl();
    bindLeaveControl();

    // WS chat sender adapter (avoid double echo for sender)
    window.ChatSendAdapter = (text, pushLocalCb) => {
      const name = getName();
      WS?.send(JSON.stringify({ type:"chat", name, text }));
      // Don't push immediately; we'll rely on server echo for everyone.
      // (If you prefer immediate local echo, uncomment next line AND
      // guard in onmessage to skip echo: if (msg.name !== name) ...)
      // pushLocalCb({ from: name, text });
    };
  });

  // Ensure old same-meeting session is replaced (same browser / new tab)
  window.addEventListener("beforeunload", () => {
    try {
      WS?.send(JSON.stringify({ type: "leave" }));
    } catch(e){}
    WS?.close();
  });

  // ---- Local media ---------------------------------------------------------
  async function initLocalMedia(){
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch(e) {
      try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
      catch(e2){
        try { localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); }
        catch(e3){ localStream = new MediaStream(); }
      }
    }

    currentVideoTrack = localStream.getVideoTracks()[0] || null;
    currentAudioTrack = localStream.getAudioTracks()[0] || null;

    // Respect saved preview prefs (if any)
    const prefCam = localStorage.getItem("connectly.pref_cam"); // "on" | "off"
    const prefMic = localStorage.getItem("connectly.pref_mic"); // "on" | "off"
    if (currentVideoTrack && prefCam === "off") currentVideoTrack.enabled = false;
    if (currentAudioTrack && prefMic === "off") currentAudioTrack.enabled = false;

    // Disable buttons if devices missing
    if (!currentVideoTrack) {
      const camBtn = document.getElementById("btn-cam");
      if (camBtn) camBtn.classList.add("disabled");
    }
    if (!currentAudioTrack) {
      const micBtn = document.getElementById("btn-mic");
      if (micBtn) micBtn.classList.add("disabled");
    }

    // Show self tile
    BR.upsertParticipant({
      id: selfId,
      name: getName() + " (you)",
      cam: currentVideoTrack && currentVideoTrack.enabled ? "on" : "off",
      mic: currentAudioTrack && currentAudioTrack.enabled ? "on" : "off",
      self: true
    });
  }

  // ---- WS ---------------------------------------------------------------
  function connectWS(){
    const proto = location.protocol === "https:" ? "wss" : "ws";
    WS = new WebSocket(`${proto}://${location.host}/ws/meet/${meetingCode}/`);

    WS.onopen = () => {
      // If we had a prior tab in same meeting, simulate leaving it
      if (prevClientId && prevClientId !== selfId) {
        try { WS.send(JSON.stringify({ type: "leave" })); } catch(e){}
      }

      // Announce presence
      WS.send(JSON.stringify({
        type: "presence",
        clientId: selfId,
        name: getName(),
        is_host: isHost
      }));
    };

    WS.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      const t = msg.type;

      // Initial sync list
      if (t === "participant_list") {
        const list = Array.isArray(msg.participants) ? msg.participants : [];
        list.forEach(({clientId, name}) => {
          if (!clientId || clientId === selfId) return;
          BR.upsertParticipant({ id: clientId, name: name || "Peer", cam: "on", mic: "on" });
        });
        return;
      }

      // Someone joined
      if (t === "presence") {
        const otherId = msg.clientId;
        const otherName = msg.name || "Peer";
        if (!otherId || otherId === selfId) return;
        BR.upsertParticipant({ id: otherId, name: otherName, cam: "on", mic: "on" });
        // Glare-avoid: "smaller" id initiates
        if (selfId < otherId) await startCall(otherId);
        return;
      }

      // Someone left
      if (t === "leave") {
        const otherId = msg.clientId;
        if (otherId) BR.removeParticipant(otherId);
        return;
      }

      // Chat (avoid double echo for sender)
      if (t === "chat") {
        const name = msg.name || "Anon";
        const text = msg.text || "";
        if (name !== getName()) BR.addChat(name, text);
        else BR.addChat(name, text); // <- If you enabled immediate local echo, keep this; else remove.
        return;
      }

      if (t === "hand") {
        const name = msg.name || "Someone";
      
        // Receiver side (not sender)
        if (name !== getName()) {
          BR.toast(`${name} raised hand`);
          BR.systemChat(`${name} raised hand`);
        }
      
        else {
          // only one chat line, no duplicates
          BR.toast("You raised hand");
        }
      
        return;
      }


      // Screenshare start/stop
      if (t === "screenshare") {
        // payload: { action, clientId, name }
        const action = msg.action;
        const who = msg.name || "Someone";
        if (action === "start") {
          BR.toast(`${who} started sharing`);
          // Optional: change layout here for everyone (simple version)
          // window.applyMeetingLayout && window.applyMeetingLayout(1);
        } else if (action === "stop") {
          BR.toast(`${who} stopped sharing`);
        }
        return;
      }

      // Meeting ended
      if (t === "end_meeting") {
        BR.toast("Meeting ended by host");
        setTimeout(() => location.href = "/", 1200);
        return;
      }

      // Signaling
      if (t === "offer") {
        if (msg.to !== selfId) return;
        const from = msg.from;
        const pc = ensurePeer(from);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        WS?.send(JSON.stringify({ type:"answer", from:selfId, to:from, sdp:answer }));
        return;
      }

      if (t === "answer") {
        if (msg.to !== selfId) return;
        const from = msg.from;
        const peer = peers.get(from);
        if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        return;
      }

      if (t === "candidate") {
        if (msg.to !== selfId) return;
        const from = msg.from;
        const peer = ensurePeer(from);
        try { await peer.pc.addIceCandidate(msg.candidate); } catch(e) {}
        return;
      }
    };
  }

  // ---- WebRTC helpers ------------------------------------------------------
  function ensurePeer(peerId){
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStream) {
      localStream.getTracks().forEach(tr => pc.addTrack(tr, localStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        WS?.send(JSON.stringify({ type:"candidate", from:selfId, to:peerId, candidate:e.candidate }));
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      BR.attachStreamTo(peerId, stream);
    };

    peers.set(peerId, { pc });
    return peers.get(peerId);
  }

  async function startCall(peerId){
    const peer = ensurePeer(peerId);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    WS?.send(JSON.stringify({ type:"offer", from:selfId, to:peerId, sdp:offer }));
  }

  function replaceVideoTrack(newTrack){
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(newTrack);
    });
  }

  // ---- Controls ------------------------------------------------------------
  function bindDeviceControls(){
    const micBtn = document.getElementById("btn-mic");
    const camBtn = document.getElementById("btn-cam");

    if (micBtn && !micBtn.dataset._rtc) {
      micBtn.dataset._rtc = "1";
      micBtn.addEventListener("click", () => {
        if (!currentAudioTrack) return;
        const enable = micBtn.classList.contains("is-on");
        currentAudioTrack.enabled = enable;
        BR.setSelfDeviceFlags({ micOn: enable });
        localStorage.setItem("connectly.pref_mic", enable ? "on" : "off");
      });
    }

    if (camBtn && !camBtn.dataset._rtc) {
      camBtn.dataset._rtc = "1";
      camBtn.addEventListener("click", () => {
        if (!currentVideoTrack && localStream) {
          const vt = localStream.getVideoTracks()[0] || null;
          if (vt) currentVideoTrack = vt;
        }
        if (!currentVideoTrack) return;
        const enable = camBtn.classList.contains("is-on");
        currentVideoTrack.enabled = enable;
        BR.setSelfDeviceFlags({ camOn: enable });
        localStorage.setItem("connectly.pref_cam", enable ? "on" : "off");
      });
    }
  }

  function bindShareControl(){
    const shareBtn = document.getElementById("btn-share");
    if (!shareBtn || shareBtn.dataset._rtc) return;
    shareBtn.dataset._rtc = "1";

    shareBtn.addEventListener("click", async () => {
      const turningOn = shareBtn.classList.contains("is-on");

      if (turningOn && !screenSharing) {
        try {
          const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          const newTrack = ds.getVideoTracks()[0];
          if (!newTrack) return;

          screenSharing = true;
          replaceVideoTrack(newTrack);

          // notify others
          WS?.send(JSON.stringify({ type:"screenshare", action:"start", clientId:selfId, name:getName() }));

          newTrack.onended = () => {
            if (screenSharing) stopShare();
          };
        } catch(e) {
          BR.toast("Screen share failed");
        }
      } else {
        stopShare();
      }
    });
  }

  function stopShare(){
    screenSharing = false;
    // revert to camera
    const cam = localStream && localStream.getVideoTracks()[0];
    if (cam) replaceVideoTrack(cam);
    // notify others
    WS?.send(JSON.stringify({ type:"screenshare", action:"stop", clientId:selfId, name:getName() }));
  }

  function bindHandControl(){
    const handBtn = document.getElementById("btn-hand");
    if (!handBtn || handBtn.dataset._rtc) return;
    handBtn.dataset._rtc = "1";
    handBtn.addEventListener("click", () => {
      const on = handBtn.classList.contains("is-on");
      if (on) WS?.send(JSON.stringify({ type:"hand", name: getName() }));
    });
  }

  function bindLeaveControl(){
    const leaveBtn = document.getElementById("btn-leave");
    if (!leaveBtn || leaveBtn.dataset._rtc) return;
    leaveBtn.dataset._rtc = "1";
    leaveBtn.addEventListener("click", () => {
      try { WS?.send(JSON.stringify({ type:"leave" })); } catch(e){}
      // full cleanup – as requested
      try {
        sessionStorage.removeItem(MKEY("clientId"));
        localStorage.removeItem("connectly.name");
        localStorage.removeItem("connectly.is_host");
        localStorage.removeItem("connectly.pref_cam");
        localStorage.removeItem("connectly.pref_mic");
      } catch(e){}
      // meeting.js handles redirect
    });
  }

})();
