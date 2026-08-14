// Create the map
// minZoom/maxZoom + maxBounds keep the map "pinned" to campus — without
// these, a stray pinch gesture can zoom all the way out to the whole
// world or in past useful detail, which felt like the map "flying away".
// maxBoundsViscosity makes the edge feel like a soft wall instead of a
// hard stop, so it doesn't feel broken when you reach it.
var CAMPUS_BOUNDS = L.latLngBounds(
    [31.3450, 75.4480],
    [31.3600, 75.4700]
);

var map = L.map('map', {
    minZoom: 15,
    maxZoom: 19,
    maxBounds: CAMPUS_BOUNDS,
    maxBoundsViscosity: 1.0,
    // Leaflet already handles pinch/drag itself — telling the browser not
    // to also try to pan/zoom the page underneath it stops the map from
    // visually "jumping" when a touch gesture starts.
    tap: true
}).setView([31.3529, 75.4595], 17);

// Keep Leaflet's internal size calculation in sync any time the layout
// actually changes size (address bar show/hide, rotation, etc.) — this
// is what used to make the map look like it was drifting/shifting.
window.addEventListener('resize', () => map.invalidateSize());
window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 250));

// ===== Follow-mode for live tracking =====
// While navigating, the map auto-pans to follow the user. But if the
// user manually drags/pinches the map (e.g. to look ahead), that
// auto-pan should NOT immediately yank the view back — that's what
// made the map feel like it was "shifting on its own" under their
// finger. Follow mode pauses on manual interaction and a small
// recenter button brings it back.
let isFollowingUser = false;

map.on('dragstart', () => {
    if (isFollowingUser) {
        isFollowingUser = false;
        showRecenterBtn();
    }
});

// Small helper: delays calling fn until `wait` ms after the last call —
// used so we don't hit the OSRM routing service on every single keystroke
function debounce(fn, wait) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// Bumped every time a new search-result refinement starts, so an older
// in-flight OSRM request can't overwrite a newer search's results if it
// resolves late (the user kept typing while it was still loading)
let searchRefinementId = 0;

// Add OpenStreetMap tiles
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
// Maps each category to an emoji + color, so buildings close
// together are still visually distinguishable at a glance
const categoryStyles = {
    "Academic":       { emoji: "📚", color: "#0d6efd" },
    "Administration": { emoji: "🏛️", color: "#6f42c1" },
    "Food":           { emoji: "🍴", color: "#fd7e14" },
    "Sports":         { emoji: "🏟️", color: "#198754" },
    "Parking":        { emoji: "🅿️", color: "#6c757d" },
    // Renamed from "Facility" — this is for student-facing services
    // (ATM, courier, etc.), not maintenance/upkeep, so the label and
    // icon (🛎️ service-desk bell) now both match what's tagged here.
    "Service":        { emoji: "🛎️", color: "#20c997" },
    // Facility = physical campus amenities (washrooms, open theatres),
    // separate from Service (ATM/bank/courier/printouts) — real data
    // needed both, so this category is back with its own icon.
    "Facility":       { emoji: "🚻", color: "#0dcaf0" },
    "Auditorium":     { emoji: "🎭", color: "#dc3545" },
    "Entrance":       { emoji: "🚪", color: "#212529" },
    "Hostel":         { emoji: "🛏️", color: "#e83e8c" }
};

