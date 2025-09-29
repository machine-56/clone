let currentMeetingCode = null;
let localStream = null;
let selectedVideoDevice = null;
let selectedAudioDevice = null;

document.addEventListener("DOMContentLoaded", function () {
    // // ---- popover trigger ----
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.forEach(function (popoverTriggerEl) {
        const popover = new bootstrap.Popover(popoverTriggerEl, {
            html: true,
            customClass: "custom-popover",
            placement: "bottom",
            offset: [0, -40],
            content: function () {
                const targetId = popoverTriggerEl.getAttribute("data-for");
                const menu = document.querySelector(`.popover-menu[data-for="${targetId}"]`);
                return menu ? menu.innerHTML : "No content";
            }
        });

        document.addEventListener("click", function (e) {
            const currentPopover = document.querySelector(".popover.show");
            if (
                currentPopover &&
                !currentPopover.contains(e.target) &&
                !popoverTriggerEl.contains(e.target)
            ) {
                popover.hide();
            }
        });
    });

    // // ---- check meeting code (Stage 1) ----
    const joinForm = document.getElementById("joinMeetingForm");
    if (joinForm) {
        joinForm.addEventListener("submit", function (e) {
            e.preventDefault();

            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
            const payload = {
                meeting_code: document.getElementById("meetingCode").value,
                password: document.getElementById("meetingPassword").value
            };

            fetch("/verify_meeting/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken
                },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    const joinModal = bootstrap.Modal.getInstance(document.getElementById("joinMeetingModal"));
                    if (joinModal) joinModal.hide();

                    if (data.success) {
                        currentMeetingCode = data.meeting_code;
                        // showToast("Meeting verified, opening preview…", "success");
                        new bootstrap.Modal(document.getElementById("previewModal")).show();
                        initPreview();
                    } else {
                        showToast("Invalid meeting code or password", "danger");
                    }
                })
                .catch(err => {
                    console.error(err);
                    showToast("Server error", "danger");
                });
        });
    }

    // // ---- join meeting details (Stage 2) ----
    const detailsForm = document.getElementById("joinMeetingDetails");
    if (detailsForm) {
        detailsForm.addEventListener("submit", function (e) {
            e.preventDefault();

            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]').value;
            const payload = {
                meeting_code: currentMeetingCode,
                name: document.getElementById("participantName").value,
                designation: document.getElementById("participantDesignation").value
            };

            fetch("/join_meeting/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": csrfToken
                },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        const previewModal = bootstrap.Modal.getInstance(document.getElementById("previewModal"));
                        if (previewModal) previewModal.hide();

                        showTransitionAndRedirect(`/meet_code/${currentMeetingCode}/`);
                    } else {
                        showToast("Something went wrong, try again", "danger");
                    }
                })
                .catch(err => {
                    console.error(err);
                    showToast("Server error", "danger");
                });
        });
    }

    // // ---- device settings modal ----
    const settingsBtn = document.getElementById("openSettings");
    let videoSelect = document.getElementById("videoDeviceSelect");
    let audioSelect = document.getElementById("audioDeviceSelect");

    if (settingsBtn) {
        settingsBtn.addEventListener("click", async () => {
            const modal = new bootstrap.Modal(document.getElementById("deviceSettingsModal"));
            await prepareDevices(); // permission + enumerate devices
            modal.show();
        });
    }

    async function prepareDevices() {
        try {
            // Minimal request to trigger permissions
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            tempStream.getTracks().forEach(track => track.stop());
        } catch (err) {
            console.warn("Permission not granted (yet):", err);
        }
        await populateDeviceLists();
    }

    async function populateDeviceLists() {
        const devices = await navigator.mediaDevices.enumerateDevices();

        // Clear
        videoSelect.innerHTML = "";
        audioSelect.innerHTML = "";

        const videoDevices = devices.filter(d => d.kind === "videoinput");
        const audioDevices = devices.filter(d => d.kind === "audioinput");

        // Video
        if (videoDevices.length === 0) {
            const opt = document.createElement("option");
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = "No device found";
            videoSelect.appendChild(opt);
            selectedVideoDevice = null;
        } else {
            videoDevices.forEach((d, i) => {
                const opt = document.createElement("option");
                opt.value = d.deviceId;
                opt.textContent = d.label || `Camera ${i + 1}`;
                videoSelect.appendChild(opt);
            });
            selectedVideoDevice = videoDevices[0].deviceId;
        }

        // Audio
        if (audioDevices.length === 0) {
            const opt = document.createElement("option");
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = "No device found";
            audioSelect.appendChild(opt);
            selectedAudioDevice = null;
        } else {
            audioDevices.forEach((d, i) => {
                const opt = document.createElement("option");
                opt.value = d.deviceId;
                opt.textContent = d.label || `Microphone ${i + 1}`;
                audioSelect.appendChild(opt);
            });
            selectedAudioDevice = audioDevices[0].deviceId;
        }
    }

    // Save settings → re-run preview
    document.getElementById("saveDeviceSettings").addEventListener("click", () => {
        selectedVideoDevice = videoSelect.value || null;
        selectedAudioDevice = audioSelect.value || null;

        console.log("Saved settings:", { selectedVideoDevice, selectedAudioDevice });

        showToast("Device settings saved", "success");
        const modal = bootstrap.Modal.getInstance(document.getElementById("deviceSettingsModal"));
        modal.hide();

        initPreview(); // re-run preview with new selections
    });

    // // ---- video preview + toggles ----
    async function initPreview() {
        const video = document.getElementById("videoPreview");
        const overlay = document.getElementById("videoOffOverlay");
        const videoBtn = document.getElementById("toggleVideo");
        const audioBtn = document.getElementById("toggleAudio");

        let videoStream = null;
        let audioStream = null;
        let cameraAvailable = false;

        // Try video
        try {
            if (selectedVideoDevice) {
                videoStream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: selectedVideoDevice } }
                });
            } else {
                videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            video.srcObject = videoStream;
            setButtonState(videoBtn, true);
            overlay.classList.add("d-none");
            cameraAvailable = true;
        } catch (err) {
            console.warn("Video error:", err);
            setButtonState(videoBtn, false);

            overlay.textContent = "No camera found";
            overlay.classList.remove("d-none");
            cameraAvailable = false;

            showToast("No camera found", "danger");
        }

        // Try audio
        try {
            if (selectedAudioDevice) {
                audioStream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: selectedAudioDevice } }
                });
            } else {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            setButtonState(audioBtn, true);
        } catch (err) {
            console.warn("Audio error:", err);
            setButtonState(audioBtn, false);
            showToast("No microphone found", "danger");
        }

        // Merge streams
        if (videoStream || audioStream) {
            localStream = new MediaStream([
                ...(videoStream ? videoStream.getTracks() : []),
                ...(audioStream ? audioStream.getTracks() : [])
            ]);
        }

        // // ---- toggles ----
        videoBtn.onclick = () => {
            if (!localStream || !cameraAvailable) return;
        
            const track = localStream.getVideoTracks()[0];
            if (!track) return;
            track.enabled = !track.enabled;
        
            setButtonState(videoBtn, track.enabled);
        
            // overlay
            if (track.enabled) {
                overlay.classList.add("d-none");
            } else {
                overlay.textContent = "Video Off";
                overlay.classList.remove("d-none");
            }
        
            // icon toggle
            const icon = videoBtn.querySelector("i");
            if (icon) {
                icon.classList.toggle("fa-video", track.enabled);
                icon.classList.toggle("fa-video-slash", !track.enabled);
            }
        };

        audioBtn.onclick = () => {
            if (!localStream) return;
            const track = localStream.getAudioTracks()[0];
            if (!track) return;
            track.enabled = !track.enabled;
        
            setButtonState(audioBtn, track.enabled);
        
            // icon toggle
            const icon = audioBtn.querySelector("i");
            if (icon) {
                icon.classList.toggle("fa-microphone", track.enabled);
                icon.classList.toggle("fa-microphone-slash", !track.enabled);
            }
        };

    }


    // // ---- utility: update button state ----
    function setButtonState(btn, enabled) {
        btn.classList.toggle("enabled", enabled);
        btn.classList.toggle("disabled", !enabled);

        // update icon automatically if button has an <i>
        const icon = btn.querySelector("i");
        if (icon) {
            if (icon.classList.contains("fa-video") || icon.classList.contains("fa-video-slash")) {
                icon.classList.toggle("fa-video", enabled);
                icon.classList.toggle("fa-video-slash", !enabled);
            }
            if (icon.classList.contains("fa-microphone") || icon.classList.contains("fa-microphone-slash")) {
                icon.classList.toggle("fa-microphone", enabled);
                icon.classList.toggle("fa-microphone-slash", !enabled);
            }
        }
    }


    // // ---- utility: toast ----
    function showToast(message, type) {
        const container = document.getElementById("toastContainer");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast align-items-center text-bg-${type} border-0 show mb-2`;
        toast.innerHTML = `
          <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
          </div>
        `;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function showTransitionAndRedirect(url) {
        const overlay = document.getElementById("transitionOverlay");
        if (!overlay) return;
    
        overlay.classList.add("active");
        setTimeout(() => {
            window.location.href = url;
        }, 1600);
    }



});
