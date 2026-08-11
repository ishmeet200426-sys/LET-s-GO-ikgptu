const table = document.getElementById("studentTable");

const BACKEND_URL = "https://let-s-go-ikgptu.onrender.com";

// --- Password gate ---
// The raw admin password is never stored anymore — only a signed,
// expiring token exchanged for it once via /admin/login. Kept in
// sessionStorage so it clears when the tab/browser closes, same as
// before, but now it naturally expires after 6 hours even if the tab
// stays open, and the actual password is never sent more than once.
async function getValidAdminToken() {

    let token = sessionStorage.getItem("scm_admin_token");
    if (token) return token;

    while (true) {

        const password = prompt("Enter admin password:");
        if (password === null) return null; // user cancelled

        const response = await fetch(`${BACKEND_URL}/admin/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            const data = await response.json();
            sessionStorage.setItem("scm_admin_token", data.token);
            return data.token;
        }

        alert("Incorrect password. Try again.");

    }

}

const categoryFilter = document.getElementById("categoryFilter");
const courseFilter = document.getElementById("courseFilter");
const batchFilter = document.getElementById("batchFilter");
const searchInput = document.getElementById("searchInput");

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
const batchData = {
    "Engineering": [
        "2023-2027",
        "2024-2028",
        "2025-2029",
        "2026-2030"
    ],

    "Management": {
        "BBA": [
            "2024-2027",
            "2025-2028",
            "2026-2029"
        ],
        "MBA": [
            "2025-2027",
            "2026-2028"
        ],
        "BHMCT": [
            "2024-2028",
            "2025-2029"
        ]
    },

    "Applied Courses": {
        "BCA": [
            "2024-2027",
            "2025-2028",
            "2026-2029"
        ],
        "MCA": [
            "2025-2027",
            "2026-2028"
        ],
        "B.Sc Chem/Phy/Math/Food Tech": [
            "2024-2027",
            "2025-2028",
            "2026-2029"
        ],
        "BAJMC": [
            "2024-2027",
            "2025-2028",
            "2026-2029"
        ],
        "M.Sc-FT": [
            "2025-2027",
            "2026-2028"
        ]
    }
};
function updateCourseOptions() {

    courseFilter.innerHTML = `<option value="">All Courses</option>`;

    if (courseData[categoryFilter.value]) {

        courseData[categoryFilter.value].forEach(item => {

            courseFilter.innerHTML += `
                <option value="${item}">
                    ${item}
                </option>
            `;

        });

    }

}

function updateBatchOptions() {

    batchFilter.innerHTML = `<option value="">All Batches</option>`;

    let batches = [];

    if (categoryFilter.value === "Engineering") {

        batches = batchData.Engineering;

    } else if (categoryFilter.value === "Management") {

        batches = batchData.Management[courseFilter.value] || [];

    } else if (categoryFilter.value === "Applied Courses") {

        batches = batchData["Applied Courses"][courseFilter.value] || [];

    }

    batches.forEach(batch => {

        batchFilter.innerHTML += `
            <option value="${batch}">
                ${batch}
            </option>
        `;

    });

}

categoryFilter.addEventListener("change", () => {
    updateCourseOptions();
    updateBatchOptions();
    loadStudents();
});

courseFilter.addEventListener("change", () => {
    updateBatchOptions();
    loadStudents();
});

batchFilter.addEventListener("change", loadStudents);

async function loadStudents(){

    const token = await getValidAdminToken();
    if (!token) {
        table.innerHTML = "";
        return;
    }

    let url = `${BACKEND_URL}/students?`;

    if(categoryFilter.value)
        url += `category=${encodeURIComponent(categoryFilter.value)}&`;

    if(courseFilter.value)
        url += `course=${encodeURIComponent(courseFilter.value)}&`;

    if(batchFilter.value)
        url += `batch=${encodeURIComponent(batchFilter.value)}&`;

    const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.status === 401) {
        // Token missing/expired — clear it and let the next call
        // re-prompt for the password instead of just dead-ending here
        sessionStorage.removeItem("scm_admin_token");
        alert("Session expired. Please log in again.");
        table.innerHTML = "";
        loadStudents();
        return;
    }

    const students = await response.json();

    displayStudents(students);

}

function displayStudents(students){

    table.innerHTML = "";

    const keyword = searchInput.value.toLowerCase();

    students
    .filter(student=>{

        return student.name.toLowerCase().includes(keyword)
        || student.phone.includes(keyword)
        || (student.email || "").toLowerCase().includes(keyword);

    })
    .forEach(student=>{

        table.innerHTML += `
        <tr>
            <td>${student.id}</td>
            <td>${student.name}</td>
            <td>${student.phone}</td>
            <td>${student.email || ""}</td>
            <td>${student.category}</td>
            <td>${student.course}</td>
            <td>${student.batch}</td>
        </tr>
        `;

    });

}

searchInput.addEventListener("keyup", loadStudents);

// --- Export to Excel ---
// Keep a reference to whatever is currently displayed in the table
// (respects active filters + search), so the export matches what you see.
let currentStudents = [];

const originalDisplayStudents = displayStudents;
displayStudents = function(students) {
    const keyword = searchInput.value.toLowerCase();
    currentStudents = students.filter(student =>
        student.name.toLowerCase().includes(keyword)
        || student.phone.includes(keyword)
        || (student.email || "").toLowerCase().includes(keyword)
    );
    originalDisplayStudents(students);
};

document.getElementById("exportBtn").addEventListener("click", () => {

    if (currentStudents.length === 0) {
        alert("No student data to export.");
        return;
    }

    const rows = currentStudents.map(s => ({
        ID: s.id,
        Name: s.name,
        Phone: s.phone,
        Email: s.email,
        Category: s.category,
        Course: s.course,
        Batch: s.batch
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `smart-campus-students-${dateStr}.xlsx`);

});

loadStudents();