// Builds a small colored circle icon with the right emoji for a category
function getCategoryIcon(category) {

    const style = categoryStyles[category] || { emoji: "📍", color: "#0d6efd" };

    return L.divIcon({
        className: 'category-marker',
        html: `<div class="category-marker-inner" style="background:${style.color}">${style.emoji}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13]
    });
}

// Special branded pin for the Main Gate, using the university logo
function getMainGateIcon() {
    return L.divIcon({
        className: 'main-gate-marker',
        html: `<div class="main-gate-marker-inner">
                    <img src="https://ptu.ac.in/wp-content/uploads/2020/05/ptu-logo-transparent.png" alt="IKGPTU">
               </div>`,
        iconSize: [46, 46],
        iconAnchor: [23, 23],
        popupAnchor: [0, -23]
    });
}

// Builds the floor-wise department/office list shown inside a
// building's popup. Buildings without confirmed department data
// (departments: [] or missing) just show their plain description instead.
function buildDepartmentListHTML(location) {

    if (!location.departments || location.departments.length === 0) {
        return "";
    }

    let rows = location.departments.map(dept => {
        const floorText = dept.floor ? ` — ${dept.floor}` : "";
        return `<div class="panel-dept-row">${dept.name}${floorText}</div>`;
    }).join("");

    return rows;

}

// Converts a floor string like "4th & 5th Floor" into a short code like
// "4F-5F", and "Ground Floor" into "GF" — used to build the compact
// pin label. Segments are split on "&" so combined floors (e.g.
// "Ground & 1st Floor") become "GF-1F".
function abbreviateFloor(floorText) {

    if (!floorText) return "";

    return floorText
        .split("&")
        .map(segment => {
            const trimmed = segment.trim();
            if (trimmed.toLowerCase().includes("ground")) return "GF";
            const digitMatch = trimmed.match(/\d+/);
            if (digitMatch) return `${digitMatch[0]}F`;
            return trimmed.toUpperCase();
        })
        .join("-");

}

// Builds the small, all-caps pin label for a building's marker —
// e.g. "ME-GF-1F, ECE-2F-3F, CSE-4F-5F" — from each department's
// short "abbr" (falls back to the full name if abbr isn't set) plus
// its abbreviated floor. Returns "" for buildings with no departments.
function buildPinSummary(location) {

    if (!location.departments || location.departments.length === 0) {
        return "";
    }

    return location.departments
        .map(dept => {
            const label = (dept.abbr || dept.name).toUpperCase();
            const floorCode = abbreviateFloor(dept.floor);
            return floorCode ? `${label}-${floorCode}` : label;
        })
        .join(", ");

}


// replacing the old cramped Leaflet popup. Scales cleanly as more
// departments/floors get added, unlike a fixed-size map popup.
const buildingPanel = document.getElementById("buildingPanel");
const buildingPanelContent = document.getElementById("buildingPanelContent");
const closeBuildingPanelBtn = document.getElementById("closeBuildingPanel");

function openBuildingPanel(location) {

    const isMainGate = location.name === "Main Gate";
    const deptHTML = buildDepartmentListHTML(location);

    buildingPanelContent.innerHTML = `
        <h2>${isMainGate ? "🎓 " : "🏢 "}${location.name}</h2>
        <div class="panel-description">${location.description}</div>
        ${deptHTML}
        <button class="panel-navigate-btn" id="panelNavigateBtn">
            🧭 Navigate Here
        </button>
    `;

    document.getElementById("panelNavigateBtn").addEventListener("click", () => {
        navigateTo(location.latitude, location.longitude, location);
    });

    buildingPanel.classList.add("open");

}

function closeBuildingPanel() {
    buildingPanel.classList.remove("open");
}

if (closeBuildingPanelBtn) {
    closeBuildingPanelBtn.addEventListener("click", closeBuildingPanel);
}

// Store all locations and markers
let allLocations = [];
let markers = [];
let routingControl = null;
let userLocation = null;
let testModeActive = false;
let watchId = null;
let lastRerouteTime = 0;
const REROUTE_INTERVAL_MS = 5000; // recalculate the route at most every 5 seconds

// Average human walking speed, used to make the "you are here" marker
// glide smoothly between GPS updates instead of teleporting/jumping
const AVERAGE_WALKING_SPEED_MPS = 1.4; // ~5 km/h
const MIN_MARKER_ANIMATION_MS = 300;
const MAX_MARKER_ANIMATION_MS = 4000; // caps huge jumps (e.g. GPS glitches)

let markerAnimationFrame = null;

// Tracks the full destination location object (not just lat/lng) for
// the active navigation, so we can show its department/floor info
// again right when the person actually arrives — not just back when
// they first searched for it, which they've likely forgotten by then.
let currentDestination = null;
let hasShownArrivalInfo = false;
const ARRIVAL_THRESHOLD_METERS = 15;

// The map marker currently showing the small pin-label (department +
// floor summary) for whichever building is the active navigation
// destination, so we can clear it when a new navigation starts or the
// current one is cancelled.
let activeDestinationMarker = null;


// Smoothly moves `marker` from its current position to `toLatLng` over
// `durationMs`, instead of snapping instantly — makes the live-tracking
// dot look like it's actually walking rather than teleporting each time
// a new GPS fix comes in.
function animateMarkerTo(marker, toLatLng, durationMs) {

    const fromLatLng = marker.getLatLng();
    const startTime = performance.now();

    if (markerAnimationFrame) {
        cancelAnimationFrame(markerAnimationFrame);
    }

    function step(now) {

        const elapsed = now - startTime;
        const t = Math.min(elapsed / durationMs, 1);

        const lat = fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * t;
        const lng = fromLatLng.lng + (toLatLng.lng - fromLatLng.lng) * t;

        marker.setLatLng([lat, lng]);

        if (t < 1) {
            markerAnimationFrame = requestAnimationFrame(step);
        } else {
            markerAnimationFrame = null;
        }

    }

    markerAnimationFrame = requestAnimationFrame(step);

}


// Load locations from JSON (file lives inside the data/ subfolder)
fetch('data/locations.json')
    .then(response => response.json())
    .then(locations => {

        allLocations = locations;

        // Display all markers initially
        displayMarkers(allLocations);

        // Fix map rendering
        setTimeout(() => {
            map.invalidateSize();
        }, 100);

    })
    .catch(error => console.error(error));


// Function to display markers
function displayMarkers(locations) {

    // Remove old markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    let bounds = [];

    locations.forEach(location => {

        const isMainGate = location.name === "Main Gate";

        let marker = L.marker([
    location.latitude,
    location.longitude
], { icon: isMainGate ? getMainGateIcon() : getCategoryIcon(location.category) })
.addTo(map);

        marker.locationRef = location;

        marker.on("click", () => openBuildingPanel(location));

        markers.push(marker);

        bounds.push([
            location.latitude,
            location.longitude
        ]);

    });

    // Show/hide "no results" message
    const noResultsMsg = document.getElementById("noResults");

    if (locations.length === 0) {
        noResultsMsg.style.display = "block";
    } else {
        noResultsMsg.style.display = "none";
    }

    if (bounds.length > 0) {
        map.fitBounds(bounds);
    }

}


// Quietly get the user's location as soon as the page loads, so
// search results can be sorted by distance right away without
// forcing the user to press "My Location" first.
// (If they deny permission, search just falls back to no sorting —
// nothing breaks.)
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        function(position) {
            userLocation = [position.coords.latitude, position.coords.longitude];
        },
        function(error) {
            console.log("Silent location request failed:", error);
        },
        { enableHighAccuracy: true }
    );
}

// Grab elements
const searchInput = document.getElementById("searchInput");
const checkboxes = document.querySelectorAll(".filters input");
const resetBtn = document.getElementById("resetBtn");


// Combined Search + Filter Function
// This is the single source of truth: it always looks at
// BOTH the current search text AND the currently checked
// categories, and applies both conditions together.
function getSelectedCategories() {
    let selected = [];
    checkboxes.forEach(box => {
        if (box.checked) selected.push(box.value);
    });
    return selected;
}

function applyFilters() {

    let searchText = searchInput.value.toLowerCase().trim();

    let selectedCategories = getSelectedCategories();

    let filtered = allLocations.filter(location => {

        let matchesSearch = matchesLocationOrDepartment(location, searchText);

        let matchesCategory = selectedCategories.includes(location.category);

        return matchesSearch && matchesCategory;

    });

    displayMarkers(filtered);

    // Show the grouped dropdown (Buildings / Departments & Offices)
    updateSearchDropdown(searchText);

}

// Checks if the search text matches the building's own name, OR the
// name of any department/office housed inside it. This is what lets
// someone search "Computer Science" and still find AB-1.
function matchesLocationOrDepartment(location, searchText) {

    if (searchText === "") return true;

    if (location.name.toLowerCase().includes(searchText)) return true;

    if (location.departments) {
        return location.departments.some(dept =>
            dept.name.toLowerCase().includes(searchText)
        );
    }

    return false;

}

const searchResultsBox = document.getElementById("searchResults");

// Converts raw meters into a friendly "120 m" or "1.4 km" string
function formatDistance(meters) {
    if (meters < 1000) {
        return Math.round(meters) + " m away";
    }
    return (meters / 1000).toFixed(1) + " km away";
}

// Figures out how each location matched the search — by its own
// building name, or by one or more department names inside it — so we
// know whether to show the building or the department as the primary
// result. A building-name match (or a browse-all empty search) shows
// the full building card; a department-only match promotes just that
// department to the primary result instead.
function getSearchResultItems(searchText, selectedCategories) {

    const items = [];

    allLocations.forEach(location => {

        if (!selectedCategories.includes(location.category)) return;

        if (searchText === "") {
            items.push({ type: "building", location });
            return;
        }

        const buildingNameMatches = location.name.toLowerCase().includes(searchText);

        if (buildingNameMatches) {
            items.push({ type: "building", location });
            return;
        }

        if (location.departments) {
            location.departments
                .filter(dept => dept.name.toLowerCase().includes(searchText))
                .forEach(dept => {
                    items.push({ type: "department", location, dept });
                });
        }

    });

    return items;

}

function renderSearchResultItem(item, precomputedDistanceText) {
    return item.type === "department"
        ? buildDepartmentResult(item.location, item.dept, precomputedDistanceText)
        : buildBuildingGroup(item.location, precomputedDistanceText);
}

// Builds the dropdown, with each building shown as a header row and
// its departments/offices nested underneath it. This is what lets
// someone see "AB-1 > Computer Science - 4th & 5th Floor" together,
// instead of two disconnected lists.
function updateSearchDropdown(searchText) {

    searchResultsBox.innerHTML = "";

    let selectedCategories = getSelectedCategories();

    let items = getSearchResultItems(searchText, selectedCategories);

    if (items.length === 0) {
        searchResultsBox.style.display = "none";
        map.invalidateSize();
        return;
    }

    // Sort by distance if we know the user's position — straight-line
    // distance first, since it's instant and keeps typing feeling snappy
    if (userLocation) {
        items.sort((a, b) =>
            map.distance(userLocation, [a.location.latitude, a.location.longitude]) -
            map.distance(userLocation, [b.location.latitude, b.location.longitude])
        );
    }

    items.forEach(item => {
        searchResultsBox.appendChild(renderSearchResultItem(item));
    });

    searchResultsBox.style.display = "block";
    map.invalidateSize();

    // Now quietly refine the ordering using REAL walking-route distance
    // (via OSRM) for just the closest few results — straight-line
    // distance can be misleading around buildings, but we don't want to
    // hit the routing service for every single match on every keystroke,
    // so only the top candidates get refined, and only after typing
    // settles for a moment.
    if (userLocation && items.length > 0) {
        debouncedRefineSearchResults(items, searchResultsBox);
    }

}

const debouncedRefineSearchResults = debounce(refineSearchResultsByWalkingDistance, 400);

// Re-sorts the closest few search results by real walking-route distance
// and re-renders. Guarded against stale/out-of-order responses, so if the
// user keeps typing, an older refinement can't clobber newer results.
async function refineSearchResultsByWalkingDistance(items, searchResultsBox) {

    const thisRequestId = ++searchRefinementId;

    const TOP_N = 6;
    const topCandidates = items.slice(0, TOP_N);
    const rest = items.slice(TOP_N);

    try {

        const distances = await Promise.all(
            topCandidates.map(item =>
                getWalkingDistance(userLocation, [item.location.latitude, item.location.longitude])
            )
        );

        // A newer search happened while this was in flight — discard
        if (thisRequestId !== searchRefinementId) return;

        // Sanity check: if OSRM's route is implausibly longer than a
        // straight line (a sign the real shortcut/footpath isn't mapped
        // in OpenStreetMap yet), don't show a misleadingly long number —
        // fall back to straight-line distance for that one spot instead.
        const REALISTIC_ROUTE_RATIO = 2.2;

        const refined = topCandidates
            .map((item, index) => {
                const straightLine = map.distance(userLocation, [item.location.latitude, item.location.longitude]);
                const walking = distances[index];
                const walkingLooksReasonable = walking <= straightLine * REALISTIC_ROUTE_RATIO;

                return {
                    item,
                    distance: walkingLooksReasonable ? walking : straightLine
                };
            })
            .sort((a, b) => a.distance - b.distance);

        searchResultsBox.innerHTML = "";

        refined.forEach(({ item, distance }) => {
            searchResultsBox.appendChild(
                renderSearchResultItem(item, formatDistance(distance))
            );
        });

        rest.forEach(item => {
            searchResultsBox.appendChild(renderSearchResultItem(item));
        });

    } catch (error) {

        // Routing service failed — the straight-line order already
        // rendered above is a perfectly fine fallback, just leave it
        console.log("Search result walking-distance refinement failed, keeping straight-line order:", error);

    }

}

// Builds one result where a DEPARTMENT is the primary/prominent result
// (not the building) — used when someone searches by department name
// directly (e.g. "computer science"), since a new student won't know
// building codes like "AB-1" but will know their department name.
// Clicking still navigates to the parent building's coordinates —
// departments don't have their own separate location.
function buildDepartmentResult(location, dept, precomputedDistanceText) {

    const row = document.createElement("div");
    row.className = "search-result-item department-primary-result";

    let distanceText = "";
    if (precomputedDistanceText) {
        distanceText = `<span class="result-distance">${precomputedDistanceText}</span>`;
    } else if (userLocation) {
        const dist = map.distance(userLocation, [location.latitude, location.longitude]);
        distanceText = `<span class="result-distance">${formatDistance(dist)}</span>`;
    }

    const floorText = dept.floor ? ` — ${dept.floor}` : "";

    row.innerHTML = `
        <div class="result-info">
            <span class="result-name">🎓 ${dept.name}</span>
            <span class="result-subtitle">🏢 ${location.name}${floorText}</span>
            ${distanceText}
        </div>
        <button class="result-navigate-btn">🧭 Navigate</button>
    `;

    row.querySelector(".result-info").addEventListener("click", () => {
        goToLocation(location);
    });

    row.querySelector(".result-navigate-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        searchResultsBox.style.display = "none";
        navigateTo(location.latitude, location.longitude, location, dept);
    });

    return row;

}

// Builds one building "group": a clickable header row (navigates to
// the building) followed by its nested department/office rows
// (informational only — floor + name, no separate navigation).
function buildBuildingGroup(location, precomputedDistanceText) {

    const group = document.createElement("div");
    group.className = "building-group";

    let distanceText = "";
    if (precomputedDistanceText) {
        distanceText = `<span class="result-distance">${precomputedDistanceText}</span>`;
    } else if (userLocation) {
        const dist = map.distance(userLocation, [location.latitude, location.longitude]);
        distanceText = `<span class="result-distance">${formatDistance(dist)}</span>`;
    }

    const header = document.createElement("div");
    header.className = "search-result-item building-header";
    header.innerHTML = `
        <div class="result-info">
            <span class="result-name">🏢 ${location.name}</span>
            <span class="category-tag">${location.category}</span>
            ${distanceText}
        </div>
        <button class="result-navigate-btn">🧭 Navigate</button>
    `;

    header.querySelector(".result-info").addEventListener("click", () => {
        goToLocation(location);
    });

    header.querySelector(".result-navigate-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        searchResultsBox.style.display = "none";
        navigateTo(location.latitude, location.longitude, location);
    });

    group.appendChild(header);

    if (location.departments && location.departments.length > 0) {

        location.departments.forEach(dept => {

            const deptRow = document.createElement("div");
            deptRow.className = "search-result-item dept-result-row";

            const floorText = dept.floor ? ` — ${dept.floor}` : "";
            deptRow.innerHTML = `
                <div class="result-info">
                    <span class="result-name">${dept.name}${floorText}</span>
                </div>
                <button class="result-navigate-btn">🧭 Navigate</button>
            `;

            // Clicking anywhere on the row (or its Navigate button) takes
            // you to the parent building — a department has no coordinates
            // of its own, so this is the correct target either way.
            deptRow.querySelector(".result-info").addEventListener("click", () => {
                goToLocation(location);
            });

            deptRow.querySelector(".result-navigate-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                searchResultsBox.style.display = "none";
                navigateTo(location.latitude, location.longitude, location, dept);
            });

            group.appendChild(deptRow);

        });

    }

    return group;

}

// Jumps the map straight to a location and opens its popup —
// this is what makes search feel like "type, click, done"
function goToLocation(location) {

    map.setView([location.latitude, location.longitude], 19);

    openBuildingPanel(location);

    // Hide the dropdown after a selection is made
    searchResultsBox.style.display = "none";

}


// Builds a flat, alphabetical list of EVERY department/office across ALL
// buildings, regardless of the current search text or category filters.
// This is what powers the "Departments ▾" browse button — someone can
// pick a department straight from the list without typing anything.
function buildAllDepartmentsFlatList() {

    const items = [];

    allLocations.forEach(location => {
        if (!location.departments) return;
        location.departments.forEach(dept => {
            items.push({ location, dept });
        });
    });

    items.sort((a, b) => a.dept.name.localeCompare(b.dept.name));

    return items;

}

function showAllDepartmentsDropdown() {

    searchResultsBox.innerHTML = "";

    const items = buildAllDepartmentsFlatList();

    items.forEach(item => {
        searchResultsBox.appendChild(buildDepartmentResult(item.location, item.dept));
    });

    searchResultsBox.style.display = "block";
    map.invalidateSize();

}

const departmentsDropdownBtn = document.getElementById("departmentsDropdownBtn");

departmentsDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    // Toggle: if the dropdown is already open and showing the
    // department browse list, clicking again closes it.
    const isOpen = searchResultsBox.style.display === "block"
        && searchResultsBox.dataset.mode === "departments-browse";

    if (isOpen) {
        searchResultsBox.style.display = "none";
        return;
    }

    searchInput.value = "";
    searchResultsBox.dataset.mode = "departments-browse";
    showAllDepartmentsDropdown();
});

// Live search: fires on every keystroke, not just button click
searchInput.addEventListener("input", () => {
    searchResultsBox.dataset.mode = "search";
    applyFilters();
});

// Show the full grouped dropdown as soon as the box is clicked/focused,
// even before typing anything
searchInput.addEventListener("focus", () => {
    searchResultsBox.dataset.mode = "search";
    updateSearchDropdown(searchInput.value.toLowerCase().trim());
});

// Close the dropdown when clicking anywhere outside it (but not on the
// Departments browse button itself — that has its own toggle logic)
document.addEventListener("click", (e) => {
    if (
        !searchResultsBox.contains(e.target) &&
        e.target !== searchInput &&
        e.target !== departmentsDropdownBtn
    ) {
        searchResultsBox.style.display = "none";
    }
});

// Keep the button working too (in case someone clicks it)
function searchLocation() {
    applyFilters();
}

// Category filter checkboxes
checkboxes.forEach(box => {
    box.addEventListener("change", applyFilters);
});

// Reset button: clears search text, re-checks all filters,
// shows everything again
function resetAll() {

    searchInput.value = "";
    searchResultsBox.dataset.mode = "search";

    checkboxes.forEach(box => {
        box.checked = true;
    });

    searchResultsBox.style.display = "none";

    applyFilters();

}

resetBtn.addEventListener("click", resetAll);

// Location Button
const locationBtn = document.getElementById("locationBtn");

locationBtn.addEventListener("click", showUserLocation);

function showUserLocation(){

    if(!navigator.geolocation){
        alert("Geolocation is not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition(

        function(position){

            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            userLocation = [latitude, longitude];
            // Remove old user marker if it exists
            if(window.userMarker){
                map.removeLayer(window.userMarker);
            }

            window.userMarker = L.marker([latitude, longitude])
                .addTo(map)
                .bindPopup("")
                .bindTooltip("📍 YOU ARE HERE", {
                    permanent: true,
                    direction: "top",
                    offset: [0, -14],
                    className: "pin-label start-pin-label"
                })
                .openTooltip();

            map.setView([latitude, longitude], 18);

        },

        function(error){

            alert("Unable to fetch your location.");

            console.log(error);

        }

    );

}


// ===== Live location tracking while navigating =====
// Unlike getCurrentPosition() (a single snapshot), watchPosition()
// keeps firing as the user's real-world position changes, so the
// "you are here" marker actually moves as they walk.
function startLiveTracking() {

    if (!navigator.geolocation) {
        alert("Geolocation is not supported.");
        return;
    }

    // Navigation just (re)started — resume following the user
    isFollowingUser = true;
    hideRecenterBtn();

    watchId = navigator.geolocation.watchPosition(

        function(position) {

            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            userLocation = [latitude, longitude];

            const newLatLng = L.latLng(latitude, longitude);

            // Move the existing marker smoothly (at roughly walking
            // speed) instead of instantly snapping to the new GPS fix
            if (window.userMarker) {

                const distance = window.userMarker.getLatLng().distanceTo(newLatLng);
                const duration = Math.min(
                    Math.max((distance / AVERAGE_WALKING_SPEED_MPS) * 1000, MIN_MARKER_ANIMATION_MS),
                    MAX_MARKER_ANIMATION_MS
                );

                animateMarkerTo(window.userMarker, newLatLng, duration);

                // Pan the map in step with the marker's glide, rather
                // than jumping the view instantly — but only while we're
                // actually in follow mode, so it doesn't fight the user
                // if they've manually panned/zoomed to look around.
                if (isFollowingUser) {
                    map.panTo(newLatLng, {
                        animate: true,
                        duration: duration / 1000
                    });
                }

            } else {

                window.userMarker = L.marker([latitude, longitude])
                    .addTo(map)
                    .bindPopup("")
                    .bindTooltip("📍 YOU ARE HERE", {
                        permanent: true,
                        direction: "top",
                        offset: [0, -14],
                        className: "pin-label start-pin-label"
                    })
                    .openTooltip();

                map.setView([latitude, longitude], 18);

            }

            // If navigation is active, recalculate the route from the
            // user's new position (throttled so it doesn't fire on
            // every single GPS update, which would spam the routing
            // server and feel laggy)
            if (routingControl) {

                const now = Date.now();

                if (now - lastRerouteTime > REROUTE_INTERVAL_MS) {

                    lastRerouteTime = now;

                    const waypoints = routingControl.getWaypoints();
                    const destination = waypoints[waypoints.length - 1].latLng;

                    routingControl.setWaypoints([
                        L.latLng(latitude, longitude),
                        destination
                    ]);

                }

            }

            // Detect arrival at the destination building. Outdoor
            // routing (OSRM) has no idea what's inside a building — no
            // floors, no stairs — so once you're physically there, show
            // the department/floor info again right at that moment,
            // instead of relying on someone remembering what the search
            // panel said 10 minutes and one building ago.
            if (currentDestination && !hasShownArrivalInfo) {

                const destinationLatLng = L.latLng(
                    currentDestination.latitude,
                    currentDestination.longitude
                );
                const distanceToDestination = newLatLng.distanceTo(destinationLatLng);

                if (distanceToDestination <= ARRIVAL_THRESHOLD_METERS) {
                    hasShownArrivalInfo = true;
                    showArrivalInfo(currentDestination);
                }

            }

        },

        function(error) {
            console.log(error);
        },

        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        }

    );

}

// Shown once, right when live tracking detects you're actually at the
// destination — reopens the building panel (which already lists every
// department + floor) so that info is in front of you exactly when you
// need it, not just back when you first searched.
function showArrivalInfo(location) {

    openBuildingPanel(location);

    const banner = document.createElement("div");
    banner.className = "arrival-banner";
    banner.textContent = "📍 You've arrived! See department/floor details below.";

    buildingPanelContent.insertBefore(banner, buildingPanelContent.firstChild);

}

// Flashed once, right as navigation starts, so a student heading to a
// department knows the route drops them at the building's entrance —
// not at the department's office door, which routing has no way to
// pinpoint. If the student is already inside/right next to that same
// building (e.g. searching for another department in AB-2 while
// already standing in AB-2), there's no outdoor route to walk, so the
// message tells them to just start from that building's own entrance
// instead. Auto-dismisses after a few seconds.
const SAME_BUILDING_RADIUS_METERS = 50;

function showNavigationStartBanner(destinationLocation, dept, userLat, userLng, destLat, destLng) {

    const existing = document.querySelector(".nav-start-banner");
    if (existing) existing.remove();

    const buildingName = destinationLocation ? destinationLocation.name : "your destination";

    let alreadyThere = false;
    if (userLat != null && userLng != null && destLat != null && destLng != null) {
        alreadyThere = map.distance([userLat, userLng], [destLat, destLng]) <= SAME_BUILDING_RADIUS_METERS;
    }

    // Include the floor whenever we know it, e.g. "Dept. of Management
    // (5th Floor)", so the flash is actually useful once they're inside.
    const deptLabel = dept
        ? (dept.floor ? `${dept.name} (${dept.floor})` : dept.name)
        : null;

    let message;
    if (alreadyThere) {
        message = deptLabel
            ? `📍 You're already at ${buildingName} — start from the ${buildingName} entrance for ${deptLabel}`
            : `📍 You're already at ${buildingName} — start from the ${buildingName} entrance`;
    } else {
        message = deptLabel
            ? `🚩 Head to the entrance of ${buildingName} — ${deptLabel} is inside`
            : `🚩 Head to the entrance of ${buildingName}`;
    }

    const banner = document.createElement("div");
    banner.className = "nav-start-banner";
    banner.textContent = message;

    document.body.appendChild(banner);

    setTimeout(() => {
        banner.classList.add("fade-out");
        setTimeout(() => banner.remove(), 400);
    }, 4500);

}

function stopLiveTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isFollowingUser = false;
    hideRecenterBtn();
}

