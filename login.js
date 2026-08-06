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

document.getElementById("registerForm").addEventListener("submit", async function(e){

    e.preventDefault();

    const student = {

        name: document.getElementById("name").value,
        phone: document.getElementById("phone").value,
        category: category.value,
        course: course.value,
        batch: batch.value

    };

    try{

        const response = await fetch("https://let-s-go-ikgptu.onrender.com/register",{

            method:"POST",

            headers:{
                "Content-Type":"application/json"
            },

            body:JSON.stringify(student)

        });

        const data = await response.json();

if (response.ok) {
    alert("Registration Successful!");
    localStorage.setItem("scm_registered", "true");
    window.location.href = "index.html";
} else if (response.status === 400 && (data.message || "").includes("already registered")) {
    // Already registered from another browser/device — let them through
    // instead of trapping them on this page.
    alert("This phone number is already registered. Taking you to the map.");
    localStorage.setItem("scm_registered", "true");
    window.location.href = "index.html";
} else {
    alert(data.message || "Registration failed.");
}
    }

    catch(error){

        alert("Cannot connect to server.");

        console.log(error);

    }

});