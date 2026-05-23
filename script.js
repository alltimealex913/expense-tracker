// ==========================================================================
// 1. FIREBASE CONFIGURATION & INITIALIZATION
// ==========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyD6Onj91Xgvn164HNANiWOEPndArwIV0uk",
  authDomain: "expense-tracker-43dad.firebaseapp.com",
  projectId: "expense-tracker-43dad",
  storageBucket: "expense-tracker-43dad.firebasestorage.app",
  messagingSenderId: "488863929251",
  appId: "1:488863929251:web:93e8c9b9ddb9a9912b4016",
  measurementId: "G-180R39DZN3"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// --- SYSTEM STATE VARIABLES ---
let globalCalendar = null;
let expenseChart = null;
let trendChart = null;
let currentUid = null;
let isLoginView = true;
let selectedEditId = null;
let currentView = 'month';
let allExpenses = [];
let localBudgets = [];

// ==========================================================================
// 2. SESSION MONITOR (AUTH LIFECYCLE)
// ==========================================================================
auth.onAuthStateChanged(user => {
    const loader = document.getElementById('loading-screen');
    const authBox = document.getElementById('auth-container');
    const dashBox = document.getElementById('dashboard-container');

    if (user && user.emailVerified) {
        currentUid = user.uid;
        document.getElementById('user-display').innerText = user.email;
        if (loader) loader.style.display = 'none';
        if (authBox) authBox.style.display = 'none';
        if (dashBox) dashBox.style.display = 'block';
        
        // Swabe at ligtas na trigger para sa mga dashboards at database listeners
        setTimeout(() => { 
            initDashboard(user.uid); 
            initFinancialHub(); 
        }, 150);
    } else {
        if (loader) loader.style.display = 'none';
        if (authBox) authBox.style.display = 'flex';
        if (dashBox) dashBox.style.display = 'none';
    }
});

// ==========================================================================
// 3. AUTHENTICATION HANDLERS
// ==========================================================================
async function handleAuth() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) return alert("Please fill in all fields.");

    try {
        if (isLoginView) {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            if (!userCredential.user.emailVerified) {
                alert("Account not yet verified. Check your email.");
                await auth.signOut();
                return;
            }
        } else {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            await userCredential.user.sendEmailVerification();
            await auth.signOut();
            alert("Registration successful! Please check your email and click the verification link before logging in.");
            isLoginView = true;
            toggleAuth(); 
        }
    } catch (e) { alert("Error: " + e.message); }
}

function toggleAuth() {
    isLoginView = !isLoginView;
    document.getElementById('auth-title').innerText = isLoginView ? "Welcome Back" : "Register";
    document.getElementById('main-btn').innerText = isLoginView ? "Login" : "Register Account";
}

function logout() { 
    auth.signOut(); 
}

async function forgotPassword() {
    const email = document.getElementById('email').value.trim();
    if (!email) return alert("Please enter your email address first in the input field above.");
    try {
        await auth.sendPasswordResetEmail(email);
        alert("Password reset link sent! Please check your inbox or spam folder.");
    } catch (e) { alert("Error: " + e.message); }
}

function getUserId() {
    const user = auth.currentUser;
    return user ? user.uid : null;
}

// ==========================================================================
// 4. CORE DASHBOARD & CALENDAR INITIALIZATION
// ==========================================================================
function initDashboard(uid) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    calendarEl.innerHTML = ''; 

    globalCalendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        height: 'auto',
        headerToolbar: { 
            left: 'prev,next today', 
            center: 'title', 
            right: '' 
        },
        datesSet: function() { 
            refreshSummary(); 
            if (typeof updateTrendChart === "function") {
                updateTrendChart(); 
            }
        },
        dateClick: (info) => {
            const now = new Date();
            const todayLocal = now.getFullYear() + '-' + 
                               String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                               String(now.getDate()).padStart(2, '0');

            if (info.dateStr > todayLocal) {
                return alert("You can only add new expenses up to the present date.");
            }
            openModalForAdd(info.dateStr);
        },
        windowResize: function(view) {
            globalCalendar.updateSize();
        }
    });

    globalCalendar.render();

    // Real-time Core Expense Listener
    db.collection("expenses").where("uid", "==", uid)
    .onSnapshot(snapshot => {
        allExpenses = [];
        let dailyOutflowTotals = {};
        snapshot.forEach(doc => {
            const d = { id: doc.id, ...doc.data() };
            allExpenses.push(d);

            if (d.type === "outflow" || !d.type) { 
                dailyOutflowTotals[d.date] = (dailyOutflowTotals[d.date] || 0) + d.amount;
            }
        });

        let newEvents = Object.entries(dailyOutflowTotals).map(item => ({
            title: `₱${item[1].toLocaleString()}`,
            start: item[0],
            display: 'block',
            allDay: true
        }));

        if(globalCalendar) {
            globalCalendar.removeAllEventSources();
            globalCalendar.addEventSource(newEvents);
        }
        refreshSummary();
        updateTrendChart();
    });
}

// ==========================================================================
// 5. SUMMARY CALCULATIONS & SIDEPANEL RANKING CHARTS
// ==========================================================================
function changeView(view) {
    currentView = view;
    document.getElementById('btn-month').classList.toggle('active', view === 'month');
    document.getElementById('btn-year').classList.toggle('active', view === 'year');
    refreshSummary();
}