function showRecenterBtn() {
    const btn = document.getElementById("recenterBtn");
    if (btn) btn.classList.add("visible");
}

function hideRecenterBtn() {
    const btn = document.getElementById("recenterBtn");
    if (btn) btn.classList.remove("visible");
}


function showRouteLoading(text) {
    const indicator = document.getElementById("routeLoadingIndicator");
    const textEl = document.getElementById("routeLoadingText");
    if (!indicator) return;
    if (textEl && text) textEl.textContent = text;
    indicator.classList.add("visible");
}

function hideRouteLoading() {
    const indicator = document.getElementById("routeLoadingIndicator");
    if (indicator) indicator.classList.remove("visible");
}

function navigateTo(lat, lng, destinationLocation, dept) {

    currentDestination = destinationLocation || null;
    hasShownArrivalInfo = false;

    // Clear the pin-label from a previous destination before showing
    // the new one, so old labels don't pile up on the map.
    if (activeDestinationMarker) {
        activeDestinationMarker.closeTooltip();
        activeDestinationMarker.unbindTooltip();
        activeDestinationMarker = null;
    }

    if (destinationLocation) {

        const destMarker = markers.find(m => m.locationRef === destinationLocation);
        const pinSummary = buildPinSummary(destinationLocation);

        if (destMarker && pinSummary) {
            destMarker.bindTooltip(pinSummary, {
                permanent: true,
                direction: "top",
                offset: [0, -14],
                className: "pin-label dest-pin-label"
            }).openTooltip();
            activeDestinationMarker = destMarker;
        }

    }

    function createRoute(userLat, userLng) {

        showNavigationStartBanner(destinationLocation, dept, userLat, userLng, lat, lng);

        showRouteLoading("Calculating route...");

        // Remove previous route
        if (routingControl) {
            map.removeControl(routingControl);
        }

        routingControl = L.Routing.control({

            waypoints: [
                L.latLng(userLat, userLng),
                L.latLng(lat, lng)
            ],

            // Walking directions (footpaths), not car/driving routes
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1',
                profile: 'foot'
            }),

            routeWhileDragging: false,
            draggableWaypoints: false,
            addWaypoints: false,

            // We build our own compact directions card (see below) instead
            // of the default Leaflet panel, which was a big, always-open
            // list that ate a lot of the map. The default container is
            // hidden with CSS but Leaflet still needs `show:true`/
            // `collapsible:false` internally to keep computing instructions.
            collapsible: false,
            show: true,

            lineOptions: {
                styles: [{ color: '#0d6efd', weight: 6, opacity: 0.8 }]
            }

        }).addTo(map);

        // Hide the loading indicator once the route actually arrives —
        // or if OSRM fails, so it never gets stuck showing forever
        routingControl.on("routesfound", (e) => {
            hideRouteLoading();
            renderDirections(e.routes[0]);
        });
        routingControl.on("routingerror", () => {
            hideRouteLoading();
            console.log("Routing error — showing whatever route state is available.");
        });

        // Save current location
        userLocation = [userLat, userLng];

        // Reset the reroute timer so live tracking doesn't wait
        // 10 seconds before it's allowed to reroute for the first time
        lastRerouteTime = Date.now();

        // Start following the user's live position
        startLiveTracking();
    }

    // If location is already available
    if (userLocation) {
        createRoute(userLocation[0], userLocation[1]);
        return;
    }

    // Otherwise ask browser for location
    showRouteLoading("Finding your location...");

    navigator.geolocation.getCurrentPosition(

        function(position) {

            createRoute(
                position.coords.latitude,
                position.coords.longitude
            );

        },

        function() {

            hideRouteLoading();
            alert("Unable to get your location.");

        }

    );

}

