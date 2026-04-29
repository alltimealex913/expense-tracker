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

let globalCalendar = null;
let expenseChart = null;
let trendChart = null;
let currentUid = null;
let isLoginView = true;
let selectedEditId = null;
let currentView = 'month';
let allExpenses = [];

// --- UPDATED SESSION MONITOR ---
auth.onAuthStateChanged(user => {
    const loader = document.getElementById('loading-screen');
    const authBox = document.getElementById('auth-container');
    const dashBox = document.getElementById('dashboard-container');

    // Dito natin chicheck kung verified ang email bago ipakita ang dashboard
    if (user && user.emailVerified) {
        currentUid = user.uid;
        document.getElementById('user-display').innerText = user.email;
        loader.style.display = 'none';
        authBox.style.display = 'none';
        dashBox.style.display = 'block';
        setTimeout(() => { initDashboard(user.uid); }, 150);
    } else {
        // Kung walang user O hindi pa verified, balik sa login screen
        loader.style.display = 'none';
        authBox.style.display = 'flex';
        dashBox.style.display = 'none';
    }
});

function initDashboard(uid) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    calendarEl.innerHTML = ''; 

    globalCalendar = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'dayGridMonth' : 'dayGridMonth',
        height: 'auto',
        headerToolbar: { 
            left: 'prev,next today', 
            center: 'title', 
            right: '' 
        },
        datesSet: function() { 
    refreshSummary(); 
    if (typeof updateTrendChart === "function") {
        updateTrendChart(); // Dito natin pinipilit ang graph na mag-refresh tuwing lilipat ng view
    }
},
       dateClick: (info) => {
    // Kuhanin ang petsa ngayon sa format na YYYY-MM-DD base sa local time ng user
    const now = new Date();
    const todayLocal = now.getFullYear() + '-' + 
                       String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(now.getDate()).padStart(2, '0');

    // I-compare ang click date vs local today
    if (info.dateStr > todayLocal) {
        return alert("You can only add new expenses up to the present date.");
    }
    
    openModalForAdd(info.dateStr);
},
        windowResize: function(view) {
            // Automatic update ng calendar size kapag nag-rotate ang screen
            globalCalendar.updateSize();
        }
    });

    globalCalendar.render();

    db.collection("expenses").where("uid", "==", uid)
    .onSnapshot(snapshot => {
    allExpenses = [];
    let dailyOutflowTotals = {};
    snapshot.forEach(doc => {
        const d = { id: doc.id, ...doc.data() };
        allExpenses.push(d);

        // Outflow lang ang ipakita sa Calendar box
        if (d.type === "outflow" || !d.type) { // !d.type handles your old data
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
    let methodTotals = {}; // Dito natin i-stostore ang totals per payment method

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
                
                // --- PAYMENT METHOD LOGIC ---
                const pMode = exp.paymentMode || "Cash"; // Default sa Cash kung walang entry
                methodTotals[pMode] = (methodTotals[pMode] || 0) + exp.amount;
            }
        }
    });

    // Update main displays
    document.getElementById('inflow-display').innerText = "₱" + totalInflow.toLocaleString();
    document.getElementById('outflow-display').innerText = "₱" + totalOutflow.toLocaleString();
    document.getElementById('savings-display').innerText = "₱" + (totalInflow - totalOutflow).toLocaleString();
    
    // --- RENDER PAYMENT BREAKDOWN ---
    const methodContainer = document.getElementById('method-totals-list');
    methodContainer.innerHTML = "<p style='color:#7f8c8d; margin-bottom:5px; font-weight:bold;'>Paid using:</p>";
    
    // I-loop natin yung methodTotals para ipakita sa UI
    Object.entries(methodTotals).forEach(([mode, amount]) => {
        const div = document.createElement('div');
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.marginBottom = "3px";
        div.innerHTML = `<span>${mode}:</span> <b>₱${amount.toLocaleString()}</b>`;
        methodContainer.appendChild(div);
    });

    updateSidebarUI(catTotals);
    renderBudgetStatus(catTotals);
}

