const API_BASE_URL = "https://delurco.onrender.com";;
let currentSmartCardId = "";
// Run this immediately when any page loads
document.addEventListener("DOMContentLoaded", () => {
    // 1. Check if the current URL contains "login.html"
    const isLoginPage = window.location.pathname.includes("login.html");

    // 2. Look for the saved user in the browser
    const savedUser = localStorage.getItem("delurco_user");

    // BOUNCER LOGIC:
    if (!savedUser && !isLoginPage) {
        // Condition A: Not logged in, and trying to view the store -> Kick to login
        window.location.href = "login.html";
        return; // Stop running any more code
    } else if (savedUser && isLoginPage) {
        // Condition B: Already logged in, but looking at the login screen -> Send to store
        window.location.href = "index.html";
        return; // Stop running any more code
    }

    // 3. If we survived the bouncer, sync the product UI buttons on load!
    if (typeof syncProductCards === "function") {
        syncProductCards();
    }
});

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
    const container = document.getElementById("cart-items-container");
    const countSpan = document.getElementById("cart-count");
    const totalSpan = document.getElementById("cart-total");

    container.innerHTML = ""; // Clear current items
    let total = 0;
    let itemCount = 0;

    if (activeCart.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center mt-10">Your cart is empty.</p>';
    } else {
        // INSIDE renderCart() - Replace your container.innerHTML block with this:
        activeCart.forEach(item => {
            const itemTotal = item.price * item.quantity;
            container.innerHTML += `
                <div class="flex justify-between items-center bg-gray-800 p-4 rounded-lg mb-3 shadow-md">
                    <div class="flex-1">
                        <h3 class="font-bold text-white">${item.name}</h3>
                        <p class="text-sm text-gray-400">₹${item.price} each</p>
                    </div>
                    
                    <!-- The Plus/Minus Controls with the correct window. tags -->
                    <div class="flex items-center space-x-3 bg-gray-900 rounded-full px-2 py-1 border border-gray-700">
                        <button onclick="window.decreaseQuantity('${item.name}')" class="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-red-500 text-white rounded-full font-bold transition-colors">-</button>
                        <span class="font-bold text-white w-4 text-center text-sm">${item.quantity}</span>
                        <button onclick="window.increaseQuantity('${item.name}')" class="w-7 h-7 flex items-center justify-center bg-gray-800 hover:bg-emerald-500 text-white rounded-full font-bold transition-colors">+</button>
                    </div>
                </div>
            `;
        });
        syncProductCards();
    }

    // Update numbers
    if (countSpan) countSpan.innerText = itemCount;
    if (totalSpan) totalSpan.innerText = `₹${total}`;
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
            showToast(itemName);
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
async function processCheckout() {
    // 1. Check if cart is empty
    if (activeCart.length === 0) {
        alert("Your cart is empty!");
        return;
    }

    // 2. Get the logged-in user from our secure auth system memory
    const savedUserString = localStorage.getItem("delurco_user");
    if (!savedUserString) {
        alert("Authentication Error: Please login first.");
        window.location.href = "login.html";
        return;
    }
    const savedUser = JSON.parse(savedUserString);

    // 3. Change button to Processing
    const checkoutBtn = document.getElementById("checkout-btn");
    if (checkoutBtn) checkoutBtn.innerText = "Processing...";
    // 4. Calculate total for the backend
    let cartTotal = 0;
    activeCart.forEach(item => cartTotal += (item.price * item.quantity));

    try {
        // 5. Send transaction to the backend
        const response = await fetch(`${API_BASE_URL}/checkout`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                smart_card_id: savedUser.smart_card_id,
                total_amount: cartTotal,
                items: activeCart
            })
        });

        const data = await response.json();

        if (data.success) {
            // Success! Clear memory and UI
            activeCart = [];
            localStorage.removeItem("delurco_cart");
            renderCart();
            if (typeof syncProductCards === "function") syncProductCards();

            // Show success toast and close the cart
            showToast("Order", "✅ Checkout successful! Sent to kitchen.");
            if (typeof toggleCart === "function") toggleCart();
        } else {
            // Backend rejected it (e.g., out of stock!)
            alert(`delurco.vercel.app says\n❌ ${data.message}`);
        }
    } catch (error) {
        alert("Connection error. Could not reach server.");
    } finally {
        // 6. FIX THE STUCK BUTTON! This always runs, even on errors.
        if (checkoutBtn) checkoutBtn.innerText = "SECURE CHECKOUT";
    }
}
// Toggles the AI Chat Widget open and closed
function toggleChat() {
    const chatWindow = document.getElementById("ai-chat-window");
    if (chatWindow.classList.contains("hidden")) {
        chatWindow.classList.remove("hidden");
        chatWindow.classList.add("flex");
    } else {
        chatWindow.classList.add("hidden");
        chatWindow.classList.remove("flex");
    }
}
// Upgraded Toast Notification
function showToast(itemName, customMessage = null) {
    const toast = document.getElementById("toast-notification");
    const toastMessage = document.getElementById("toast-message");

    // If we pass a custom message (like an error), use it. Otherwise, use the success message.
    if (customMessage) {
        toastMessage.innerText = customMessage;
    } else {
        toastMessage.innerText = `✅ ${itemName} added, let's proceed to checkout!`;
    }

    toast.classList.remove("opacity-0", "translate-y-10", "pointer-events-none");
    toast.classList.add("opacity-100", "translate-y-0");

    setTimeout(() => {
        toast.classList.remove("opacity-100", "translate-y-0");
        toast.classList.add("opacity-0", "translate-y-10", "pointer-events-none");
    }, 4000);
}
// Toggle the Cart Slide-out
function toggleCart() {
    const cartSlideout = document.getElementById("cart-slideout");
    cartSlideout.classList.toggle("translate-x-full");
}
// Function to handle the login attempt
async function attemptLogin() {
    const cardInput = document.getElementById("smart-card-id").value.toUpperCase();
    const pinInput = document.getElementById("pin").value;
    const errorMsg = document.getElementById("login-error");
    const loginBtn = document.getElementById("login-btn");

    if (!cardInput || !pinInput) {
        errorMsg.innerText = "Please enter both ID and PIN.";
        errorMsg.classList.remove("hidden");
        return;
    }

    loginBtn.innerText = "VERIFYING...";
    errorMsg.classList.add("hidden");

    try {
        // Change the fetch URL inside attemptLogin() to match the backend
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ smart_card_id: cardInput, pin: pinInput })
        });

        const data = await response.json();

        if (data.success) {
            // Save the user data to the browser so the app remembers them
            localStorage.setItem("delurco_user", JSON.stringify(data.user));

            // Redirect to the home page!
            window.location.href = "home.html";
        } else {
            errorMsg.innerText = data.message;
            errorMsg.classList.remove("hidden");
        }
    } catch (error) {
        errorMsg.innerText = "Connection error to server.";
        errorMsg.classList.remove("hidden");
    } finally {
        loginBtn.innerText = "AUTHENTICATE";
    }
}