async function findNearest(category) {

    if (!userLocation) {
        alert("Please click 📍 My Location first.");
        return;
    }

    // Get only locations of the selected category
    let places = allLocations.filter(location =>
        location.category === category
    );

    if (places.length === 0) {
        alert("No " + category + " found.");
        return;
    }

    // Find the nearest place using REAL walking-route distance,
    // not straight-line distance (which can be misleading around buildings)
    let nearest = places[0];
    let minDistance = Infinity;

    // If OSRM's route is implausibly longer than a straight line, the
    // real shortcut probably isn't mapped in OpenStreetMap yet — use
    // straight-line distance for that place instead of trusting a
    // misleadingly long route.
    const REALISTIC_ROUTE_RATIO = 2.2;

    try {

        const distances = await Promise.all(
            places.map(place =>
                getWalkingDistance(userLocation, [place.latitude, place.longitude])
            )
        );

        distances.forEach((walkingDistance, index) => {
            const place = places[index];
            const straightLine = map.distance(userLocation, [place.latitude, place.longitude]);
            const distance = walkingDistance <= straightLine * REALISTIC_ROUTE_RATIO
                ? walkingDistance
                : straightLine;

            if (distance < minDistance) {
                minDistance = distance;
                nearest = place;
            }
        });

    } catch (error) {

        // Fallback: if the routing service fails, use straight-line
        // distance so the feature still works, just less precisely
        console.log("Walking-distance check failed, using straight-line fallback:", error);

        places.forEach(place => {
            let distance = map.distance(userLocation, [place.latitude, place.longitude]);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = place;
            }
        });

    }

    // Zoom to nearest place
    map.setView([nearest.latitude, nearest.longitude], 18);

    // Show its info in the bottom sheet
    openBuildingPanel(nearest);

    // Automatically start navigation
    navigateTo(nearest.latitude, nearest.longitude, nearest);

    // For Food specifically, also offer off-campus restaurant options
    // from the same button — no need for a separate one
    if (category === "Food") {
        const wantsOffCampus = confirm("Also see nearby restaurants off-campus (Google Maps)?");
        if (wantsOffCampus) {
            findNearbyRestaurants();
        }
    }

}