function updateSidebarUI(catTotals) {
    const list = document.getElementById('ranking-list');
    list.innerHTML = "";
    
    // 1. I-filter natin: Tanggalin ang mga categories na pang-Inflow
    // (Salary, Allowance, Business, atbp.) para Expenses lang ang maiwan sa chart
    const inflowCategories = ["Salary", "Allowance", "Business"];
    
    const filteredCatEntries = Object.entries(catTotals).filter(([category]) => {
        return !inflowCategories.includes(category);
    });

    // 2. I-sort ang expenses mula pinakamalaki hanggang maliit
    const sorted = filteredCatEntries.sort((a,b) => b[1] - a[1]);
    
    let labels = [], values = [];
    
    sorted.forEach(item => {
        labels.push(item[0]); 
        values.push(item[1]);
        list.innerHTML += `<li><span>${item[0]}</span><b>₱${item[1].toLocaleString()}</b></li>`;
    });

    // 3. I-render ang Chart (Expenses Only)
    const ctx = document.getElementById('expenseChart').getContext('2d');
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

const modal = document.getElementById('expenseModal');
function closeModal() { modal.style.display = 'none'; selectedEditId = null; }

function openModalForAdd(date) {
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

// Helper para hindi paulit-ulit ang options ng Expenses
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
    let targetDate = new Date().toISOString().split('T')[0]; // Default: Today

    if (globalCalendar) {
        // Imbes na getDate(), kukunin natin ang current Start Date ng view
        const view = globalCalendar.view;
        const viewDate = globalCalendar.getDate();
        
        // Gagawin nating safe: Siguraduhin na Year at Month lang ang kukunin 
        // tapos i-se-set natin sa first day ng buwan para hindi mag-December 31
        const year = viewDate.getFullYear();
        const month = String(viewDate.getMonth() + 1).padStart(2, '0');
        targetDate = `${year}-${month}-01`; 
    }
    
    const modalEl = document.getElementById('expenseModal');
    modalEl.style.display = 'block';
    
    document.getElementById('modal-title').innerText = "Add Inflow (Income)";
    document.getElementById('modal-date').innerText = targetDate;
    document.getElementById('modal-amount').value = "";
    
    // Set Inflow categories
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

    if (!amount || isNaN(amount)) {
        return alert("Please enter a valid amount.");
    }

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
        if (selectedEditId) {
            await db.collection("expenses").doc(selectedEditId).update(payload);
        } else {
            await db.collection("expenses").add(payload);
        }
        
        // Importante: I-reset ang categories bago i-close
        resetCategoryToExpenses();
        closeModal();
        alert("Inflow saved successfully!"); // Temporary alert para ma-confirm mo kung pumasok
    } catch (e) {
        console.error("Firebase Error:", e);
        alert("Error saving: " + e.message);
    }
}

async function loadHistory(date) {
    const hList = document.getElementById('modal-day-expenses');
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

        // Lagyan natin ng kulay para madaling makita kung Inflow o Outflow
        const isInf = d.type === "inflow";
        const color = isInf ? "#27ae60" : "#e74c3c";
        const typeLabel = isInf ? "[INFLOW]" : "[EXPENSE]";

        li.innerHTML = `
            <small>${d.time} | ${d.paymentMode || 'Cash'}</small><br>
            <b style="color:${color}">${typeLabel} ${d.category}</b>: ₱${d.amount.toLocaleString()}
        `;

        // ETO ANG MAGIC PARA SA EDITING:
        li.onclick = () => {
            selectedEditId = d.id; // I-save yung ID para alam ng Firebase kung anong i-u-update
            
            if (isInf) {
                // 1. Palitan ang Title at Dropdown Categories para sa Inflow
                document.getElementById('modal-title').innerText = "Edit Inflow";
                document.getElementById('modal-category').innerHTML = `
                    <option value="Salary">Salary</option>
                    <option value="Allowance">Allowance</option>
                    <option value="Business">Business</option>
                    <option value="Others">Others</option>`;
                
                // 2. I-set ang buttons para tumawag sa saveInflow()
                document.getElementById('modal-action-buttons').innerHTML = `
                    <button onclick="saveInflow()" class="btn-save" style="background:#27ae60">Update Inflow</button>
                    <button onclick="deleteExp('${d.id}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:5px; width:100%; border-radius:8px; cursor:pointer;">Delete</button>
                `;
            } else {
                // Default: Edit Expense logic
                document.getElementById('modal-title').innerText = "Edit Expense";
                resetCategoryToExpenses(); // Ibalik sa Food, Transpo, etc.
                
                document.getElementById('modal-action-buttons').innerHTML = `
                    <button onclick="saveExpense()" class="btn-save">Update Expense</button>
                    <button onclick="deleteExp('${d.id}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:5px; width:100%; border-radius:8px; cursor:pointer;">Delete</button>
                `;
            }

            // 3. I-fill up ang fields ng data mula sa Firebase
            document.getElementById('modal-amount').value = d.amount;
            document.getElementById('modal-category').value = d.category;
            document.getElementById('modal-payment').value = d.paymentMode || "Cash";
            document.getElementById('modal-date').innerText = d.date;
        };

        hList.appendChild(li);
    });
}
async function deleteExp(id) { if(confirm("Are you sure?")) { await db.collection("expenses").doc(id).delete(); closeModal(); } }

