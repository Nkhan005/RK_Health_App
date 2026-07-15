// =========================================================================
// 1. CLOUD API & SYSTEM INITIALIZATION
// =========================================================================
// Replace the string below with your live Google Apps Script Web App URL!
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbxbOlpMMPrgUpiP8GhfVgnxuv9HauGCTLV4Bw4PUTfttvKgdemgvQRcer7_N2g8k0lzhQ/exec";

// Initialize Date timestamp on page load
window.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.innerText = new Date().toLocaleString();
    }
    const currentPin = getSystemPin();
    const hintEl = document.getElementById('pin-hint');
    if (hintEl && currentPin !== "1234") {
        hintEl.innerHTML = `Custom Security PIN Active: <strong>${currentPin}</strong>`;
    }
});

// Retrieve saved PIN from localStorage or default to "1234"
function getSystemPin() {
    return localStorage.getItem("rk_health_pin") || "1234";
}

// =========================================================================
// 2. AUTHENTICATION & PIN MANAGEMENT
// =========================================================================
function handlePinSubmit() {
    const pinInput = document.getElementById('pin-input');
    const enteredPin = pinInput.value.trim();
    const activePin = getSystemPin();

    if (enteredPin === activePin) {
        document.getElementById('lock-screen').classList.add('hidden');
        document.getElementById('app-wrapper').classList.remove('hidden');
        showToast("🔓 Clinical OS Unlocked");
        pinInput.value = "";
    } else {
        alert(`Access Denied: Incorrect PIN! (Hint: Try ${activePin})`);
        pinInput.value = "";
    }
}

// Allow pressing "Enter" key on Lock Screen
document.addEventListener('keypress', function (e) {
    const pinInput = document.getElementById('pin-input');
    if (e.key === 'Enter' && document.activeElement === pinInput) {
        handlePinSubmit();
    }
});

function lockApp() {
    document.getElementById('app-wrapper').classList.add('hidden');
    document.getElementById('lock-screen').classList.remove('hidden');
    showToast("🔒 System Locked");
}

function updateCustomPin() {
    const newPinInput = document.getElementById('new-pin-input');
    const newPin = newPinInput.value.trim();
    
    if (newPin.length !== 4 || isNaN(newPin)) {
        alert("Please enter exactly 4 numbers for your security code!");
        return;
    }

    localStorage.setItem("rk_health_pin", newPin);
    const hintEl = document.getElementById('pin-hint');
    if (hintEl) {
        hintEl.innerHTML = `Custom Security PIN Active: <strong>${newPin}</strong>`;
    }
    newPinInput.value = "";
    showToast("🔐 Security PIN Updated Successfully!");
}

// =========================================================================
// 3. NAVIGATION & UI HELPER FUNCTIONS
// =========================================================================
function switchTab(tabId, navItem) {
    // Hide all tabs and remove active styling from sidebar links
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    
    // Show selected tab and activate sidebar link
    const targetTab = document.getElementById(tabId);
    if (targetTab) {
        targetTab.classList.remove('hidden');
    }
    if (navItem) {
        navItem.classList.add('active');
    }

    // AUTOMATIC REPORT GENERATION: Build the master log when opening Health Report
    if (tabId === 'report-sec') {
        generateMasterReport();
    }
}

function openModal(modalId) { 
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden'); 
}

function closeModal(modalId) { 
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden'); 
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => { 
        toast.classList.add('hidden'); 
    }, 3500);
}

// =========================================================================
// 4. CLOUD DATABASE NETWORK SUBMISSION FUNCTIONS
// =========================================================================