// Asks OSRM for the real walking-route distance (in meters) between two points
async function getWalkingDistance(from, to) {
    const url = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=false`;
    const response = await fetch(url);
    const data = await response.json();
    return data.routes[0].distance;
}

// Opens Google Maps' own restaurant search centered on the user's
// location — this covers off-campus places without needing a paid
// Places API key, which would be overkill for this project
function findNearbyRestaurants() {

    if (!userLocation) {
        alert("Please click 📍 My Location first (or use Test Mode).");
        return;
    }

    const lat = userLocation[0];
    const lng = userLocation[1];

    const url = `https://www.google.com/maps/search/restaurants/@${lat},${lng},15z`;

    window.open(url, "_blank");

}

function openAssistant(){

    document.getElementById("assistantPanel").style.display="block";

}

function closeAssistant(){

    document.getElementById("assistantPanel").style.display="none";

}

function assistantAction(action){

    closeAssistant();

    if(action === "study"){

        findNearest("Academic");

    }

}

// Open Admin Panel
function openAdmin(){

    document.getElementById("adminPanel").style.display="block";

}

// Close Admin Panel
// NOTE: index.html's #closeAdmin button no longer has an inline onclick,
// so this is the single source of truth for closing the panel.
document.getElementById("closeAdmin").onclick = function(){

    document.getElementById("adminPanel").style.display = "none";

}

