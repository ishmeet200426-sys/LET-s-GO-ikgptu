// Welcome overlay: shown once per browser session, right here on
// the registration page — the first thing a new visitor sees.
(function initWelcomeOverlay() {
    const overlay = document.getElementById("welcomeOverlay");
    const startBtn = document.getElementById("welcomeStartBtn");

    if (!overlay) return;

    if (sessionStorage.getItem("scm_welcome_seen")) {
        overlay.classList.add("hidden");
    }

    function dismiss() {
        overlay.classList.add("hidden");
        sessionStorage.setItem("scm_welcome_seen", "true");
    }

    if (startBtn) startBtn.addEventListener("click", dismiss);
    overlay.addEventListener("click", function(e) {
        if (e.target === overlay) dismiss();
    });
})();

const category = document.getElementById("category");
const course = document.getElementById("course");
const batch = document.getElementById("batch");

const courseData = {
    "Engineering": [
        "CSE/AIML/DS",
        "EEE",
        "ECE/ECS",
        "ME",
        "CE"
    ],

    "Management": [
        "BBA",
        "MBA",
        "BHMCT"
    ],

    "Applied Courses": [
        "BCA",
        "MCA",
        "B.Sc Chem/Phy/Math/Food Tech",
        "BAJMC",
        "M.Sc-FT"
    ]
};

category.addEventListener("change", () => {

    course.innerHTML = '<option value="">Select Course</option>';
    batch.innerHTML = '<option value="">Select Batch</option>';

    if (courseData[category.value]) {

        courseData[category.value].forEach(item => {

            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;

            course.appendChild(option);

        });

    }

});

course.addEventListener("change", () => {

    batch.innerHTML = '<option value="">Select Batch</option>';

    let batches = [];

    if (category.value === "Engineering") {

        batches = [
            "2023-2027",
            "2024-2028",
            "2025-2029",
            "2026-2030"
        ];

    }

    else if (category.value === "Management") {

        if (course.value === "MBA") {

            batches = [
                "2025-2027",
                "2026-2028"
            ];

        } else {

            batches = [
                "2024-2027",
                "2025-2028",
                "2026-2029"
            ];

        }

    }

    else {

        if (
            course.value === "MCA" ||
            course.value === "M.Sc-FT"
        ) {

            batches = [
                "2025-2027",
                "2026-2028"
            ];

        } else {

            batches = [
                "2024-2027",
                "2025-2028",
                "2026-2029"
            ];

        }

    }

    batches.forEach(item => {

        const option = document.createElement("option");

        option.value = item;
        option.textContent = item;

        batch.appendChild(option);

    });

});

let pendingEmail = "";

document.getElementById("registerForm").addEventListener("submit", async function(e) {
    e.preventDefault();

    const form = e.target;
    const submitBtn = form.querySelector("button[type='submit']");

    const student = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        category: category.value,
        course: course.value,
        batch: batch.value
    };

    // Basic validation
    if (
        !student.name ||
        !student.phone ||
        !student.email ||
        !student.category ||
        !student.course ||
        !student.batch
    ) {
        alert("Please fill in all fields.");
        return;
    }

    // Prevent multiple clicks
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.textContent = "Sending OTP...";
    }

    try {
        const response = await fetch(
            "https://let-s-go-ikgptu.onrender.com/send-otp",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(student)
            }
        );

        const data = await response.json();

        if (response.ok) {

            // Remember which email we are verifying
            pendingEmail = student.email;

            // Hide registration form
            form.style.display = "none";

            // Show OTP section
            document.getElementById("otpSection").style.display = "block";

            alert("OTP sent successfully to your email.");

        } else {

            alert(data.message || "Unable to send OTP.");

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = submitBtn.dataset.originalText;
            }
        }

    } catch (error) {

        console.log(error);

        alert(
            "Cannot connect to server. If this is your first request in a while, the server may be waking up — please wait 30 seconds and try again."
        );

        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtn.dataset.originalText;
        }
    }
});

document.getElementById("verifyOtpBtn").addEventListener("click", async function() {

    const otpInput = document.getElementById("otp");
    const otpMessage = document.getElementById("otpMessage");
    const verifyBtn = document.getElementById("verifyOtpBtn");

    const otp = otpInput.value.trim();

    if (!otp) {
        otpMessage.textContent = "Please enter the OTP.";
        return;
    }

    if (!/^\d{6}$/.test(otp)) {
        otpMessage.textContent = "OTP must be exactly 6 digits.";
        return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = "Verifying...";

    try {

        const response = await fetch(
            "https://let-s-go-ikgptu.onrender.com/verify-otp",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    email: pendingEmail,
                    otp: otp
                })
            }
        );

        const data = await response.json();

        if (response.ok) {

            otpMessage.textContent =
                "Email verified successfully!";

            localStorage.setItem("scm_registered", "true");

            setTimeout(() => {
                window.location.href = "index.html";
            }, 800);

        } else {

            otpMessage.textContent =
                data.message || "Invalid OTP.";

            verifyBtn.disabled = false;
            verifyBtn.textContent = "Verify OTP";
        }

    } catch (error) {

        console.log(error);

        otpMessage.textContent =
            "Cannot connect to server. Please try again.";

        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify OTP";
    }
});