function toggleAuth() {
    isLoginView = !isLoginView;
    document.getElementById('auth-title').innerText = isLoginView ? "Welcome Back" : "Register";
    document.getElementById('main-btn').innerText = isLoginView ? "Login" : "Register Account";
}
async function handleAuth() {
    const email = document.getElementById('email').value;
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
            // REGISTER
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            
            // 1. I-send ang verification email
            await userCredential.user.sendEmailVerification();
            
            // 2. IMPORTANTE: I-sign out agad para hindi bumukas ang dashboard
            await auth.signOut();
            
            // 3. I-notify ang user at ibalik sa Login View
            alert("Registration successful! Please check your email and click the verification link before logging in.");
            
            isLoginView = true;
            toggleAuth(); // Siguraduhin na babalik sa login screen
        }
    } catch (e) { 
        alert("Error: " + e.message); 
    }
}

function logout() { auth.signOut(); }

function updateTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (!globalCalendar) return;
    const activeYear = globalCalendar.getDate().getFullYear();
    
    // I-reset ang array sa 12 months na puro 0
    let monthlyData = new Array(12).fill(0);

    // FILTER: Isasama lang ang data kung same year AT kung OUTFLOW lang
    allExpenses.forEach(exp => {
        const d = new Date(exp.date);
        
        // CHECK: Dapat same year AND (type ay outflow O walang type)
        // Ang !exp.type ay para sa mga lumang data mo na default na gastos
        if (d.getFullYear() === activeYear && (exp.type === "outflow" || !exp.type)) {
            monthlyData[d.getMonth()] += exp.amount;
        }
    });

    if (trendChart) trendChart.destroy();
    
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: [{
                label: `Total Spending for ${activeYear}`,
                data: monthlyData,
                borderColor: '#e74c3c', // Ginawa nating RED para mag-match sa "Outflow" feel
                backgroundColor: 'rgba(231, 76, 60, 0.1)',
                borderWidth: 3,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#2c3e50',
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) { return '₱' + value.toLocaleString(); }
                    }
                }
            }
        }
    });
}