function generateJSON() {

    const newLocation = {
        name: document.getElementById("adminName").value,
        category: document.getElementById("adminCategory").value,
        description: document.getElementById("adminDescription").value,
        latitude: Number(document.getElementById("adminLatitude").value),
        longitude: Number(document.getElementById("adminLongitude").value)
    };

    const jsonBox = document.getElementById("generatedJson");

    jsonBox.value += JSON.stringify(newLocation, null, 4) + ",\n\n";

    // Clear the form for the next entry
    document.getElementById("adminName").value = "";
    document.getElementById("adminDescription").value = "";
    document.getElementById("adminLatitude").value = "";
    document.getElementById("adminLongitude").value = "";
}

function captureLocation() {

    if (!navigator.geolocation) {
        alert("Geolocation is not supported.");
        return;
    }

    navigator.geolocation.getCurrentPosition(

        function(position) {

            document.getElementById("adminLatitude").value =
                position.coords.latitude;

            document.getElementById("adminLongitude").value =
                position.coords.longitude;

        },

        function(error) {

            alert("Location access denied or unavailable.");

            console.log(error);

        }

    );

}

function cancelNavigation() {

    if (routingControl) {

        map.removeControl(routingControl);

        routingControl = null;

    }

    // Stop following the user's live position once navigation ends
    stopLiveTracking();

    // Clear the destination pin-label too
    if (activeDestinationMarker) {
        activeDestinationMarker.closeTooltip();
        activeDestinationMarker.unbindTooltip();
        activeDestinationMarker = null;
    }

    hideDirections();

}