// Function to automatically log out
function logoutUser() {
    localStorage.removeItem("delurco_user");
    window.location.href = "login.html";
}
function syncProductCards() {
    const actionContainers = document.querySelectorAll('.item-action-container');

    actionContainers.forEach(container => {
        const itemName = container.getAttribute('data-name');
        const itemPrice = parseFloat(container.getAttribute('data-price'));

        // Grab the stock from HTML. If you forget to add it, default to 10.
        const maxStock = parseInt(container.getAttribute('data-stock')) || 10;

        const cartItem = activeCart.find(item => item.name === itemName);

        if (cartItem && cartItem.quantity > 0) {
            container.innerHTML = `
                <div class="flex items-center space-x-3 bg-emerald-600 rounded-lg px-2 py-1 shadow-lg">
                    <button onclick="window.decreaseQuantity('${itemName}')" class="w-8 h-8 flex items-center justify-center text-white font-bold hover:bg-emerald-700 rounded-md transition-colors">-</button>
                    <span class="font-bold text-white w-4 text-center text-sm">${cartItem.quantity}</span>
                    <button onclick="window.increaseQuantity('${itemName}')" class="w-8 h-8 flex items-center justify-center text-white font-bold hover:bg-emerald-700 rounded-md transition-colors">+</button>
                </div>
            `;
        } else {
            // WE UPGRADED THIS LINE to pass maxStock into the cart!
            container.innerHTML = `
                <button onclick="manualAddToCart('${itemName}', ${itemPrice}, ${maxStock})" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-emerald-600/20">Add +</button>
            `;
        }
    });
}
// 1. Save the maxStock to the cart array when first added
function manualAddToCart(itemName, price, maxStock = 10) {
    const existingIndex = activeCart.findIndex(item => item.name === itemName);

    if (existingIndex > -1) {
        // If they click Add+ fast, check the limit!
        if (activeCart[existingIndex].quantity < maxStock) {
            activeCart[existingIndex].quantity += 1;
        }
    } else {
        // Save the maxStock permanently to this item in the array
        activeCart.push({ name: itemName, price: price, quantity: 1, stockLimit: maxStock });
    }

    renderCart();
    syncProductCards();
    showToast(itemName);
}

// 2. Block the plus button if they hit the ceiling
window.increaseQuantity = function (itemName) {
    const index = activeCart.findIndex(item => item.name === itemName);

    if (index > -1) {
        // Fallback to 10 for items saved in old browser memory
        const limit = activeCart[index].stockLimit || 10;

        if (activeCart[index].quantity < limit) {
            activeCart[index].quantity += 1;
            renderCart();
            syncProductCards();
        } else {
            // They hit the limit! Fire the warning toast.
            showToast(itemName, `⚠️ Only ${limit} ${itemName} left in stock!`);
        }
    }
};