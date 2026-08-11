// Create the map
var map = L.map('map').setView([31.3529, 75.4595], 17);

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

// Opens the building info bottom sheet with this location's details,
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
        navigateTo(location.latitude, location.longitude, location);
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
            deptRow.className = "dept-result-row";

            const floorText = dept.floor ? ` — ${dept.floor}` : "";
            deptRow.textContent = `${dept.name}${floorText}`;

            // Clicking a department also just takes you to its building
            deptRow.addEventListener("click", () => {
                goToLocation(location);
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


// Live search: fires on every keystroke, not just button click
searchInput.addEventListener("input", applyFilters);

// Show the full grouped dropdown as soon as the box is clicked/focused,
// even before typing anything
searchInput.addEventListener("focus", () => {
    updateSearchDropdown(searchInput.value.toLowerCase().trim());
});

// Close the dropdown when clicking anywhere outside it
document.addEventListener("click", (e) => {
    if (!searchResultsBox.contains(e.target) && e.target !== searchInput) {
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
                .bindPopup("📍 You are here")
                .openPopup();

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
                // than jumping the view instantly
                map.panTo(newLatLng, {
                    animate: true,
                    duration: duration / 1000
                });

            } else {

                window.userMarker = L.marker([latitude, longitude])
                    .addTo(map)
                    .bindPopup("📍 You are here");

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

function stopLiveTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
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

function navigateTo(lat, lng, destinationLocation) {

    currentDestination = destinationLocation || null;
    hasShownArrivalInfo = false;

    function createRoute(userLat, userLng) {

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

            // Keep the turn-by-turn instructions panel visible and open
            collapsible: false,
            show: true,

            lineOptions: {
                styles: [{ color: '#0d6efd', weight: 6, opacity: 0.8 }]
            }

        }).addTo(map);

        // Hide the loading indicator once the route actually arrives —
        // or if OSRM fails, so it never gets stuck showing forever
        routingControl.on("routesfound", hideRouteLoading);
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