function refreshSummary() {
    if (!globalCalendar) return;
    const viewDate = globalCalendar.getDate(); 
    const targetMonth = viewDate.getMonth();
    const targetYear = viewDate.getFullYear();

    let totalInflow = 0;
    let totalOutflow = 0;
    let catTotals = {}; 

    allExpenses.forEach(exp => {
        const d = new Date(exp.date);
        const isSameYear = d.getFullYear() === targetYear;
        const isSameMonth = d.getMonth() === targetMonth;
        let include = (currentView === 'month') ? (isSameYear && isSameMonth) : (isSameYear);

        if (include) {
            if (exp.type === "inflow") {
                totalInflow += exp.amount;
            } else {
                totalOutflow += exp.amount;
                catTotals[exp.category] = (catTotals[exp.category] || 0) + exp.amount;
            }
        }
    });

    document.getElementById('inflow-display').innerText = "₱" + totalInflow.toLocaleString();
    document.getElementById('outflow-display').innerText = "₱" + totalOutflow.toLocaleString();
    document.getElementById('savings-display').innerText = "₱" + (totalInflow - totalOutflow).toLocaleString();
    
    updateSidebarUI(catTotals);
    renderBudgetStatus(catTotals);
}

function updateSidebarUI(catTotals) {
    const list = document.getElementById('ranking-list');
    if(!list) return;
    list.innerHTML = "";
    
    const inflowCategories = ["Salary", "Allowance", "Business"];
    const filteredCatEntries = Object.entries(catTotals).filter(([category]) => {
        return !inflowCategories.includes(category);
    });

    const sorted = filteredCatEntries.sort((a,b) => b[1] - a[1]);
    let labels = [], values = [];
    
    sorted.forEach(item => {
        labels.push(item[0]); 
        values.push(item[1]);
        list.innerHTML += `<li><span>${item[0]}</span><b>₱${item[1].toLocaleString()}</b></li>`;
    });

    const canvas = document.getElementById('expenseChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if(expenseChart) expenseChart.destroy();
    
    expenseChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{ 
                data: values, 
                backgroundColor: ['#e74c3c','#e67e22','#f1c40f','#9b59b6','#3498db','#27ae60','#1abc9c','#34495e','#7f8c8d','#d35400'] 
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
            }
        }
    });
}

function updateTrendChart() {
    const canvas = document.getElementById('trendChart');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!globalCalendar) return;
    const activeYear = globalCalendar.getDate().getFullYear();
    
    let monthlyOutflow = new Array(12).fill(0);
    let monthlyInflow = new Array(12).fill(0);

    allExpenses.forEach(exp => {
        const d = new Date(exp.date);
        if (d.getFullYear() === activeYear) {
            const monthIndex = d.getMonth();
            if (exp.type === "inflow") monthlyInflow[monthIndex] += exp.amount;
            else if (exp.type === "outflow" || !exp.type) monthlyOutflow[monthIndex] += exp.amount;
        }
    });

    if (trendChart) trendChart.destroy();
    
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: [
                {
                    label: `Total Spending (Outflow)`,
                    data: monthlyOutflow,
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    borderWidth: 3, tension: 0.3, fill: true,
                    pointBackgroundColor: '#2c3e50', pointBorderColor: '#e74c3c', pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7
                },
                {
                    label: `Total Earnings (Inflow)`,
                    data: monthlyInflow,
                    borderColor: '#0892f4',
                    backgroundColor: 'rgba(39, 174, 96, 0.1)',
                    borderWidth: 3, tension: 0.3, fill: true,
                    pointBackgroundColor: '#2c3e50', pointBorderColor: '#0892f4', pointBorderWidth: 2, pointRadius: 5, pointHoverRadius: 7
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return '₱' + value.toLocaleString(); } } } }
        }
    });
}

// ==========================================================================
// 6. TRANSACTION MODAL FUNCTIONS (EXPENSES & INFLOWS)
// ==========================================================================
const modal = document.getElementById('expenseModal');
function closeModal() { if(modal) modal.style.display = 'none'; selectedEditId = null; }

function openModalForAdd(date) {
    if(!modal) return;
    modal.style.display = 'block';
    document.getElementById('modal-title').innerText = "Add Expense";
    document.getElementById('modal-date').innerText = date;
    document.getElementById('modal-amount').value = "";
    document.getElementById('modal-action-buttons').innerHTML = `<button onclick="saveExpense('${date}')" class="btn-save">Save Record</button>`;
    loadHistory(date);
}

async function saveExpense(date) {
    const amount = parseFloat(document.getElementById('modal-amount').value);
    const cat = document.getElementById('modal-category').value;
    const payMode = document.getElementById('modal-payment').value;
    
    if(!amount) return alert("Please enter amount.");

    const payload = {
        uid: currentUid,
        amount: amount,
        category: cat,
        paymentMode: payMode || "Cash", 
        type: "outflow",
        date: date || document.getElementById('modal-date').innerText,
        time: new Date().toLocaleTimeString('en-GB'),
        timestamp: Date.now()
    };

    if(selectedEditId) await db.collection("expenses").doc(selectedEditId).update(payload);
    else await db.collection("expenses").add(payload);
    closeModal();
}

function resetCategoryToExpenses() {
    const catSelect = document.getElementById('modal-category');
    if (!catSelect) return;
    catSelect.innerHTML = `
        <option value="Food">Food</option><option value="Transportation">Transportation</option>
        <option value="Grocery">Grocery</option><option value="Shopping">Shopping</option>
        <option value="Load">Load</option><option value="Laundry">Laundry</option>
        <option value="Rent">Rent</option><option value="Bills">Bills</option>
        <option value="Medical Expenses">Medical Expenses</option><option value="Savings">Savings</option><option value="Family">Family</option><option value="Others">Others</option>`;
}

