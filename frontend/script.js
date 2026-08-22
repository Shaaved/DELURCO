const API_BASE_URL = "http://127.0.0.1:8000";
let currentSmartCardId = "";

// NEW: Variables to track the cart
let cart = [];
let cartTotal = 0;
let activeCart = []; // NEW: This will hold the items added via AI chat

async function login() {
    const cardId = document.getElementById("smart-card-input").value;
    const statusMsg = document.getElementById("status-message");
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/${cardId}`);
        const data = await response.json();

        if (response.ok) {
            currentSmartCardId = data.smart_card_id;
            document.getElementById("grocery-quota").innerText = data.quotas.grocery_limit_inr;
            document.getElementById("quota-display").style.display = "block";
            document.getElementById("inventory-section").style.display = "block";
            statusMsg.style.color = "green";
            statusMsg.innerText = "Login Successful!";
            loadInventory();
        } else {
            statusMsg.style.color = "red";
            statusMsg.innerText = data.detail || "Authentication Failed.";
        }
    } catch (error) {
        statusMsg.style.color = "red";
        statusMsg.innerText = "Cannot connect to server. Is FastAPI running?";
    }
}
async function verifyQuota() {
    const inputField = document.getElementById("smart-card-input");
    const smartCardId = inputField.value.trim();
    
    if (!smartCardId) {
        alert("Please enter a valid Smart Card ID (e.g., CSD-1001).");
        return;
    }

    try {
        // 1. Changed from /verify/ to /auth/ to match your FastAPI route
        const response = await fetch(`${API_BASE_URL}/auth/${smartCardId}`);
        
        if (response.ok) {
            const data = await response.json();
            
            // 2. Mapped exactly to how your Python dictionary is structured
            const groceryQuota = data.quotas.grocery_limit_inr;
            
            // Update the UI
            document.getElementById("grocery-quota").innerText = groceryQuota.toFixed(2);
            
            // Optional: visual feedback
            inputField.style.borderColor = "var(--accent-color)";
        } else {
            alert("Smart Card not found in CSD database. Please check the ID and try again.");
            inputField.style.borderColor = "red";
        }
    } catch (error) {
        console.error("Login error:", error);
        alert("Connection error. Please ensure the FastAPI backend is running.");
    }
}
// Function to toggle between Light and Dark mode
function toggleTheme() {
    const htmlElement = document.documentElement;
    
    if (htmlElement.getAttribute('data-theme') === 'dark') {
        htmlElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        htmlElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

// Auto-load theme on refresh
window.onload = () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
};
async function loadInventory() {
    const inventoryList = document.getElementById("inventory-list");
    inventoryList.innerHTML = "<em>Loading inventory...</em>";

    try {
        const response = await fetch(`${API_BASE_URL}/inventory`);
        const data = await response.json();
        
        inventoryList.innerHTML = "";
        data.available_items.forEach(item => {
            const itemCard = document.createElement("div");
            itemCard.className = "card";
            // UPDATED: Added the "Add" button and inline flex styling
            itemCard.innerHTML = `
                <span><strong>${item.item_name}</strong> (Stock: ${item.stock_quantity})</span>
                <div style="display: flex; align-items: center;">
                    <strong>₹${item.price}</strong>
                    <button class="add-btn" onclick="addToCart('${item.item_name}', ${item.price})">Add</button>
                </div>
            `;
            inventoryList.appendChild(itemCard);
        });
    } catch (error) {
        inventoryList.innerHTML = "<span style='color:red;'>Failed to load inventory.</span>";
    }
}

// NEW: Function to add item to cart array and refresh UI
function addToCart(name, price) {
    cart.push({ name, price });
    updateCartUI();
}

// NEW: Function to remove item from cart array and refresh UI
function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

// NEW: Function to render the cart array to the screen
function updateCartUI() {
    const cartList = document.getElementById("cart-items");
    const totalSpan = document.getElementById("cart-total");
    const checkoutBtn = document.getElementById("checkout-btn");

    cartList.innerHTML = "";
    cartTotal = 0;

    if (cart.length === 0) {
        cartList.innerHTML = '<li style="color: #7f8c8d; border: none;">Your cart is empty.</li>';
        totalSpan.innerText = "0";
        checkoutBtn.disabled = true;
        return;
    }

    cart.forEach((item, index) => {
        cartTotal += item.price;
        const li = document.createElement("li");
        li.innerHTML = `
            <span>${item.name}</span> 
            <span>₹${item.price} <button class="remove-btn" onclick="removeFromCart(${index})">X</button></span>
        `;
        cartList.appendChild(li);
    });

    totalSpan.innerText = cartTotal;
    checkoutBtn.disabled = false;
}

// UPDATED: placeOrder now pulls the amount from cartTotal instead of an input box
// UPDATED: placeOrder now sends the items array to the backend
async function placeOrder() {
    const statusMsg = document.getElementById("status-message");

    if (cartTotal <= 0) {
        statusMsg.innerText = "Your cart is empty.";
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                smart_card_id: currentSmartCardId,
                total_amount: cartTotal,
                items: cart // NEW: We are now sending the exact items they ordered!
            })
        });

        const data = await response.json();

        if (response.ok) {
            statusMsg.style.color = "green";
            statusMsg.innerText = `Order Placed Successfully! Deducted: ₹${data.amount_deducted}`;
            document.getElementById("grocery-quota").innerText = data.remaining_grocery_quota;
            
            cart = [];
            updateCartUI();
        } else {
            statusMsg.style.color = "red";
            statusMsg.innerText = data.detail || "Order Failed.";
        }
    } catch (error) {
        statusMsg.style.color = "red";
        statusMsg.innerText = "Error placing order.";
    }
    
}

// --- CHAT LOGIC ---
async function sendChatMessage() {
    const inputField = document.getElementById("chat-input");
    const message = inputField.value.trim();
    if (!message) return;

    const chatBox = document.getElementById("chat-box");
    
    // 1. Display User Message (styled for dark mode compatibility)
    chatBox.innerHTML += `
        <div style="background: var(--chat-user-bg); color: var(--text-main); padding: 10px 15px; border-radius: 12px; align-self: flex-end; max-width: 80%; margin-left: auto;">
            <strong>You:</strong> ${message}
        </div>`;
    inputField.value = "";
    
    try {
        // 2. Ping the FastAPI Backend
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });

        if (!response.ok) throw new Error("Backend connection failed.");
        const data = await response.json();

        // 3. Display AI Response
        chatBox.innerHTML += `
            <div class="ai-msg">
                <strong>DELURC:</strong> ${data.response}
            </div>`;
        chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll

        // 4. THE CART FIX: Check if the AI extracted grocery items
        if (data.extracted_item) {
            addToCart(data.extracted_item, data.extracted_price, data.extracted_qty);
        }

    } catch (error) {
        console.error("Silent Catch Error:", error);
        alert("Connection error. Check your console!");
    }
}

// --- CART UI LOGIC ---
function addToCart(itemName, price, qty) {
    // 1. Save to memory
    activeCart.push({ name: itemName, price: price, quantity: qty });
    
    // 2. Calculate and update the new total
    const itemTotal = price * qty;
    cartTotal += itemTotal;
    document.getElementById("cart-total").innerText = cartTotal.toFixed(2);
    
    // 3. Add the item to the sidebar list
    const cartList = document.getElementById("cart-list");
    cartList.innerHTML += `<li style="padding: 5px 0; border-bottom: 1px solid var(--border-color);">${qty}x ${itemName} <span style="float: right;">₹${itemTotal.toFixed(2)}</span></li>`;
}
// --- CHECKOUT LOGIC ---
async function processCheckout() {
    const smartCardId = document.getElementById("smart-card-input").value.trim();

    // 1. Validation checks
    if (!smartCardId) {
        alert("Authentication Error: Please login with your Smart Card first.");
        return;
    }
    if (activeCart.length === 0) {
        alert("Cart is empty. Ask the AI to add items first.");
        return;
    }

    try {
        // 2. Send the transaction to the backend
        const response = await fetch(`${API_BASE_URL}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                smart_card_id: smartCardId,
                total_amount: cartTotal,
                items: activeCart
            })
        });

        const data = await response.json();

        // 3. Handle Success vs Insufficient Funds
        if (response.ok) {
            alert(`Order Dispatched! Remaining balance: ₹${data.new_balance.toFixed(2)}`);
            
            // Clear the cart and update UI
            activeCart = [];
            cartTotal = 0;
            document.getElementById("cart-total").innerText = "0.00";
            document.getElementById("cart-list").innerHTML = "";
            document.getElementById("grocery-quota").innerText = data.new_balance.toFixed(2);
        } else {
            alert(`Transaction Failed: ${data.detail}`);
        }
    } catch (error) {
        console.error("Checkout Error:", error);
        alert("Network error during checkout.");
    }
}