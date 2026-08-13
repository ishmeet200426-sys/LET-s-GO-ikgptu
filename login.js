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

// Strip anything that isn't a digit as the user types, and cap at 10 digits
// (backend still re-validates this — never trust frontend-only checks)
const phoneInput = document.getElementById("phone");
if (phoneInput) {
    phoneInput.addEventListener("input", function() {
        phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
    });
}

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
    batch: batch.value,
    password: document.getElementById("password").value
};

const confirmPassword =
    document.getElementById("confirmPassword").value;

    // Basic validation
    if (
    !student.name ||
    !student.phone ||
    !student.email ||
    !student.category ||
    !student.course ||
    !student.batch ||
    !student.password ||
    !confirmPassword
) {
    alert("Please fill in all fields.");
    return;
}

if (student.password.length < 8) {
    alert("Password must be at least 8 characters long.");
    return;
}

if (student.password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
}

    // Phone must be exactly 10 digits, starting with 6-9 (valid Indian mobile format)
    const phonePattern = /^[6-9]\d{9}$/;
    if (!phonePattern.test(student.phone)) {
        alert("Please enter a valid 10-digit phone number.");
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

      if (response.ok && data.alreadyRegistered) {

    alert("This email is already registered. Please login with your email and password.");

    document.getElementById("loginSection").style.display = "block";
    document.getElementById("registerSection").style.display = "none";

    return;
      }

else if (response.ok && data.skippedVerification) {

    alert(data.message);

    document.getElementById("loginSection").style.display = "block";
    document.getElementById("registerSection").style.display = "none";

    return;
}

    else if (response.ok) {

            // Remember which email we are verifying
            pendingEmail = student.email;
         const otpEmail = document.getElementById("otpEmail");

if (otpEmail) {
    otpEmail.textContent = pendingEmail;
}
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
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const showRegisterBtn = document.getElementById("showRegisterBtn");

if (loginForm) {

    loginForm.addEventListener("submit", async function (e) {

        e.preventDefault();

        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        if (!email || !password) {
            loginMessage.textContent =
                "Please enter your email and password.";
            return;
        }

        const loginButton =
            loginForm.querySelector("button[type='submit']");

        loginButton.disabled = true;
        loginButton.textContent = "Logging in...";

        try {

            const response = await fetch(
                "https://let-s-go-ikgptu.onrender.com/student-login",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        email,
                        password
                    })
                }
            );

            const data = await response.json();

            if (response.ok) {

                // Save authentication token
                localStorage.setItem(
                    "studentToken",
                    data.token
                );

                // Keep the existing flag if your map currently
                // uses it to determine registration status.
                localStorage.setItem(
                    "scm_registered",
                    "true"
                );

                // Optional: save student information
                localStorage.setItem(
                    "student",
                    JSON.stringify(data.student)
                );

                window.location.href = "index.html";

            } else {

                loginMessage.textContent =
                    data.message || "Invalid email or password.";

                loginButton.disabled = false;
                loginButton.textContent = "Login & Continue";
            }

        } catch (error) {

            console.error(error);

            loginMessage.textContent =
                "Cannot connect to server. Please try again.";

            loginButton.disabled = false;
            loginButton.textContent = "Login & Continue";
        }

    });

}


if (showRegisterBtn) {

    showRegisterBtn.addEventListener("click", function () {

        document.getElementById("loginSection").style.display = "none";

        document.getElementById("registerSection").style.display = "block";

    });

}
const backToRegistrationBtn =
    document.getElementById("backToRegistrationBtn");

if (backToRegistrationBtn) {

    backToRegistrationBtn.addEventListener("click", function () {

        // Hide OTP section
        document.getElementById("otpSection").style.display = "none";

        // Show registration form
        document.getElementById("registerForm").style.display = "block";

        // Clear OTP
        document.getElementById("otp").value = "";

        // Clear OTP message
        document.getElementById("otpMessage").textContent = "";

        // Restore register button
        const registerBtn =
            document.querySelector("#registerForm button[type='submit']");

        if (registerBtn) {
            registerBtn.disabled = false;
            registerBtn.textContent =
                registerBtn.dataset.originalText || "Register & Continue";
        }

    });

}