function openInflowModal() {
    let targetDate = new Date().toISOString().split('T')[0]; 
    if (globalCalendar) {
        const viewDate = globalCalendar.getDate();
        const year = viewDate.getFullYear();
        const month = String(viewDate.getMonth() + 1).padStart(2, '0');
        targetDate = `${year}-${month}-01`; 
    }
    
    if(!modal) return;
    modal.style.display = 'block';
    
    document.getElementById('modal-title').innerText = "Add Inflow (Income)";
    document.getElementById('modal-date').innerText = targetDate;
    document.getElementById('modal-amount').value = "";
    
    document.getElementById('modal-category').innerHTML = `
        <option value="Salary">Salary</option>
        <option value="Allowance">Allowance</option>
        <option value="Business">Business</option>
        <option value="Others">Others</option>`;
    
    document.getElementById('modal-action-buttons').innerHTML = 
        `<button onclick="saveInflow()" class="btn-save" style="background:#27ae60">Save Inflow</button>`;
}

async function saveInflow() {
    const amountVal = document.getElementById('modal-amount').value;
    const amount = parseFloat(amountVal);
    const cat = document.getElementById('modal-category').value;
    const payMode = document.getElementById('modal-payment').value;
    const date = document.getElementById('modal-date').innerText;

    if (!amount || isNaN(amount)) return alert("Please enter a valid amount.");

    const payload = {
        uid: currentUid,
        amount: amount,
        category: cat,
        paymentMode: payMode || "Cash",
        type: "inflow",
        date: date,
        time: new Date().toLocaleTimeString('en-GB'),
        timestamp: Date.now()
    };

    try {
        if (selectedEditId) await db.collection("expenses").doc(selectedEditId).update(payload);
        else await db.collection("expenses").add(payload);
        
        resetCategoryToExpenses();
        closeModal();
    } catch (e) { alert("Error saving: " + e.message); }
}

async function loadHistory(date) {
    const hList = document.getElementById('modal-day-expenses');
    if(!hList) return;
    hList.innerHTML = "Loading...";
    
    const snap = await db.collection("expenses")
        .where("uid", "==", currentUid)
        .where("date", "==", date)
        .get();
        
    hList.innerHTML = snap.empty ? "No records." : "";
    let docs = [];
    snap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));

    docs.sort((a, b) => b.timestamp - a.timestamp).forEach(d => {
        const li = document.createElement('li');
        li.style.padding = "10px"; 
        li.style.borderBottom = "1px solid #eee";
        li.style.cursor = "pointer";

        const isInf = d.type === "inflow";
        const color = isInf ? "#27ae60" : "#e74c3c";
        const typeLabel = isInf ? "[INFLOW]" : "[EXPENSE]";

        li.innerHTML = `
            <small>${d.time} | ${d.paymentMode || 'Cash'}</small><br>
            <b style="color:${color}">${typeLabel} ${d.category}</b>: ₱${d.amount.toLocaleString()}
        `;

        li.onclick = () => {
            selectedEditId = d.id;
            if (isInf) {
                document.getElementById('modal-title').innerText = "Edit Inflow";
                document.getElementById('modal-category').innerHTML = `
                    <option value="Salary">Salary</option><option value="Allowance">Allowance</option>
                    <option value="Business">Business</option><option value="Others">Others</option>`;
                
                document.getElementById('modal-action-buttons').innerHTML = `
                    <button onclick="saveInflow()" class="btn-save" style="background:#27ae60">Update Inflow</button>
                    <button onclick="deleteExp('${d.id}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:5px; width:100%; border-radius:8px; cursor:pointer;">Delete</button>
                `;
            } else {
                document.getElementById('modal-title').innerText = "Edit Expense";
                resetCategoryToExpenses();
                document.getElementById('modal-action-buttons').innerHTML = `
                    <button onclick="saveExpense()" class="btn-save">Update Expense</button>
                    <button onclick="deleteExp('${d.id}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:5px; width:100%; border-radius:8px; cursor:pointer;">Delete</button>
                `;
            }

            document.getElementById('modal-amount').value = d.amount;
            document.getElementById('modal-category').value = d.category;
            document.getElementById('modal-payment').value = d.paymentMode || "Cash";
            document.getElementById('modal-date').innerText = d.date;
        };
        hList.appendChild(li);
    });
}

async function deleteExp(id) { if(confirm("Are you sure?")) { await db.collection("expenses").doc(id).delete(); closeModal(); } }

// ==========================================================================
// 7. BUDGET THRESHOLD SYSTEM
// ==========================================================================
function openBudgetModal() {
    if(!modal) return;
    modal.style.display = 'block';
    document.getElementById('modal-title').innerText = "Set Category Budget";
    document.getElementById('modal-date').innerText = "Monthly Threshold Settings";
    document.getElementById('modal-amount').value = "";
    resetCategoryToExpenses();

    document.getElementById('modal-action-buttons').innerHTML = 
        `<button onclick="saveBudget()" class="btn-save" style="background:#27ae60;">Save Budget Threshold</button>`;
}

async function saveBudget() {
    const amount = parseFloat(document.getElementById('modal-amount').value);
    const cat = document.getElementById('modal-category').value;
    if (!amount || isNaN(amount)) return alert("Please enter a valid budget amount.");

    try {
        const budgetId = `${currentUid}_${cat}`;
        await db.collection("budgets").doc(budgetId).set({
            uid: currentUid, category: cat, amount: amount, timestamp: Date.now()
        });
        closeModal();
        refreshSummary(); 
    } catch (e) { alert("Error saving budget: " + e.message); }
}

