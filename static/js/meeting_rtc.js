// meeting_rtc.js
// Full-mesh WebRTC signaling over Django Channels.

console.log('------------------------ meeting-rtc.js (new testing 7) ---------------------------');

(function(){
  const meetingCode = window.location.pathname.split("/")[2];
  const BR = window.RTC_BRIDGE;

  const MKEY = (k) => `CONNECTLY:${meetingCode}:${k}`;
  const getName = () => localStorage.getItem("connectly.name") || "Anon";
  const isHost = (localStorage.getItem("connectly.is_host") === "1");
  const prevClientId = sessionStorage.getItem(MKEY("clientId"));
  const selfId = Math.random().toString(36).slice(2);
  sessionStorage.setItem(MKEY("clientId"), selfId);

  const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  let WS = null;

  // peers map stores: { pc, vTransceiver }
  const peers = new Map();
  let localStream = null;
  let currentVideoTrack = null;
  let currentAudioTrack = null;

  // screenshare state
  let screenSharing = false;
  let shareOwnerId = null;
  let displayStream = null;
  let sharingInProgress = false;

  document.addEventListener("DOMContentLoaded", async () => {
    await initLocalMedia();
    connectWS();
    bindDeviceControls();
    bindShareControl();
    bindHandControl();
    bindLeaveControl();

    window.ChatSendAdapter = (text, pushLocalCb) => {
      const name = getName();
      WS?.send(JSON.stringify({ type:"chat", name, text }));
    };
  });

  window.addEventListener("beforeunload", () => {
    try { WS?.send(JSON.stringify({ type: "leave" })); } catch(e){}
    WS?.close();
  });

  async function initLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e1) {
      try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
      catch (e2) {
        try { localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); }
        catch (e3) { localStream = new MediaStream(); }
      }
    }

    currentVideoTrack = localStream.getVideoTracks()[0] || null;
    currentAudioTrack = localStream.getAudioTracks()[0] || null;
    window.localStream = localStream;

    const prefCam = localStorage.getItem("connectly.pref_cam") || "on";
    const prefMic = localStorage.getItem("connectly.pref_mic") || "on";
    if (currentVideoTrack) currentVideoTrack.enabled = (prefCam === "on");
    if (currentAudioTrack) currentAudioTrack.enabled = (prefMic === "on");

    if (!currentVideoTrack) document.getElementById("btn-cam")?.classList.add("disabled");
    if (!currentAudioTrack) document.getElementById("btn-mic")?.classList.add("disabled");

    BR.upsertParticipant({
      id: selfId,
      name: `${getName()} (you)`,
      cam: currentVideoTrack && currentVideoTrack.enabled ? "on" : "off",
      mic: currentAudioTrack && currentAudioTrack.enabled ? "on" : "off",
      self: true
    });
    setTimeout(() => BR.attachStreamTo(selfId, localStream), 300);
    BR.attachStreamTo(selfId, localStream);

    peers.forEach(({ pc }) => {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    });

    if (currentVideoTrack) {
      currentVideoTrack.onended = () => {
        BR.setSelfDeviceFlags({ camOn: false });
        localStorage.setItem("connectly.pref_cam", "off");
      };
    }
  }

  // ---------- Small UI helper to keep share buttons honest ----------
  function setShareBtn(on){
    const b1 = document.getElementById("btn-share");     // main toggle
    const b2 = document.getElementById("btn-stopshare");  // optional stop button (if present)
    [b1, b2].forEach(b => {
      if (!b) return;
      b.classList.toggle("is-on", on);
      b.classList.toggle("is-off", !on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  function setShareBtnsDisabled(disabled){
    const b1 = document.getElementById("btn-share");
    const b2 = document.getElementById("btn-stopshare");
    [b1, b2].forEach(b => {
      if (!b) return;
      b.classList.toggle("disabled", !!disabled);
    });
  }

  function connectWS(){
    const proto = location.protocol === "https:" ? "wss" : "ws";
    WS = new WebSocket(`${proto}://${location.host}/ws/meet/${meetingCode}/`);

    WS.onopen = () => {
      if (prevClientId && prevClientId !== selfId) {
        try { WS.send(JSON.stringify({ type: "leave" })); } catch(e){}
      }
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

      if (t === "participant_list") {
        const list = Array.isArray(msg.participants) ? msg.participants : [];
        list.forEach(({clientId, name}) => {
          if (!clientId || clientId === selfId) return;
          BR.upsertParticipant({ id: clientId, name: name || "Peer" });
          // ensure we connect to all existing peers
          if (selfId < clientId) startCall(clientId);
        });
        return;
      }

      if (t === "presence") {
        const otherId = msg.clientId;
        const otherName = msg.name || "Peer";
        if (!otherId || otherId === selfId) return;
        BR.upsertParticipant({ id: otherId, name: otherName });
        if (selfId < otherId) await startCall(otherId);
        return;
      }

      if (t === "leave") {
        const otherId = msg.clientId;
        if (otherId) BR.removeParticipant(otherId);
        return;
      }

      if (t === "chat") {
        const name = msg.name || "Anon";
        const text = msg.text || "";
        BR.addChat(name, text);
        return;
      }

      if (t === "hand") {
        const name = msg.name || "Someone";
        if (name !== getName()) {
          BR.toast(`${name} raised hand`);
          BR.systemChat(`${name} raised hand`);
        } else {
          BR.toast("You raised hand");
        }
        return;
      }

      if (t === "screenshare") {
        const action = msg.action;
        const owner = msg.clientId;

        if (action === "start") {
          shareOwnerId = owner;
          // If someone else is sharing, disable our buttons
          setShareBtnsDisabled(owner !== selfId);
          if (owner === selfId) setShareBtn(true);
          BR.toast(`${msg.name || "Someone"} started sharing`);
        }

        if (action === "stop") {
          if (shareOwnerId === owner) shareOwnerId = null;
          // Re-enable our buttons now that sharing is free
          setShareBtnsDisabled(false);
          if (owner === selfId) setShareBtn(false);
          BR.toast(`${msg.name || "Someone"} stopped sharing`);
        }
        return;
      }

      if (t === "end_meeting") {
        BR.toast("Meeting ended by host");
        setTimeout(() => location.href = "/", 1200);
        return;
      }

      if (t === "offer") {
        if (msg.to !== selfId) return;
        const from = msg.from;
        const peerObj = ensurePeer(from);
        const pc = peerObj.pc;

        // make sure we advertise what we might send back
        if (localStream && pc.getSenders().length === 0) {
          localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log(`[RTC ${from}] ensured track before answer`, track.kind);
          });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        WS?.send(JSON.stringify({ type:"answer", from:selfId, to:from, sdp:answer }));
        return;
      }

      if (t === "answer") {
        if (msg.to !== selfId) return;
        const from = msg.from;
        const peerObj = peers.get(from);
        if (peerObj && peerObj.pc) {
          await peerObj.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        }
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

  function ensurePeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // add whatever local tracks exist (audio/cam)
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`[RTC ${peerId}] added track`, track.kind);
      });
    }

    // ensure a dedicated VIDEO TRANSCIEVER always exists for replaceTrack later
    // this avoids renegotiation when camera is off at share time
    let vTransceiver = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === "video");
    if (!vTransceiver) {
      vTransceiver = pc.addTransceiver("video", { direction: "sendrecv" });
      const cam = localStream && localStream.getVideoTracks()[0];
      vTransceiver.sender.replaceTrack(cam || null);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        WS?.send(JSON.stringify({ type: "candidate", from: selfId, to: peerId, candidate: e.candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[RTC ${peerId}] state:`, pc.iceConnectionState);
    };

    pc.ontrack = (e) => {
      console.log(`[RTC ${peerId}] ontrack fired`, e.streams);
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      BR.upsertParticipant({ id: peerId });
      BR.attachStreamTo(peerId, stream);
    };

    const info = { pc, vTransceiver };
    peers.set(peerId, info);
    return info;
  }

  async function startCall(peerId) {
    const peerObj = ensurePeer(peerId);
    const pc = peerObj.pc;

    if (localStream && pc.getSenders().length === 0) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log(`[RTC ${peerId}] ensured track before offer`, track.kind);
      });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    WS?.send(JSON.stringify({ type: "offer", from: selfId, to: peerId, sdp: offer }));
  }

  // Replace the video sender on every peer. If no transceiver yet (paranoia), create one.
  function replaceVideoOnAllPeers(newTrack) {
    peers.forEach((info) => {
      const { pc } = info;
      let vTx = info.vTransceiver;
      if (!vTx) {
        vTx = pc.addTransceiver("video", { direction: "sendrecv" });
        info.vTransceiver = vTx;
      }
      vTx.sender.replaceTrack(newTrack || null);
    });
  }

  // kept for API compatibility
  function replaceVideoTrack(newTrack){
    replaceVideoOnAllPeers(newTrack);
  }

  function bindDeviceControls() {
    const micBtn = document.getElementById("btn-mic");
    const camBtn = document.getElementById("btn-cam");

    const camPref = localStorage.getItem("connectly.pref_cam");
    const micPref = localStorage.getItem("connectly.pref_mic");

    if (currentVideoTrack && camPref) currentVideoTrack.enabled = (camPref === "on");
    if (currentAudioTrack && micPref) currentAudioTrack.enabled = (micPref === "on");

    const camOn = !!(currentVideoTrack && currentVideoTrack.enabled);
    const micOn = !!(currentAudioTrack && currentAudioTrack.enabled);

    if (camBtn) {
      camBtn.classList.toggle("is-on", camOn);
      camBtn.classList.toggle("is-off", !camOn);
      if (!currentVideoTrack) camBtn.classList.add("disabled");
    }
    if (micBtn) {
      micBtn.classList.toggle("is-on", micOn);
      micBtn.classList.toggle("is-off", !micOn);
      if (!currentAudioTrack) micBtn.classList.add("disabled");
    }

    if (micBtn && !micBtn.dataset._rtc) {
      micBtn.dataset._rtc = "1";
      micBtn.addEventListener("click", () => {
        if (!currentAudioTrack) return;
        const newState = !currentAudioTrack.enabled;
        currentAudioTrack.enabled = newState;
        BR.setSelfDeviceFlags({ micOn: newState });
        localStorage.setItem("connectly.pref_mic", newState ? "on" : "off");
        micBtn.classList.toggle("is-on", newState);
        micBtn.classList.toggle("is-off", !newState);
      });
    }

    if (camBtn && !camBtn.dataset._rtc) {
      camBtn.dataset._rtc = "1";
      camBtn.addEventListener("click", () => {
        if (!currentVideoTrack) return;
        const newState = !currentVideoTrack.enabled;
        currentVideoTrack.enabled = newState;
        BR.setSelfDeviceFlags({ camOn: newState });
        localStorage.setItem("connectly.pref_cam", newState ? "on" : "off");
        camBtn.classList.toggle("is-on", newState);
        camBtn.classList.toggle("is-off", !newState);
      });
    }
  }

  // One handler for both "share" and optional "stop share" buttons
  function bindShareControl(){
    const shareBtn = document.getElementById("btn-share");
    const stopBtn  = document.getElementById("btn-stopshare");

    const already = (el) => el && el.dataset._rtc;

    const wire = (el) => {
      if (!el || already(el)) return;
      el.dataset._rtc = "1";
      el.addEventListener("click", toggleShare);
    };

    wire(shareBtn);
    wire(stopBtn);
  }

  async function toggleShare(){
    if (shareOwnerId && shareOwnerId !== selfId) return;
      if (sharingInProgress) return;
      
      const isTurningOn = !screenSharing;
      if (isTurningOn) {
        sharingInProgress = true;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const newTrack = displayStream.getVideoTracks()[0];
        if (!newTrack) return;

        screenSharing = true;
        shareOwnerId = selfId;

        // replace the dedicated sender on every peer (works even if cam is off)
        replaceVideoOnAllPeers(newTrack);

        // show the shared screen in our own tile
        BR.attachStreamTo(selfId, new MediaStream([newTrack]));

        WS?.send(JSON.stringify({ type:"screenshare", action:"start", clientId:selfId, name:getName() }));
        setShareBtn(true);
        setShareBtnsDisabled(false);

        newTrack.onended = () => { if (screenSharing) stopShare(); };
      } catch(e) {
        BR.toast("Screen share failed");
      }
      finally {
       sharingInProgress = false;
     }
    } else {
      stopShare();
    }
  }

function stopShare(){
  if (!screenSharing) return;
  screenSharing = false;
  const wasOwner = shareOwnerId === selfId;
  shareOwnerId = null;

  try { displayStream?.getTracks().forEach(t => t.stop()); } catch(_) {}
  displayStream = null;

  const cam = localStream && localStream.getVideoTracks()[0];
  const camWasOn = !!(cam && cam.enabled);

  // Restore what peers should see
  replaceVideoOnAllPeers(camWasOn ? cam : null);

  // Restore or clear the local tile deterministically
  if (camWasOn) {
    BR.attachStreamTo(selfId, localStream);
    BR.setSelfDeviceFlags({ camOn: true });
  } else {
    // force-remove the last shared frame in the tile
    BR.attachStreamTo(selfId, new MediaStream());
    BR.setSelfDeviceFlags({ camOn: false });
  }

  WS?.send(JSON.stringify({ type:"screenshare", action:"stop", clientId:selfId, name:getName() }));
  if (wasOwner) setShareBtn(false);
  setShareBtnsDisabled(false);
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
      try {
        sessionStorage.removeItem(MKEY("clientId"));
        localStorage.removeItem("connectly.name");
        localStorage.removeItem("connectly.designation");
        localStorage.removeItem("connectly.pref_cam");
        localStorage.removeItem("connectly.pref_mic");
        localStorage.removeItem("meeting.layout");
      } catch(e){}
    });
  }

})();
