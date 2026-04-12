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
        let dailyTotals = {};
        snapshot.forEach(doc => {
            const d = { id: doc.id, ...doc.data() };
            allExpenses.push(d);
            dailyTotals[d.date] = (dailyTotals[d.date] || 0) + d.amount;
        });

        let newEvents = Object.entries(dailyTotals).map(item => ({
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

    let filteredTotal = 0;
    let catTotals = {};

    allExpenses.forEach(exp => {
        const d = new Date(exp.date);
        const isSameYear = d.getFullYear() === targetYear;
        const isSameMonth = d.getMonth() === targetMonth;
        let include = (currentView === 'month') ? (isSameYear && isSameMonth) : (isSameYear);
        if (include) {
            filteredTotal += exp.amount;
            catTotals[exp.category] = (catTotals[exp.category] || 0) + exp.amount;
        }
    });

    const monthName = viewDate.toLocaleString('default', { month: 'long' });
    document.getElementById('summary-title').innerText = currentView === 'month' ? `${monthName} Summary` : `${targetYear} Summary`;
    document.getElementById('total-display').innerText = "₱" + filteredTotal.toLocaleString();
    updateSidebarUI(catTotals);
}

function updateSidebarUI(catTotals) {
    const list = document.getElementById('ranking-list');
    list.innerHTML = "";
    const sorted = Object.entries(catTotals).sort((a,b) => b[1] - a[1]);
    let labels = [], values = [];
    sorted.forEach(item => {
        labels.push(item[0]); values.push(item[1]);
        list.innerHTML += `<li><span>${item[0]}</span><b>₱${item[1].toLocaleString()}</b></li>`;
    });

    const ctx = document.getElementById('expenseChart').getContext('2d');
    if(expenseChart) expenseChart.destroy();
    
    expenseChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{ 
                data: values, 
                backgroundColor: ['#27ae60','#3498db','#e67e22','#e74c3c','#9b59b6','#f1c40f','#1abc9c','#34495e','#7f8c8d','#d35400'] 
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            // Kunin ang total ng lahat ng data points
                            const dataset = context.dataset.data;
                            const total = dataset.reduce((acc, current) => acc + current, 0);
                            const value = context.raw;
                            
                            // Calculate Percentage
                            const percentage = ((value / total) * 100).toFixed(1);
                            
                            return ` ${context.label}: ₱${value.toLocaleString()} (${percentage}%)`;
                        }
                    }
                }
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
    if(!amount) return alert("Please enter amount.");
    if(selectedEditId) await db.collection("expenses").doc(selectedEditId).update({ amount, category: cat });
    else await db.collection("expenses").add({ uid: currentUid, amount, category: cat, date, time: new Date().toLocaleTimeString('en-GB'), timestamp: Date.now() });
    closeModal();
}

async function loadHistory(date) {
    const hList = document.getElementById('modal-day-expenses');
    hList.innerHTML = "Loading...";
    const snap = await db.collection("expenses").where("uid","==",currentUid).where("date","==",date).get();
    hList.innerHTML = snap.empty ? "No records." : "";
    let docs = [];
    snap.forEach(doc => docs.push({id: doc.id, ...doc.data()}));
    docs.sort((a,b) => b.timestamp - a.timestamp).forEach(d => {
        const li = document.createElement('li');
        li.style.padding = "10px"; li.style.borderBottom = "1px solid #eee";
        li.innerHTML = `<small>${d.time}</small><br><b>${d.category}</b>: ₱${d.amount.toLocaleString()}`;
        li.onclick = () => {
            selectedEditId = d.id;
            document.getElementById('modal-title').innerText = "Edit Expense";
            document.getElementById('modal-amount').value = d.amount;
            document.getElementById('modal-category').value = d.category;
            document.getElementById('modal-action-buttons').innerHTML = `<button onclick="saveExpense()" class="btn-save">Update</button><button onclick="deleteExp('${d.id}')" style="background:var(--danger); color:white; border:none; padding:12px; margin-top:5px; width:100%; border-radius:8px; cursor:pointer;">Delete</button>`;
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
    
    // Kunin ang active year mula sa calendar view
    if (!globalCalendar) return;
    const activeYear = globalCalendar.getDate().getFullYear();
    
    // I-reset ang array sa 12 months na puro 0
    let monthlyData = new Array(12).fill(0);

    // Filter: Isasama lang ang expenses kung ang taon nito ay kapareho ng activeYear sa calendar
    allExpenses.forEach(exp => {
        const d = new Date(exp.date);
        if (d.getFullYear() === activeYear) {
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
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
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