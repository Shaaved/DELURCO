const API_BASE_URL = "http://127.0.0.1:8000";;
let currentSmartCardId = "";

// --- UNIFIED CART STATE ---
let cart = [];
let cartTotal = 0;
let activeCart = []; // NEW: This will hold the items added via AI chat

// --- AUTH ---
async function verifyQuota() {
    const inputField = document.getElementById("smart-card-input");
    const smartCardId = inputField.value.trim();

    if (!smartCardId) {
        alert("Please enter a valid Smart Card ID (e.g., CSD-1001).");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/${smartCardId}`);

        if (response.ok) {
            const data = await response.json();

            // 1. Save the ID to the browser's memory so home.html can read it
            localStorage.setItem("loggedInCard", data.smart_card_id);

            // 2. Teleport the user to the main dashboard
            window.location.href = "home.html";

        } else {
            // ... keep your existing else block exactly the same ...
            alert("Smart Card not found in CSD database. Please check the ID and try again.");
            inputField.style.borderColor = "red";
        }
    } catch (error) {
        console.error("Login error:", error);
        alert("Connection error. Please ensure the FastAPI backend is running.");
    }
}

// --- THEME ---
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

window.onload = () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
};

// --- INVENTORY ---
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
            itemCard.innerHTML = `
                <span><strong>${item.item_name}</strong> (Stock: ${item.stock_quantity})</span>
                <div style="display: flex; align-items: center;">
                    <strong>₹${item.price}</strong>
                    <button class="add-btn" onclick="addToCart('${item.item_name}', ${item.price}, 1)">Add</button>
                </div>
            `;
            inventoryList.appendChild(itemCard);
        });
    } catch (error) {
        inventoryList.innerHTML = "<span style='color:red;'>Failed to load inventory.</span>";
    }
}

// --- UNIFIED CART LOGIC ---
// Used by both inventory "Add" buttons and the AI chatbot.
function addToCart(itemName, price, qty) {
    qty = qty || 1;
    cart.push({ name: itemName, price: price, quantity: qty });

    const itemTotal = price * qty;
    cartTotal += itemTotal;

    // Update total display
    document.getElementById("cart-total").innerText = cartTotal.toFixed(2);

    // Append item row to sidebar list
    const cartList = document.getElementById("cart-list");
    cartList.innerHTML += `<li style="padding: 5px 0; border-bottom: 1px solid var(--border-color);">
        ${qty}x ${itemName} <span style="float: right;">₹${itemTotal.toFixed(2)}</span>
    </li>`;
}

// --- ORDER PLACEMENT ---
async function placeOrder() {
    const statusMsg = document.getElementById("status-message");

    if (cart.length === 0 || cartTotal <= 0) {
        if (statusMsg) statusMsg.innerText = "Your cart is empty.";
        else alert("Your cart is empty.");
        return;
    }

    // Flatten cart so each line item appears as { name, price }
    const itemsPayload = cart.flatMap(item =>
        Array(item.quantity).fill({ name: item.name, price: item.price })
    );

    try {
        const response = await fetch(`${API_BASE_URL}/order`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                smart_card_id: currentSmartCardId,
                total_amount: cartTotal,
                items: itemsPayload
            })
        });

        const data = await response.json();

        if (response.ok) {
            if (statusMsg) {
                statusMsg.style.color = "green";
                statusMsg.innerText = `Order Placed! Deducted: ₹${data.amount_deducted}`;
            }
            document.getElementById("grocery-quota").innerText =
                data.remaining_grocery_quota.toFixed(2);

            // Reset cart
            cart = [];
            cartTotal = 0;
            document.getElementById("cart-list").innerHTML = "";
            document.getElementById("cart-total").innerText = "0.00";
        } else {
            if (statusMsg) {
                statusMsg.style.color = "red";
                statusMsg.innerText = data.detail || "Order Failed.";
            }
        }
    } catch (error) {
        if (statusMsg) {
            statusMsg.style.color = "red";
            statusMsg.innerText = "Error placing order.";
        }
    }
}


function renderCart() {
    // Find the cart container (adjust ID if yours differs)
    let cartContainer = document.getElementById("active-cart") || document.querySelector("[data-cart-container]");
    
    // Fallback search if a specific ID wasn't set on the cart card
    if (!cartContainer) {
        const headers = Array.from(document.querySelectorAll("h2, h3, div, span"));
        const cartHeader = headers.find(el => el.textContent.includes("Active Cart"));
        if (cartHeader && cartHeader.parentElement) {
            cartContainer = cartHeader.parentElement.querySelector("div:last-child");
        }
    }

    if (!cartContainer) return;

    if (activeCart.length === 0) {
        cartContainer.innerHTML = `<p class="text-slate-400 text-sm">Your cart is currently empty.</p>`;
        return;
    }

    let total = 0;
    let itemsHTML = activeCart.map((item, index) => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        return `
            <div class="flex justify-between items-center py-2 border-b border-slate-700/60 text-sm">
                <div>
                    <span class="font-medium text-slate-200">${item.name}</span>
                    <span class="text-xs text-slate-400 block">₹${item.price} × ${item.quantity}</span>
                </div>
                <span class="font-semibold text-emerald-400">₹${itemTotal.toFixed(2)}</span>
            </div>
        `;
    }).join("");

    cartContainer.innerHTML = `
        <div class="space-y-1">
            ${itemsHTML}
            <div class="pt-3 flex justify-between items-center text-sm font-bold text-white">
                <span>Total Amount:</span>
                <span class="text-emerald-400">₹${total.toFixed(2)}</span>
            </div>
        </div>
    `;
}

// --- CHAT LOGIC ---
// Function to handle sending the chat message
async function sendChatMessage() {
    const inputField = document.getElementById("chat-input");
    const message = inputField.value.trim();
    const chatHistory = document.getElementById("chat-history");

    if (!message) return;

    // 1. Render User Message
    chatHistory.innerHTML += `
        <div class="mb-4 text-right">
            <span class="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg max-w-[80%] text-sm">
                ${message}
            </span>
        </div>
    `;
    inputField.value = "";
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // 2. Setup Bot Message Bubble
    const botMessageId = "bot-" + Date.now();
    chatHistory.innerHTML += `
        <div class="mb-4 text-left">
            <span id="${botMessageId}" class="inline-block bg-slate-700 text-slate-200 border border-slate-600 px-4 py-2 rounded-lg max-w-[80%] text-sm">
                🤖 
            </span>
        </div>
    `;
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: message })
        });

        if (!response.ok) throw new Error("Server rejected chat request.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const botBubble = document.getElementById(botMessageId);
        let accumulatedRawText = "";

        // 3. Stream text and accumulate full response
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const textChunk = decoder.decode(value, { stream: true });
            accumulatedRawText += textChunk;

            // Only display text that does not belong to the secret tag
            const cleanDisplay = accumulatedRawText
                .replace(/\|\|CART_ADD:.*?\|\|/g, "")
                .replace(/\|\|CART_ADD:.*$/g, "") // hides partial tag as it streams
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br>");

            botBubble.innerHTML = "🤖 " + cleanDisplay;
            chatHistory.scrollTop = chatHistory.scrollHeight;

            await new Promise(resolve => setTimeout(resolve, 15));
        }

        // 4. Intercept all ||CART_ADD: Name, Price, Qty|| tags
        const cartTagRegex = /\|\|CART_ADD:\s*(.*?),\s*(\d+(?:\.\d+)?),\s*(\d+)\|\|/g;
        let match;
        while ((match = cartTagRegex.exec(accumulatedRawText)) !== null) {
            const itemName = match[1].trim();
            const price = parseFloat(match[2]);
            const quantity = parseInt(match[3], 10);

            // Update local cart state
            const existingIndex = activeCart.findIndex(i => i.name.toLowerCase() === itemName.toLowerCase());
            if (existingIndex > -1) {
                activeCart[existingIndex].quantity += quantity;
            } else {
                activeCart.push({ name: itemName, price: price, quantity: quantity });
            }
        }

        // 5. Update visual cart UI
        renderCart();

    } catch (error) {
        console.error("Chat Error:", error);
        document.getElementById(botMessageId).innerHTML = "⚠️ Connection error.";
    }
}
// Allow pressing "Enter" to send the message
document.addEventListener("DOMContentLoaded", () => {
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
        chatInput.addEventListener("keypress", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                sendChatMessage();
            }
        });
    }
});
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