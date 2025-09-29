let currentMeetingCode = null;
let localStream = null;

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
                        showToast("Meeting verified, opening preview…", "success");
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
                        showToast("Joined meeting!", "success");
                        // localStorage.setItem("meeting_code", currentMeetingCode);
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

    // // ---- video preview + toggles ----
    async function initPreview() {
        const video = document.getElementById("videoPreview");
        const overlay = document.getElementById("videoOffOverlay");
        const videoBtn = document.getElementById("toggleVideo");
        const audioBtn = document.getElementById("toggleAudio");
    
        let videoStream = null;
        let audioStream = null;
    
        // Try video
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = videoStream;
            setButtonState(videoBtn, true);
        } catch (err) {
            console.warn("Video error:", err);
            setButtonState(videoBtn, false);
            showToast("No camera found", "danger");
        }
    
        // Try audio
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setButtonState(audioBtn, true);
        } catch (err) {
            console.warn("Audio error:", err);
            setButtonState(audioBtn, false);
            showToast("No microphone found", "danger");
        }
    
        // Merge streams if both exist
        if (videoStream || audioStream) {
            localStream = new MediaStream([
                ...(videoStream ? videoStream.getTracks() : []),
                ...(audioStream ? audioStream.getTracks() : [])
            ]);
        }
    
        // ---- toggles ----
        videoBtn.addEventListener("click", () => {
            if (!localStream) return;
            console.log("Video button clicked");
            const track = localStream.getVideoTracks()[0];
            track.enabled = !track.enabled;
            setButtonState(videoBtn, track.enabled);
            overlay.classList.toggle("d-none", track.enabled);
            console.log("Video track enabled:", track.enabled);
        });
    
        audioBtn.addEventListener("click", () => {
            if (!localStream) return;
            console.log("Audio button clicked");
            const track = localStream.getAudioTracks()[0];
            track.enabled = !track.enabled;
            setButtonState(audioBtn, track.enabled);
            console.log("Audio track enabled:", track.enabled);
        });
    }



    // // ---- utility: update button state ----
    function setButtonState(btn, enabled) {
        btn.classList.toggle("enabled", enabled);
        btn.classList.toggle("disabled", !enabled);
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
});