// SCENARIO 1: Create Appointment
async function submitAppointment() {
    const patientName = document.getElementById('apt-patient').value.trim();
    const doctorName = document.getElementById('apt-doctor').value.trim();
    const date = document.getElementById('apt-date').value;
    const time = document.getElementById('apt-time').value;
    const title = document.getElementById('apt-title').value.trim();
    const notes = document.getElementById('apt-notes').value.trim();

    if (!patientName || !doctorName || !date || !time || !title) {
        alert("Please complete all required clinical fields!");
        return;
    }

    showToast("⏳ Encrypting & Transmitting to Google Cloud...");
    closeModal('apt-modal');

    const payload = {
        action: "ADD_APPOINTMENT",
        payload: { patientName, doctorName, date, time, title, notes }
    };

    try {
        const response = await fetch(API_BASE_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (result.status === "success") {
            showToast("✅ Clinical Record Synced! Calendar Link Generated.");
            
            const grid = document.getElementById('appointments-list');
            const emptyState = grid.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const card = document.createElement('div');
            card.className = "card";
            card.innerHTML = `
                <h3>📅 ${title}</h3>
                <p><strong>Patient:</strong> ${patientName} | <strong>Attending:</strong> ${doctorName}</p>
                <p><strong>Scheduled:</strong> ${date} at ${time}</p>
                <p style="color:#94a3b8; font-style:italic;">"${notes || 'No observation notes logged'}"</p>
                <a href="${result.calendarUrl}" target="_blank">➕ Add to Google Calendar</a>
            `;
            grid.prepend(card);
            
            // Clear inputs
            document.getElementById('apt-patient').value = "";
            document.getElementById('apt-doctor').value = "";
            document.getElementById('apt-title').value = "";
            document.getElementById('apt-notes').value = "";
        } else {
            showToast("❌ Sync Error: " + result.message);
        }
    } catch (error) {
        console.error("Network Error:", error);
        showToast("❌ Network Error: Verify API Deployment URL.");
    }
}

// SCENARIO 2: Medication Reminders
async function submitMedication() {
    const medicineName = document.getElementById('med-name').value.trim();
    const dosage = document.getElementById('med-dosage').value.trim();
    const timing = document.getElementById('med-timing').value.trim();
    const phoneNumber = document.getElementById('med-phone').value.trim();

    if (!medicineName || !dosage || !timing) {
        alert("Please complete Medication Name, Dosage, and Timing!");
        return;
    }

    showToast("⏳ Registering Protocol in Database...");
    closeModal('med-modal');

    const payload = {
        action: "ADD_MEDICATION",
        payload: { medicineName, dosage, timing, phoneNumber }
    };

    try {
        const response = await fetch(API_BASE_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (result.status === "success") {
            showToast("💊 Prescription Protocol Logged!");
            
            const grid = document.getElementById('medications-list');
            const emptyState = grid.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const card = document.createElement('div');
            card.className = "card";
            card.style.borderTopColor = "#10b981";
            card.innerHTML = `
                <h3>💊 ${medicineName}</h3>
                <p><strong>Dosage Protocol:</strong> ${dosage}</p>
                <p><strong>Administration:</strong> ${timing}</p>
                <p><strong>Twilio SMS:</strong> ${phoneNumber ? '📱 Active (' + phoneNumber + ')' : '🔕 Inactive'}</p>
            `;
            grid.prepend(card);
            
            // Clear inputs
            document.getElementById('med-name').value = "";
            document.getElementById('med-dosage').value = "";
            document.getElementById('med-timing').value = "";
            document.getElementById('med-phone').value = "";
        } else {
            showToast("❌ Sync Error: " + result.message);
        }
    } catch (error) {
        console.error("Network Error:", error);
        showToast("❌ Network Error: Verify API Deployment URL.");
    }
}

// SCENARIO 3: AI Visit Summaries
async function submitAISummary() {
    const patientName = document.getElementById('ai-patient').value.trim() || "Anonymous Patient";
    const rawNotes = document.getElementById('ai-raw-notes').value.trim();

    if (!rawNotes) {
        alert("Please input clinical notes for neural processing!");
        return;
    }

    showToast("🤖 Transmitting to Llama 3.3 Neural Network...");
    closeModal('ai-modal');

    const payload = {
        action: "GENERATE_SUMMARY",
        payload: { patientName, rawNotes }
    };

    try {
        const response = await fetch(API_BASE_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        if (result.status === "success") {
            showToast("✨ Neural Structuring Complete!");
            
            const grid = document.getElementById('summaries-list');
            const emptyState = grid.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            const card = document.createElement('div');
            card.className = "card";
            card.style.borderTopColor = "#8b5cf6";
            card.innerHTML = `
                <h3>🧠 Neural Summary: ${patientName}</h3>
                <p style="white-space: pre-line; line-height: 1.6; margin-top:12px; background:#090d16; padding:16px; border-radius:8px; border:1px solid #1e293b; color:#e2e8f0;">${result.summary}</p>
                <p style="font-size:11px; color:#475569; margin-top:12px;">Processed via Llama 3.3 70B / Grok Neural Architecture</p>
            `;
            grid.prepend(card);
            
            // Clear inputs
            document.getElementById('ai-raw-notes').value = "";
        } else {
            showToast("❌ Processing Error: " + result.message);
        }
    } catch (error) {
        console.error("Network Error:", error);
        showToast("❌ Network Error: Verify API Deployment URL.");
    }
}

// =========================================================================
// 5. SCENARIO 4: AUTOMATED MASTER REPORT GENERATOR
// =========================================================================
function generateMasterReport() {
    const reportContainer = document.getElementById('report-content');
    if (!reportContainer) return;
    
    // Grab all cards currently displayed in your dashboard
    const appointments = document.querySelectorAll('#appointments-list .card');
    const medications = document.querySelectorAll('#medications-list .card');
    const summaries = document.querySelectorAll('#summaries-list .card');

    // Check if the dashboard is currently empty
    if (appointments.length === 0 && medications.length === 0 && summaries.length === 0) {
        reportContainer.innerHTML = `<p class="loading-text">No patient records logged in this session yet. Add appointments, medications, or AI summaries above to generate the master report!</p>`;
        return;
    }

    // Build a clean HTML summary of all session records
    let html = `<div style="display: flex; flex-direction: column; gap: 24px;">`;

    // 1. Add Appointments Section
    if (appointments.length > 0) {
        html += `<div><h3 style="color:#4facfe; border-bottom:1px solid #1e293b; padding-bottom:8px; margin-bottom:12px;">📅 Active Appointments (${appointments.length})</h3>`;
        appointments.forEach(card => {
            const title = card.querySelector('h3')?.innerText || "Appointment";
            const details = card.querySelectorAll('p');
            html += `<div style="background:#0d121f; padding:14px; border-radius:8px; margin-bottom:8px; border:1px solid #1e293b;">
                <strong style="color:#f8fafc;">${title}</strong>
                <p style="font-size:13px; color:#94a3b8; margin-top:4px;">${details[0]?.innerText || ''} | ${details[1]?.innerText || ''}</p>
            </div>`;
        });
        html += `</div>`;
    }

    // 2. Add Medications Section
    if (medications.length > 0) {
        html += `<div><h3 style="color:#10b981; border-bottom:1px solid #1e293b; padding-bottom:8px; margin-bottom:12px;">💊 Prescriptions & Alerts (${medications.length})</h3>`;
        medications.forEach(card => {
            const title = card.querySelector('h3')?.innerText || "Medication";
            const details = card.querySelectorAll('p');
            html += `<div style="background:#0d121f; padding:14px; border-radius:8px; margin-bottom:8px; border:1px solid #1e293b;">
                <strong style="color:#f8fafc;">${title}</strong>
                <p style="font-size:13px; color:#94a3b8; margin-top:4px;">${details[0]?.innerText || ''} | ${details[1]?.innerText || ''}</p>
            </div>`;
        });
        html += `</div>`;
    }

    // 3. Add AI Summaries Section
    if (summaries.length > 0) {
        html += `<div><h3 style="color:#a855f7; border-bottom:1px solid #1e293b; padding-bottom:8px; margin-bottom:12px;">🧠 Neural Clinical Summaries (${summaries.length})</h3>`;
        summaries.forEach(card => {
            const title = card.querySelector('h3')?.innerText || "AI Summary";
            const summaryText = card.querySelector('p')?.innerText || "";
            html += `<div style="background:#0d121f; padding:14px; border-radius:8px; margin-bottom:8px; border:1px solid #1e293b;">
                <strong style="color:#f8fafc;">${title}</strong>
                <p style="font-size:13px; color:#e2e8f0; margin-top:8px; white-space:pre-line; line-height:1.5;">${summaryText}</p>
            </div>`;
        });
        html += `</div>`;
    }

    html += `</div>`;
    reportContainer.innerHTML = html;
}