// FORGOT PASSWORD FUNCTION
async function forgotPassword() {
    const email = document.getElementById('email').value;
    
    if (!email) {
        alert("Please enter your email address first in the input field above.");
        return;
    }
    
    try {
        await auth.sendPasswordResetEmail(email);
        alert("Password reset link sent! Please check your inbox or spam folder.");
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// --- BUDGET THRESHOLD SYSTEM ---

// 1. Modal para sa Pag-set ng Budget
function openBudgetModal() {
    const modalEl = document.getElementById('expenseModal');
    modalEl.style.display = 'block';
    
    document.getElementById('modal-title').innerText = "Set Category Budget";
    document.getElementById('modal-date').innerText = "Monthly Threshold Settings";
    document.getElementById('modal-amount').value = "";
    
    // I-reset ang categories para Expense categories ang mamili
    resetCategoryToExpenses();

    // Palitan ang button para saveBudget() ang tawagin imbes na saveExpense()
    document.getElementById('modal-action-buttons').innerHTML = 
        `<button onclick="saveBudget()" class="btn-save" style="background:#27ae60; color:white; border:none; padding: 10px 20px; width: auto; border-radius:8px; cursor:pointer; font-weight:bold;">Save Budget Threshold</button>`;
}

// 2. I-save sa Firestore
async function saveBudget() {
    const amount = parseFloat(document.getElementById('modal-amount').value);
    const cat = document.getElementById('modal-category').value;

    if (!amount || isNaN(amount)) return alert("Please enter a valid budget amount.");

    try {
        // Gagamit tayo ng unique ID: UID + Category para 1 budget per category lang
        const budgetId = `${currentUid}_${cat}`;
        await db.collection("budgets").doc(budgetId).set({
            uid: currentUid,
            category: cat,
            amount: amount,
            timestamp: Date.now()
        });
        
        closeModal();
        alert(`Success! Budget for ${cat} is now ₱${amount.toLocaleString()}`);
        refreshSummary(); // I-trigger para mag-update agad ang bars
    } catch (e) {
        alert("Error saving budget: " + e.message);
    }
}

// 3. I-render ang Progress Bars sa Dashboard
async function renderBudgetStatus(catTotals) {
    const container = document.getElementById('budget-monitoring-list');
    if (!container) return;

    const snapshot = await db.collection("budgets").where("uid", "==", currentUid).get();

    if (snapshot.empty) {
        container.innerHTML = `<p style="color: gray; text-align: center; font-size: 0.9em;">No budgets set. Click '+ Set Budget Threshold' to start.</p>`;
        return;
    }

    container.innerHTML = ""; 

    snapshot.forEach(doc => {
        const b = doc.data();
        const actualSpend = catTotals[b.category] || 0;
        let percentage = (actualSpend / b.amount) * 100;
        const displayPercent = Math.min(percentage, 100).toFixed(0);
        
        let barColor = "#27ae60"; 
        if (percentage >= 100) barColor = "#e74c3c";
        else if (percentage >= 80) barColor = "#e67e22";

        // Gagawa tayo ng element para malagyan ng onclick (Edit)
        const itemDiv = document.createElement('div');
        itemDiv.className = "budget-item";
        itemDiv.style.cssText = "margin-bottom: 15px; padding: 12px; border: 1px solid #eee; border-radius: 8px; cursor: pointer; transition: 0.2s;";
        
        // Hover effect para alam na clickable
        itemDiv.onmouseover = () => itemDiv.style.background = "#f9f9f9";
        itemDiv.onmouseout = () => itemDiv.style.background = "transparent";

        // Kapag clinick, magbubukas ang modal para sa Edit
        // Hanapin ang onclick sa loob ng renderBudgetStatus function:
itemDiv.onclick = () => {
    openBudgetModal();
    document.getElementById('modal-title').innerText = "Edit Budget";
    document.getElementById('modal-category').value = b.category;
    document.getElementById('modal-amount').value = b.amount;

    // Eto yung maglalagay ng Delete button sa modal
    document.getElementById('modal-action-buttons').innerHTML = `
        <button onclick="saveBudget()" class="btn-save" style="background:#2c3e50">Update</button>
        <button onclick="deleteBudget('${b.category}')" style="background:#e74c3c; color:white; border:none; padding:12px; margin-top:10px; width:100%; border-radius:8px; cursor:pointer; font-weight:bold;">Delete Threshold</button>
    `;
};

        itemDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9em;">
                <span><b>${b.category}</b> <small style="color:gray;">(₱${actualSpend.toLocaleString()} / ₱${b.amount.toLocaleString()})</small></span>
                <span style="font-weight:bold; color:${barColor}">${displayPercent}%</span>
            </div>
            <div style="background: #eee; height: 10px; border-radius: 5px; overflow: hidden;">
                <div style="width: ${displayPercent}%; background: ${barColor}; height: 100%; transition: width 0.5s;"></div>
            </div>
            <div style="text-align: right; font-size: 10px; color: #95a5a6; margin-top: 5px;">Click to Edit</div>
        `;
        container.appendChild(itemDiv);
    });
}

async function deleteBudget(category) {
    if (confirm(`Are you sure you want to remove the budget for ${category}?`)) {
        try {
            // Gagamitin natin yung unique ID na ginawa natin kanina
            const budgetId = `${currentUid}_${category}`;
            await db.collection("budgets").doc(budgetId).delete();
            
            closeModal(); // Isara ang modal
            refreshSummary(); // I-refresh ang dashboard para mawala agad yung bar
        } catch (e) {
            alert("Error deleting budget: " + e.message);
        }
    }
}