// ===== Compact turn-by-turn directions card =====
// Replaces Leaflet Routing Machine's default panel — that panel is a
// permanently-open list of every step, which is big enough to cover
// most of the map. This shows just the next step (icon + instruction +
// distance) in a small card that sits in the empty space at the top of
// the map, with a minimize toggle and an expand-to-full-list option.

let allDirectionSteps = [];
let directionsMinimized = false;

// Maps OSRM/Leaflet instruction types to a simple arrow/icon so the
// card reads at a glance instead of needing to parse a sentence.
function iconForInstruction(instruction) {

    const type = (instruction.type || "").toLowerCase();
    const modifier = (instruction.modifier || "").toLowerCase();
    const text = (instruction.text || "").toLowerCase();
    const combined = type + " " + modifier + " " + text;

    if (combined.includes("depart") || combined.includes("head")) return "🏁";
    if (combined.includes("arrive") || combined.includes("destination")) return "🎉";
    if (combined.includes("roundabout")) return "🔄";
    if (combined.includes("sharp left")) return "↰";
    if (combined.includes("sharp right")) return "↱";
    if (combined.includes("slight left")) return "↖️";
    if (combined.includes("slight right")) return "↗️";
    if (combined.includes("left")) return "⬅️";
    if (combined.includes("right")) return "➡️";
    if (combined.includes("uturn") || combined.includes("u-turn") || combined.includes("turn around")) return "↩️";
    if (combined.includes("straight") || combined.includes("continue")) return "⬆️";

    return "⬆️";

}

// "734" -> "730 m", "1834" -> "1.8 km"
function formatDistance(meters) {
    if (meters == null) return "";
    if (meters >= 1000) return (meters / 1000).toFixed(1) + " km";
    return Math.round(meters / 10) * 10 + " m";
}

function renderDirections(route) {

    if (!route || !route.instructions || route.instructions.length === 0) return;

    allDirectionSteps = route.instructions;

    const card = document.getElementById("directionsCard");
const reopenBtn = document.getElementById("directionsReopenBtn");

if (!card) return;

card.classList.remove("closed");
card.classList.add("visible");

if (reopenBtn) {
    reopenBtn.classList.remove("visible");
}

updateCurrentStep(0);

    // Total distance/time summary, shown in both the compact and
    // minimized states
    const totalDistance = formatDistance(route.summary && route.summary.totalDistance);
    const totalMinutes = route.summary ? Math.max(1, Math.round(route.summary.totalTime / 60)) : null;
    const summaryEl = document.getElementById("directionsSummaryText");
    if (summaryEl) {
        summaryEl.textContent = totalMinutes
            ? `${totalDistance} · ${totalMinutes} min`
            : totalDistance;
    }

    // Full step list, for the "view all steps" expanded sheet
    const list = document.getElementById("directionsStepsList");
    if (list) {
        list.innerHTML = "";
        route.instructions.forEach((step, i) => {
            const row = document.createElement("div");
            row.className = "directions-step-row";
            row.innerHTML = `
                <span class="directions-step-row-icon">${iconForInstruction(step)}</span>
                <span class="directions-step-row-text">${step.text || "Continue"}</span>
                <span class="directions-step-row-distance">${formatDistance(step.distance)}</span>
            `;
            list.appendChild(row);
        });
    }

}

function updateCurrentStep(index) {

    if (!allDirectionSteps[index]) return;

    const step = allDirectionSteps[index];

    const iconEl = document.getElementById("directionsIcon");
    const textEl = document.getElementById("directionsInstruction");
    const distEl = document.getElementById("directionsDistance");

    if (iconEl) iconEl.textContent = iconForInstruction(step);
    if (textEl) textEl.textContent = step.text || "Continue";
    if (distEl) distEl.textContent = formatDistance(step.distance);

}

function hideDirections() {
    const card = document.getElementById("directionsCard");
    const sheet = document.getElementById("directionsSheet");
    const reopenBtn = document.getElementById("directionsReopenBtn");

    if (card) {
        card.classList.remove("visible", "minimized", "closed");
    }

    if (sheet) {
        sheet.classList.remove("open");
    }

    if (reopenBtn) {
        reopenBtn.classList.remove("visible");
    }

    directionsMinimized = false;
    allDirectionSteps = [];
}

function toggleDirectionsMinimized() {
    directionsMinimized = !directionsMinimized;

    const card = document.getElementById("directionsCard");

    if (card) {
        card.classList.toggle("minimized", directionsMinimized);
    }
}
function closeDirectionsCard() {
    const card = document.getElementById("directionsCard");
    const sheet = document.getElementById("directionsSheet");
    const reopenBtn = document.getElementById("directionsReopenBtn");

    if (card) {
        card.classList.remove("visible", "minimized");
        card.classList.add("closed");
    }

    if (sheet) {
        sheet.classList.remove("open");
    }

    if (reopenBtn) {
        reopenBtn.classList.add("visible");
    }
}

function reopenDirectionsCard() {
    const card = document.getElementById("directionsCard");
    const reopenBtn = document.getElementById("directionsReopenBtn");

    if (card && allDirectionSteps.length > 0) {
        card.classList.remove("closed");
        card.classList.add("visible");
    }

    if (reopenBtn) {
        reopenBtn.classList.remove("visible");
    }
}

function openDirectionsSheet() {
    const sheet = document.getElementById("directionsSheet");

    if (sheet && allDirectionSteps.length > 0) {
        sheet.classList.add("open");
    }
}