async function renderBudgetStatus(catTotals) {
    const container = document.getElementById('budget-monitoring-list');
    if (!container) return;

    const snapshot = await db.collection("budgets").where("uid", "==", currentUid).get();
    if (snapshot.empty) {
        container.innerHTML = `<p style="color: gray; text-align: center; font-size: 0.9em;">No budgets set. Click '+ Set Budget Threshold' to start.</p>`;
        return;
    }

    container.innerHTML = ""; 
    const currentMonthIndex = new Date().getMonth() + 1;

    snapshot.forEach(doc => {
        const b = doc.data();
        const actualSpend = catTotals[b.category] || 0;
        let effectiveBudget = b.amount;
        let labelSuffix = "(Monthly)";

        if (currentView === 'year') {
            effectiveBudget = b.amount * currentMonthIndex;
            labelSuffix = `(YTD: ${currentMonthIndex} mos)`;
        }

        let percentage = (actualSpend / effectiveBudget) * 100;
        const displayPercent = Math.min(percentage, 100).toFixed(0);
        
        let barColor = "#27ae60"; 
        if (percentage >= 100) barColor = "#e74c3c";
        else if (percentage >= 80) barColor = "#e67e22";

        const itemDiv = document.createElement('div');
        itemDiv.className = "budget-item";
        itemDiv.style.cssText = "margin-bottom: 15px; padding: 12px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; transition: 0.2s;";
        
        itemDiv.onclick = () => {
            openBudgetModal();
            document.getElementById('modal-title').innerText = "Edit Budget";
            document.getElementById('modal-category').value = b.category;
            document.getElementById('modal-amount').value = b.amount;

            document.getElementById('modal-action-buttons').innerHTML = `
                <button onclick="saveBudget()" class="btn-save" style="background:#2c3e50">Update</button>
                <button onclick="deleteBudget('${b.category}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:10px; width:100%; border-radius:8px; cursor:pointer; font-weight:bold;">Delete Threshold</button>
            `;
        };

        itemDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9em;">
                <span><b>${b.category}</b> <small style="color:gray;">${labelSuffix} (₱${actualSpend.toLocaleString()} / ₱${effectiveBudget.toLocaleString()})</small></span>
                <span style="font-weight:bold; color:${barColor}">${displayPercent}%</span>
            </div>
            <div style="background: #eee; height: 10px; border-radius: 5px; overflow: hidden;">
                <div style="width: ${displayPercent}%; background: ${barColor}; height: 100%; transition: width 0.5s;"></div>
            </div>
            <div style="text-align: right; font-size: 10px; color: #95a5a6; margin-top: 5px;">Click to Edit Monthly Cap</div>
        `;
        container.appendChild(itemDiv);
    });
}

async function deleteBudget(category) {
    if (confirm(`Are you sure you want to remove the budget for ${category}?`)) {
        try {
            const budgetId = `${currentUid}_${category}`;
            await db.collection("budgets").doc(budgetId).delete();
            closeModal();
            refreshSummary(); 
        } catch (e) { alert("Error deleting budget: " + e.message); }
    }
}

// ==========================================================================
// 8. FINANCIAL HUB MODULE (BANKS & CREDIT CARDS WITH FIRESTORE)
// ==========================================================================
function initFinancialHub() {
    const userId = getUserId();
    if (!userId) return;

    // Patakbuhin ang real-time snap-stream listeners
    listenToBanks(userId);
    listenToCreditCards(userId);
}

// --- BANK ACCOUNT MANAGEMENT ---
function openAddBankModal() {
    // Ligtas na pag-clear ng inputs kung exist sila sa HTML
    const bankNameInput = document.getElementById('bank-name') || document.getElementById('bankName');
    const bankBalanceInput = document.getElementById('bank-balance') || document.getElementById('bankBalance');
    
    if (bankNameInput) bankNameInput.value = "";
    if (bankBalanceInput) bankBalanceInput.value = "";
    
    const bankModal = document.getElementById('bankModal') || document.getElementById('bank-modal');
    if (bankModal) {
        const saveBtn = bankModal.querySelector('button');
        if (saveBtn) {
            saveBtn.style.background = "#27ae60";
            saveBtn.style.color = "white";
            saveBtn.style.border = "none";
            saveBtn.style.padding = "12px";
            saveBtn.style.width = "100%";
            saveBtn.style.borderRadius = "8px";
            saveBtn.style.cursor = "pointer";
            saveBtn.style.fontWeight = "bold";
        }
        bankModal.style.display = 'block';
    } else {
        alert("The Bank Modal element cannot be found in the HTML. Please check its ID and ensure it is correctly defined.");
    }
}

function closeBankModal() {
    const bankModal = document.getElementById('bankModal') || document.getElementById('bank-modal');
    if (bankModal) {
        bankModal.style.display = 'none';
    } else {
        console.warn("Warning: Bank modal element not found during close execution.");
    }
}

function saveBank() {
    // 1. Kuhanin ang kasalukuyang User ID session
    const userId = getUserId();
    if (!userId) {
        alert("Your session has expired. Please log in again to continue.");
        return;
    }

    // 2. Flexible ID Selection - Hahanapin nito kung kebab-case o camelCase ang gamit mo sa HTML
    const nameEl = document.getElementById('bank-name') || document.getElementById('bankName');
    const balanceEl = document.getElementById('bank-balance') || document.getElementById('bankBalance');

    // Safety check kung sakaling wala sa DOM ang mga input elements
    if (!nameEl || !balanceEl) {
        console.error("Critical Error: Bank input elements ('bank-name'/'bankName' or 'bank-balance'/'bankBalance') missing from DOM.");
        alert("System error: Missing form elements. Please contact administrator.");
        return;
    }

    // 3. I-sanitize at i-parse ang mga inputs
    const name = nameEl.value.trim();
    const balance = parseFloat(balanceEl.value);

    // Validation guard clause para iwas blanko o maling data type sa Firestore
    if (!name || isNaN(balance)) {
        alert("Please enter a valid Bank Name and initial Balance.");
        return;
    }

    // 4. Gumawa ng human-readable timestamp para sa unang linya ng Ledger History log
    const timestamp = new Date().toLocaleString('en-US', { 
        hour: 'numeric', 
        minute: 'numeric', 
        hour12: true, 
        year: 'numeric', 
        month: 'numeric', 
        day: 'numeric' 
    });

    // 5. I-save na sa Firestore Database sub-collection
    db.collection("users").doc(userId).collection("banks").add({
        name: name,
        balance: balance,
        // Gumagawa agad ng initial history array para may entry ka na sa ledger logs mo agad
        history: [{ date: timestamp, amount: balance }], 
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        // Isara ang modal kapag tapos na ang operation
        closeBankModal();
        alert("Bank account linked successfully!");
        
        // I-clear ang mga input fields para handa sa susunod na entry
        nameEl.value = "";
        balanceEl.value = "";
    })
    .catch((error) => {
        console.error("Firestore Bank persistence failed: ", error);
        alert("An error occurred while saving the bank account: " + error.message);
    });
}

function listenToBanks(userId) {
    db.collection("users").doc(userId).collection("banks")
        .onSnapshot((snapshot) => {
            const container = document.getElementById('banks-display-list');
            if (!container) return;

            if (snapshot.empty) {
                container.innerHTML = `
                    <div class="bank-mini-box" style="grid-column: span 2; text-align: center; color: gray; font-size: 0.9em;">
                        No bank accounts linked yet.
                    </div>`;
                return;
            }

            // HIGHEST TO LOWEST RE-ARRANGEMENT
            const sortedDocs = snapshot.docs.sort((a, b) => {
                const balA = Number(a.data().balance) || 0;
                const balB = Number(b.data().balance) || 0;
                return balB - balA; 
            });

            let html = "";
            sortedDocs.forEach((doc) => {
                const bank = doc.data();
                const bankId = doc.id;
                const safeName = bank.name.replace(/'/g, "\\'");

                html += `
                    <div class="bank-mini-box" style="padding: 12px; border: 1px solid #eee; border-radius: 8px; background: #fff; position: relative; margin-bottom: 8px;">
                        <div style="font-size: 0.8em; color: #64748b; font-weight: bold; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
                            <span>${bank.name}</span>
                            <span onclick="toggleBankMenu(event, '${bankId}')" style="color: #e74c3c; font-size: 0.85em; cursor: pointer; padding: 2px 6px; background: #fdf2f2; border-radius: 4px;">Manage</span>
                        </div>
                        <div style="font-size: 1.2em; font-weight: bold; color: #2c3e50; margin-top: 4px;">
                            ₱${bank.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>

                        <div id="menu-${bankId}" class="bank-action-menu" style="display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e2e8f0; gap: 6px; justify-content: space-between;">
                            <button onclick="executeBankAction('${bankId}', '${safeName}', ${bank.balance}, '1')" style="flex: 1; background: #eff6ff; color: #2563eb; border: none; padding: 6px; font-size: 0.75em; font-weight: bold; border-radius: 4px; cursor: pointer;">History</button>
                            <button onclick="executeBankAction('${bankId}', '${safeName}', ${bank.balance}, '2')" style="flex: 1; background: #f0fdf4; color: #16a34a; border: none; padding: 6px; font-size: 0.75em; font-weight: bold; border-radius: 4px; cursor: pointer;">Update</button>
                            <button onclick="executeBankAction('${bankId}', '${safeName}', ${bank.balance}, '3')" style="flex: 1; background: #fef2f2; color: #dc2626; border: none; padding: 6px; font-size: 0.75em; font-weight: bold; border-radius: 4px; cursor: pointer;">Delete</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        });
}

// Function para mag-slide down o mag-toggle 'yung buttons sa loob ng card nang walang pop-up
function toggleBankMenu(event, bankId) {
    event.stopPropagation(); // Iwasan ang hindi sinasadyang pag-click sa labas
    
    // Isara muna lahat ng ibang bukas na menu para malinis tingnan
    document.querySelectorAll('.bank-action-menu').forEach(menu => {
        if (menu.id !== `menu-${bankId}`) menu.style.display = 'none';
    });

    const targetMenu = document.getElementById(`menu-${bankId}`);
    if (targetMenu) {
        if (targetMenu.style.display === 'none' || targetMenu.style.display === '') {
            targetMenu.style.display = 'flex'; // Ipakita ang History, Update, Delete buttons
        } else {
            targetMenu.style.display = 'none'; // Itago ulit
        }
    }
}

// Heto ang taga-proseso ng aksyon base sa button na pinindot mo sa loob ng card, bes
function executeBankAction(bankId, currentName, currentBalance, action) {
    const userId = getUserId();
    if (!userId) return;

    // ACTION 1: VIEW HISTORY (Diretso bukas sa existing modal mo, walang pop-up)
    if (action === "1") {
        db.collection("users").doc(userId).collection("banks").doc(bankId).get().then(doc => {
            if(doc.exists) {
                const bankData = doc.data();
                const historyList = bankData.history || [];
                
                document.getElementById('history-modal-title').innerText = `History for ${bankData.name}`;
                
                const tableBody = document.getElementById('history-modal-table-body');
                if (!tableBody) return;

                if (historyList.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:gray; padding:15px;">No logs recorded yet.</td></tr>`;
                } else {
                    let rowsHtml = "";
                    [...historyList].reverse().forEach(h => {
                        rowsHtml += `
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 10px; color: #334155;">${h.date}</td>
                                <td style="padding: 10px; text-align: right; font-weight: bold; color: #27ae60;">
                                    ₱${h.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </td>
                            </tr>
                        `;
                    });
                    tableBody.innerHTML = rowsHtml;
                }
                document.getElementById('bankHistoryModal').style.display = 'flex';
            }
        }).catch(err => console.error("Error fetching history: ", err));
    } 
    // ACTION 2: UPDATE BALANCE (Dito lang gagamit ng maliit na prompt para sa bagong halaga)
    // ACTION 2: UPDATE BALANCE
    // ACTION 2: UPDATE BALANCE
    else if (action === "2") {
        const newBalance = parseFloat(prompt(`Enter new balance for ${currentName}:`, currentBalance));
        if (isNaN(newBalance)) return; 

        const timestamp = new Date().toLocaleString('en-US', { 
            hour: 'numeric', 
            minute: 'numeric', 
            hour12: true, 
            year: 'numeric', 
            month: 'numeric', 
            day: 'numeric' 
        });
        
        // 1. Kuhanin muna ang document para makuha ang kasalukuyang history array nang matipid sa request
        db.collection("users").doc(userId).collection("banks").doc(bankId).get().then((doc) => {
            let historyLog = [];
            if (doc.exists) {
                historyLog = doc.data().history || [];
            }
            
            // I-push ang bagong entry sa history copy
            historyLog.push({ date: timestamp, amount: newBalance });

            // 2. Gumamit ng simpleng .update() imbes na mabigat na runTransaction
            return db.collection("users").doc(userId).collection("banks").doc(bankId).update({
                balance: newBalance,
                history: historyLog,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        })
        .then(() => {
            alert("Balance updated successfully!");
            // Isara ang menu panel ng card pagkatapos mag-save
            const targetMenu = document.getElementById(`menu-${bankId}`);
            if (targetMenu) targetMenu.style.display = 'none';
        })
        .catch(err => {
            console.error("Update failed: ", err);
            if (err.message.includes("quota") || err.message.includes("429")) {
                alert("Naka-quota block pa ang Firebase mo bes dahil sa 'Too Many Requests'. Subukan muli mamaya o bukas kapag nag-reset ang free tier limits mo.");
            } else {
                alert("Error updating balance: " + err.message);
            }
        });
    }
    // ACTION 3: DELETE BANK ACCOUNT
    else if (action === "3") {
        if (confirm(`Are you sure you want to delete the ${currentName}? The ledger history will also be deleted.`)) {
            db.collection("users").doc(userId).collection("banks").doc(bankId).delete()
                .then(() => alert("Bank account removed!"))
                .catch(err => alert("Error deleting: " + err.message));
        }
    }
}

function closeHistoryModal() {
    document.getElementById('bankHistoryModal').style.display = 'none';
}

// --- CREDIT CARD MANAGEMENT ---
function openAddCreditCardModal() {
    // Ligtas na pag-clear ng inputs kung exist sila sa HTML
    const ccNameInput = document.getElementById('cc-name') || document.getElementById('ccName');
    const ccDueDateInput = document.getElementById('cc-due-date') || document.getElementById('ccDueDate');
    const ccAmountInput = document.getElementById('cc-amount') || document.getElementById('ccAmount');
    
    if (ccNameInput) ccNameInput.value = "";
    if (ccDueDateInput) ccDueDateInput.value = "";
    if (ccAmountInput) ccAmountInput.value = "";
    
    const ccModal = document.getElementById('creditCardModal') || document.getElementById('credit-card-modal');
    if (ccModal) {
        const saveBtn = ccModal.querySelector('button');
        if (saveBtn) {
            saveBtn.style.background = "#27ae60";
            saveBtn.style.color = "white";
            saveBtn.style.border = "none";
            saveBtn.style.padding = "12px";
            saveBtn.style.width = "100%";
            saveBtn.style.borderRadius = "8px";
            saveBtn.style.cursor = "pointer";
            saveBtn.style.fontWeight = "bold";
        }
        ccModal.style.display = 'block';
    } else {
        alert("The Credit Card Modal element cannot be found in the HTML. Please check its ID and ensure it is correctly defined.");
    }
}

function closeCreditCardModal() {
    const ccModal = document.getElementById('creditCardModal') || document.getElementById('credit-card-modal') || document.getElementById('add-card-modal');
    if (ccModal) ccModal.style.display = 'none';

    // Ibalik ang text at function ng button sa default "Save Statement" para sa normal na pag-add
    const modalButton = document.querySelector('#creditCardModal button');
    if (modalButton) {
        modalButton.innerText = "Save Statement";
        modalButton.setAttribute("onclick", "saveCreditCard()");
    }
    
    selectedEditId = null; // I-clear ang tracker ID
}

// Binago ang pangalan ng function para tumugma sa tinatawag ng HTML Modal natin!
function saveCreditCard() {
    const userId = getUserId();
    if (!userId) {
        alert("Your session has expired. Please log in again to continue.");
        return;
    }

    // 1. Kuhanin ang mga Form Inputs gamit ang flexible ID matching para iwas 'null' errors
    const nameEl = document.getElementById('cc-name') || document.getElementById('ccName');
    const dueDateEl = document.getElementById('cc-due-date') || document.getElementById('ccDueDate');
    const amountEl = document.getElementById('cc-amount') || document.getElementById('ccAmount');
    const statusEl = document.getElementById('cc-status') || document.getElementById('ccStatus');

    // 2. Structural safety verification check
    if (!nameEl || !dueDateEl || !amountEl || !statusEl) {
        console.error("Critical Error: One or more HTML elements for the Credit Card form could not be found.");
        alert("There appears to be an issue with the UI binding. Please check your HTML IDs and ensure they are correctly configured.");
        return;
    }

    // 3. Extract at linisin ang mga values galing sa input fields
    const name = nameEl.value.trim();
    const dueDate = dueDateEl.value;
    const amount = parseFloat(amountEl.value);
    
    // Siguraduhing laging lowercase ang status para mag-match sa conditional styling natin sa table
    const status = statusEl.value.toLowerCase().trim(); 

    // 4. Form validation validation check
    if (!name || !dueDate || isNaN(amount)) {
        alert("Please complete the card details, including the Name, Due Date, and the correct Amount.");
        return;
    }

    // 5. I-save na ang malinis na data diretso sa Firestore subcollection
    db.collection("users").doc(userId).collection("creditCards").add({
        name: name,
        dueDate: dueDate,
        amount: amount,
        status: status, // Dito na papasok kung 'paid' o 'pending' ang pinili mo sa dropdown
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        // Successful save pipeline
        closeCreditCardModal();
        alert("Credit Card statement tracked successfully!");
        
        // I-reset ang fields para malinis sa susunod na pag-add
        nameEl.value = "";
        dueDateEl.value = "";
        amountEl.value = "";
        statusEl.value = "pending"; // Ibalik sa default selection na pending
    })
    .catch((error) => {
        console.error("Firestore Credit Card persistence failed: ", error);
        alert("An error occurred while saving to the database. Please check the console for more details.");
    });
}

function toggleCardStatus(cardId, currentStatus) {
    const userId = getUserId();
    if (!userId) return;

    const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid';

    db.collection("users").doc(userId).collection("creditCards").doc(cardId).update({
        status: nextStatus
    });
}

// --- UPDATED CREDIT CARD MANAGEMENT WITH 5-LIMIT & FULL HISTORY ---

// 1. REAL-TIME SNAPSHOT LISTENER (5 LATEST ONLY FOR DASHBOARD)
function listenToCreditCards(userId) {
    db.collection("users").doc(userId).collection("creditCards")
        .orderBy("dueDate", "desc")
        .limit(5) // Selyado! 5 latest statements lang ang hahatakin nito para sa dashboard view
        .onSnapshot((snapshot) => {
            const container = document.getElementById('credit-cards-display-list') || document.getElementById('creditCardsDisplayList');
            if (!container) return;

            if (snapshot.empty) {
                container.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: gray; font-size: 0.9em; padding: 20px;">
                            No credit card statements tracked at the moment.
                        </td>
                    </tr>`;
                return;
            }

            let html = "";
            snapshot.forEach((doc) => {
                const card = doc.data();
                const cardId = doc.id;
                const safeName = card.name.replace(/'/g, "\\'");
                const currentStatus = (card.status || 'pending').toLowerCase().trim();

                const isPaid = currentStatus === 'paid';
                const badgeBgColor = isPaid ? '#d1fae5' : '#fee2e2';
                const badgeTextColor = isPaid ? '#065f46' : '#991b1b';

                html += `
                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.2s;">
                        <td style="padding: 12px 8px; font-weight: 600; color: #1e293b; max-width: 150px; word-wrap: break-word;">${card.name}</td>
                        <td style="padding: 12px 8px; color: #64748b; font-family: monospace; font-size: 1em;">${card.dueDate}</td>
                        <td style="padding: 12px 8px; font-weight: 700; color: #1e293b;">₱${card.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td style="padding: 12px 8px;">
                            <span class="status-badge ${currentStatus}" 
                                  style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 0.75em; font-weight: bold; text-align: center; min-width: 65px; letter-spacing: 0.5px; text-transform: uppercase; background-color: ${badgeBgColor}; color: ${badgeTextColor}; user-select: none;">
                                ${currentStatus}
                            </span>
                        </td>
                        <td style="padding: 12px 8px; text-align: center;">
                            <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                                <button onclick="editCreditCard('${cardId}', '${safeName}', '${card.dueDate}', ${card.amount}, '${currentStatus}')" 
                                        style="cursor: pointer; border: none; font-weight: bold; font-size: 0.8em; padding: 6px 16px; border-radius: 6px; background-color: #eff6ff; color: #2563eb; letter-spacing: 0.5px; font-family: sans-serif;">
                                    EDIT
                                </button>
                                <button onclick="deleteCreditCard('${cardId}', '${safeName}')" 
                                        style="cursor: pointer; border: none; font-weight: bold; font-size: 0.8em; padding: 6px 12px; border-radius: 6px; background-color: #fef2f2; color: #dc2626; letter-spacing: 0.5px; font-family: sans-serif;">
                                    DELETE
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });
            container.innerHTML = html;
        }, (error) => {
            console.error("Firestore Credit Card Real-time Sync Error: ", error);
        });
}

// 2. NEW FUNCTION: OPEN FULL STATEMENT HISTORY MODAL
async function openCreditCardHistoryModal() {
    const userId = getUserId();
    if (!userId) return alert("Session expired. Please log in again.");

    // Buksan ang modal display wrapper para sa Credit Card History
    const historyModal = document.getElementById('ccHistoryModal') || document.getElementById('cc-history-modal');
    if (!historyModal) {
        return alert("Hindi mahanap ang ccHistoryModal element sa HTML mo, bes! Paki-add ang modal container.");
    }
    historyModal.style.display = 'flex';

    const tableBody = document.getElementById('cc-history-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:gray;">Loading all statements...</td></tr>`;

    try {
        // Hahatakin lahat nang walang limit para sa history modal view mo
        const snapshot = await db.collection("users").doc(userId).collection("creditCards")
            .orderBy("dueDate", "desc")
            .get();

        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:gray;">No statements recorded yet.</td></tr>`;
            return;
        }

        let html = "";
        snapshot.forEach((doc) => {
            const card = doc.data();
            const cardId = doc.id;
            const safeName = card.name.replace(/'/g, "\\'");
            const currentStatus = (card.status || 'pending').toLowerCase().trim();

            const isPaid = currentStatus === 'paid';
            const badgeBgColor = isPaid ? '#d1fae5' : '#fee2e2';
            const badgeTextColor = isPaid ? '#065f46' : '#991b1b';

            html += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px 10px; font-weight: 600; color: #334155;">${card.name}</td>
                    <td style="padding: 12px 10px; color: #64748b; font-family: monospace;">${card.dueDate}</td>
                    <td style="padding: 12px 10px; font-weight: 700; color: #334155;">₱${card.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td style="padding: 12px 10px;">
                        <span style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 0.75em; font-weight: bold; text-transform: uppercase; background-color: ${badgeBgColor}; color: ${badgeTextColor};">
                            ${currentStatus}
                        </span>
                    </td>
                    <td style="padding: 12px 10px; text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center;">
                            <button onclick="closeCcHistoryModal(); editCreditCard('${cardId}', '${safeName}', '${card.dueDate}', ${card.amount}, '${currentStatus}')" 
                                    style="cursor: pointer; border: none; font-weight: bold; font-size: 0.75em; padding: 5px 12px; border-radius: 4px; background-color: #eff6ff; color: #2563eb;">
                                EDIT
                            </button>
                            <button onclick="deleteCreditCard('${cardId}', '${safeName}'); closeCcHistoryModal();" 
                                    style="cursor: pointer; border: none; font-weight: bold; font-size: 0.75em; padding: 5px 10px; border-radius: 4px; background-color: #fef2f2; color: #dc2626;">
                                DEL
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        tableBody.innerHTML = html;

    } catch (error) {
        console.error("Error loading CC history: ", error);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red; padding:20px;">Failed to load data.</td></tr>`;
    }
}

function closeCcHistoryModal() {
    const historyModal = document.getElementById('ccHistoryModal') || document.getElementById('cc-history-modal');
    if (historyModal) historyModal.style.display = 'none';
}

// Global Window Screen Overlay Adjustment para isama ang bagong Modal

function editCreditCard(cardId, name, dueDate, amount, status) {
    // 1. Hanapin ang mga Form Inputs sa loob ng modal
    const nameEl = document.getElementById('cc-name') || document.getElementById('ccName');
    const dueDateEl = document.getElementById('cc-due-date') || document.getElementById('ccDueDate');
    const amountEl = document.getElementById('cc-amount') || document.getElementById('ccAmount');
    const statusEl = document.getElementById('cc-status') || document.getElementById('ccStatus');

    if (!nameEl || !dueDateEl || !amountEl || !statusEl) {
        console.error("Critical Error: Unable to locate the input elements in the Edit Modal.");
        return;
    }

    // 2. I-pasa ang mga kasalukuyang data ng card sa loob ng mga fields
    nameEl.value = name;
    dueDateEl.value = dueDate;
    amountEl.value = amount;
    
    // I-set ang dropdown value base sa kasalukuyang status ng card ('paid' o 'pending')
    statusEl.value = (status || 'pending').toLowerCase().trim();

    // 3. I-save ang kasalukuyang ID ng ine-edit natin sa isang global variable
    selectedEditId = cardId; 

    // 4. Palitan ang text ng Save button sa modal para alam mong "Update" ang gagawin (Opsyonal pero mas malinis tingnan)
    const modalButton = document.querySelector('#creditCardModal button');
    if (modalButton) {
        modalButton.innerText = "Update Statement";
        // Baguhin ang onclick handler para tumakbo ang update function imbes na add function
        modalButton.setAttribute("onclick", "updateCreditCard()");
    }

    // 5. Buksan na ang modal display
    const ccModal = document.getElementById('creditCardModal') || document.getElementById('credit-card-modal') || document.getElementById('add-card-modal');
    if (ccModal) ccModal.style.display = 'block';
}

function updateCreditCard() {
    const userId = getUserId();
    if (!userId) return alert("Your session has expired. Please log in again to continue.");
    if (!selectedEditId) return alert("No card statement has been selected for editing. Please select a card statement first before proceeding.");

    // 1. Kuhanin ang mga binagong inputs mula sa modal fields
    const nameEl = document.getElementById('cc-name') || document.getElementById('ccName');
    const dueDateEl = document.getElementById('cc-due-date') || document.getElementById('ccDueDate');
    const amountEl = document.getElementById('cc-amount') || document.getElementById('ccAmount');
    const statusEl = document.getElementById('cc-status') || document.getElementById('ccStatus');

    const name = nameEl.value.trim();
    const dueDate = dueDateEl.value;
    const amount = parseFloat(amountEl.value);
    const status = statusEl.value.toLowerCase().trim(); // Nakuha na ang bagong piniling status bes!

    if (!name || !dueDate || isNaN(amount)) {
        alert("Please make sure that all required fields are complete and accurate before updating the document.");
        return;
    }

    // 2. I-update ang mismong document sa Firestore subcollection gamit ang .update()
    db.collection("users").doc(userId).collection("creditCards").doc(selectedEditId).update({
        name: name,
        dueDate: dueDate,
        amount: amount,
        status: status // Sinama na ang bagong status sa database update
    })
    .then(() => {
        closeCreditCardModal();
        alert("Credit Card statement updated successfully!");
    })
    .catch((error) => {
        console.error("Firestore Credit Card update failure: ", error);
        alert("It looks like an error occurred while updating the document. Please check the console for more details.");
    });
}

function deleteCreditCard(cardId, cardName) {
    const userId = getUserId();
    if (!userId) return;

    if (confirm(` Are you sure you want to delete the statement for the ${cardName}?`)) {
        db.collection("users").doc(userId).collection("creditCards").doc(cardId).delete()
            .then(() => alert("Credit Card statement deleted!"))
            .catch(err => alert("Error deleting: " + err.message));
    }
}

// --- CENTRALIZED WINDOW OVERLAY CLOSURE GUARD ---
// Pinagsama at nilagyan ng flexible ID fallback para sa lahat ng uri ng HTML structures mo, bes.
window.addEventListener('click', function(event) {
    const bankModal = document.getElementById('bankModal') || document.getElementById('bank-modal');
    const ccModal = document.getElementById('creditCardModal') || document.getElementById('credit-card-modal') || document.getElementById('add-card-modal');
    const ccHistoryModal = document.getElementById('ccHistoryModal') || document.getElementById('cc-history-modal');
    
    if (event.target === bankModal) closeBankModal();
    if (event.target === ccModal) closeCreditCardModal();
    if (event.target === ccHistoryModal) closeCcHistoryModal();
});