function closeDirectionsSheet() {
    const sheet = document.getElementById("directionsSheet");
    if (sheet) sheet.classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {

    const recenterBtn = document.getElementById("recenterBtn");
    if (recenterBtn) recenterBtn.addEventListener("click", recenterMap);
    const expandBtn = document.getElementById("directionsExpandBtn");

if (expandBtn) {
    expandBtn.addEventListener("click", openDirectionsSheet);
}


const minimizeBtn = document.getElementById("directionsMinimizeBtn");

if (minimizeBtn) {
    minimizeBtn.addEventListener("click", toggleDirectionsMinimized);
}


const closeBtn = document.getElementById("directionsCloseBtn");

if (closeBtn) {
    closeBtn.addEventListener("click", closeDirectionsCard);
}


const reopenBtn = document.getElementById("directionsReopenBtn");

if (reopenBtn) {
    reopenBtn.addEventListener("click", reopenDirectionsCard);
}


const sheetCloseBtn = document.getElementById("directionsSheetClose");

if (sheetCloseBtn) {
    sheetCloseBtn.addEventListener("click", closeDirectionsSheet);
}


const compassBadge = document.getElementById("compassBadge");

if (compassBadge) {
    // Tapping the badge is what satisfies iOS's "must be a user gesture"
    // requirement for the permission prompt, and also opens the dial.
    compassBadge.addEventListener("click", () => {
        startCompass();
        toggleCompassExpanded();
    });
    // On Android/desktop this just works immediately with no prompt;
    // on iOS it's a no-op until the user taps (handled above).
    startCompass();
}

const compassExpandedClose = document.getElementById("compassExpandedClose");

if (compassExpandedClose) {
    compassExpandedClose.addEventListener("click", (e) => {
        e.stopPropagation();
        closeCompassExpanded();
    });
}

});

function toggleCompassExpanded() {
    const panel = document.getElementById("compassExpanded");
    if (panel) panel.classList.toggle("visible");
}

function closeCompassExpanded() {
    const panel = document.getElementById("compassExpanded");
    if (panel) panel.classList.remove("visible");
}

// --- Live compass: rotates the small needle in the directions card so
// it always points true north as the phone turns. Uses the device's
// orientation sensor (magnetometer), same as the browser Compass API. ---
let compassActive = false;

function handleOrientation(event) {
    let heading;

    if (typeof event.webkitCompassHeading === "number") {
        // iOS Safari gives a ready-to-use compass heading directly.
        heading = event.webkitCompassHeading;
    } else if (typeof event.alpha === "number") {
        // Android / other browsers: alpha counts counter-clockwise from
        // north, so flip it to get a clockwise compass heading.
        heading = 360 - event.alpha;
    } else {
        return;
    }

    heading = (heading + 360) % 360;

    const needle = document.getElementById("compassNeedle");
    if (needle) needle.style.transform = `rotate(${-heading}deg)`;

    const needleLg = document.getElementById("compassExpandedNeedle");
    if (needleLg) needleLg.style.transform = `rotate(${-heading}deg)`;
}

function startCompass() {
    if (compassActive) return;

    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
        // iOS 13+ requires this to be called from a user gesture (the tap
        // on the compass badge), which is why we also wire it to a click
        // handler below instead of only calling it on page load.
        DeviceOrientationEvent.requestPermission()
            .then(state => {
                if (state === "granted") {
                    window.addEventListener("deviceorientation", handleOrientation, true);
                    compassActive = true;
                } else {
                    console.log("Compass permission denied.");
                }
            })
            .catch(err => console.log("Compass permission error:", err));
    } else if ("ondeviceorientationabsolute" in window) {
        // Most Android browsers: absolute heading, no permission prompt needed.
        window.addEventListener("deviceorientationabsolute", handleOrientation, true);
        compassActive = true;
    } else if (typeof DeviceOrientationEvent !== "undefined") {
        window.addEventListener("deviceorientation", handleOrientation, true);
        compassActive = true;
    } else {
        console.log("Compass not supported on this device/browser.");
    }
}

function recenterMap() {
    isFollowingUser = true;
    hideRecenterBtn();
    if (window.userMarker) {
        map.setView(window.userMarker.getLatLng(), Math.max(map.getZoom(), 18), { animate: true });
    }
}
// ===== One-click Install (Android/Chrome) =====
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function(e) {
    // Stop Chrome's default mini-banner so we can show our own button instead
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('installBtn').style.display = 'inline-block';
});

document.getElementById('installBtn').addEventListener('click', function() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function() {
            deferredInstallPrompt = null;
            document.getElementById('installBtn').style.display = 'none';
        });
    }
});

// ===== iPhone/Safari install hint =====
// Apple doesn't allow any website to trigger an install prompt —
// this just guides iPhone users through Apple's required manual steps
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandaloneMode = window.navigator.standalone === true;

if (isIOS && !isInStandaloneMode) {
    const iosBanner = document.createElement('div');
    iosBanner.className = 'ios-install-banner';
    iosBanner.innerHTML = `📲 To install: tap <b>Share</b> then <b>"Add to Home Screen"</b> <span class="ios-banner-close">✕</span>`;
    document.body.appendChild(iosBanner);

    iosBanner.querySelector('.ios-banner-close').addEventListener('click', function() {
        iosBanner.remove();
    });
}

// ===== TEMPORARY: TEST MODE — DELETE THIS WHOLE SECTION BEFORE FINAL SUBMISSION =====
// Lets you click anywhere on the map to pretend that's your location,
// so you can test Nearest/Navigate from home. Turn OFF before using
// on real campus GPS, or the fake click-location will override real GPS.

function toggleTestMode() {

    testModeActive = !testModeActive;

    const btn = document.getElementById("testModeBtn");

    if (testModeActive) {
        map.on('click', handleTestClick);
        btn.textContent = "🧪 Test Mode: ON (click map)";
        btn.style.background = "#dc3545";
    } else {
        map.off('click', handleTestClick);
        btn.textContent = "🧪 Test Mode: OFF";
        btn.style.background = "";
        userLocation = null;
        if (window.userMarker) {
            map.removeLayer(window.userMarker);
            window.userMarker = null;
        }
    }

}

function handleTestClick(e) {

    const latitude = e.latlng.lat;
    const longitude = e.latlng.lng;
    userLocation = [latitude, longitude];

    if (window.userMarker) {
        window.userMarker.setLatLng([latitude, longitude]);
        window.userMarker.setPopupContent(`🧪 Test location<br>Lat: ${latitude}<br>Lng: ${longitude}`);
        window.userMarker.openPopup();
    } else {
        window.userMarker = L.marker([latitude, longitude])
            .addTo(map)
            .bindPopup(`🧪 Test location<br>Lat: ${latitude}<br>Lng: ${longitude}`)
            .openPopup();
    }

    // Auto-fill the Admin Panel's coordinate fields so you don't
    // have to manually copy-paste them — just fill in name/description
    // and click Generate JSON
    document.getElementById("adminLatitude").value = latitude;
    document.getElementById("adminLongitude").value = longitude;

}
// ===== END TEMPORARY TEST MODE SECTION =====