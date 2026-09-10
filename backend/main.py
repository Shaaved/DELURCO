from fastapi.responses import StreamingResponse
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import timedelta
from google import genai
import asyncio
import sqlite3
import os
import json
client = genai.Client(api_key="AQ.Ab8RN6LEi7o4nKUjqWn_pJADWSHRXcK9QAwTI5uLKfT3PefX3A")

# 1. Initialize a Mock CSD SQL Database
def setup_mock_database():
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS inventory (
        item_name TEXT PRIMARY KEY,
        price REAL,
        stock INTEGER
    )
''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        smart_card_id TEXT PRIMARY KEY,
        name TEXT,
        pin TEXT,
        balance REAL
    )
''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        smart_card_id TEXT,
        items TEXT,
        total_amount REAL,
        status TEXT DEFAULT 'pending'
    )
''')
    conn.commit()
    # Check if table is empty, if so, insert mock data
    cursor.execute("SELECT COUNT(*) FROM inventory")
    if cursor.fetchone()[0] == 0:
       cursor.execute("INSERT OR REPLACE INTO inventory (item_name, price, stock) VALUES ('Maggi', 14, 50)")
       cursor.execute("INSERT OR REPLACE INTO inventory (item_name, price, stock) VALUES ('Lifebuoy', 35, 50)")
       cursor.execute("INSERT OR REPLACE INTO inventory (item_name, price, stock) VALUES ('Parle-G', 10, 50)")
       conn.commit()
       cursor.execute("INSERT OR IGNORE INTO users (smart_card_id, name, pin, balance) VALUES ('CSD-1001', 'Test user', '1234', 500.00)")
       conn.commit()
    conn.close()

setup_mock_database()

# 2. CREATE THE AI TOOL
# The docstring (the text in the """ quotes) is physically read by the AI so it knows how to use it!
def check_inventory(item_name: str) -> str:
    """Always use this tool to search the canteen database for an item's price and available stock."""
    print(f"🤖 AI is querying the database for: {item_name}") # Watch this trigger in your terminal!
    
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    # Search for items that match the name
    cursor.execute("SELECT item_name, price, stock FROM inventory WHERE item_name LIKE ?", (f"%{item_name}%",))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return f"DATABASE RESULT: Item found: {result[0]}, Price: ₹{result[1]}, Stock available: {result[2]}"
    else:
        return f"DATABASE RESULT: Item '{item_name}' does not exist in the canteen database."


# (Keep all your existing FastAPI, SQLAlchemy, and Pydantic imports)

# Import Delivery App DB components
from database import SessionLocal as DeliverySessionLocal
from models import User, Inventory, Order, OrderItem

# Import Mock CSD DB components
from setup_mock_db import SessionLocal as MockSessionLocal, MockCSDRecord

app = FastAPI(title="URC Home Delivery API")

# --- CORS SETUP ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],
)

# --- DATABASE DEPENDENCIES ---
def get_delivery_db():
    db = DeliverySessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_mock_db():
    db = MockSessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- PYDANTIC SCHEMAS ---
class CartItem(BaseModel):
    name: str
    price: float

class OrderRequest(BaseModel):
    smart_card_id: str
    total_amount: float
    items: List[CartItem] 

# --- ENDPOINTS ---
class LoginRequest(BaseModel):
    smart_card_id: str
    pin: str

@app.post("/api/login")
async def login_user(req: LoginRequest):
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT name, balance FROM users WHERE smart_card_id = ? AND pin = ?", (req.smart_card_id, req.pin))
        user = cursor.fetchone()
        
        if user:
            return {
                "success": True, 
                "message": f"Welcome back, {user[0]}!",
                "user": {
                    "smart_card_id": req.smart_card_id,
                    "name": user[0],
                    "balance": user[1]
                }
            }
        else:
            return {"success": False, "message": "Invalid Smart Card ID or PIN."}
    except Exception as e:
        return {"success": False, "message": str(e)}
    finally:
        conn.close()

@app.get("/auth/{smart_card_id}")
def authenticate_and_get_quota(
    smart_card_id: str, 
    mock_db: Session = Depends(get_mock_db),
    delivery_db: Session = Depends(get_delivery_db)
):
    """Checks if the user exists in CSD and returns their remaining quota."""
    csd_record = mock_db.query(MockCSDRecord).filter(MockCSDRecord.smart_card_id == smart_card_id).first()
    
    if not csd_record:
        raise HTTPException(status_code=404, detail="Smart Card not found in CSD database")

    app_user = delivery_db.query(User).filter(User.smart_card_id == smart_card_id).first()
    
    return {
        "status": "success",
        "smart_card_id": csd_record.smart_card_id,
        "is_registered_on_app": bool(app_user),
        "quotas": {
            "grocery_limit_inr": csd_record.monthly_grocery_limit,
            "liquor_limit_units": csd_record.monthly_liquor_limit
        }
    }

@app.get("/inventory")
def get_available_inventory(delivery_db: Session = Depends(get_delivery_db)):
    """Returns all items currently in stock at the local URC."""
    items = delivery_db.query(Inventory).filter(Inventory.stock_quantity > 0).all()
    return {"available_items": items}

# --- NEW CHAT SCHEMA ---
class ChatRequest(BaseModel):
    message: str

@app.post("/order")
def place_order(
    order_req: OrderRequest, 
    mock_db: Session = Depends(get_mock_db),
    delivery_db: Session = Depends(get_delivery_db)
):
    """Validates the order, deducts quotas, creates the ticket, and saves the items."""
    csd_record = mock_db.query(MockCSDRecord).filter(MockCSDRecord.smart_card_id == order_req.smart_card_id).first()
    if not csd_record:
        raise HTTPException(status_code=404, detail="Invalid Smart Card ID")
        
    if order_req.total_amount > csd_record.monthly_grocery_limit:
        raise HTTPException(
            status_code=400, 
            detail=f"Quota exceeded. Remaining limit is {csd_record.monthly_grocery_limit} INR"
        )
        
    app_user = delivery_db.query(User).filter(User.smart_card_id == order_req.smart_card_id).first()
    if not app_user:
        raise HTTPException(status_code=400, detail="User must complete app registration first")

    # Deduct the quota
    csd_record.monthly_grocery_limit -= order_req.total_amount
    mock_db.commit() 

    # Create the main order ticket
    new_order = Order(
        user_id=app_user.id,
        total_amount=order_req.total_amount,
        status="packed"
    )
    delivery_db.add(new_order)
    delivery_db.flush() 

    # Save every individual item to the OrderItem table
    for item in order_req.items:
        new_order_item = OrderItem(
            order_id=new_order.id,
            item_name=item.name,
            price=item.price
        )
        delivery_db.add(new_order_item)

    delivery_db.commit()
    delivery_db.refresh(new_order)
    
    return {
        "status": "Order placed successfully",
        "order_id": new_order.id,
        "amount_deducted": new_order.total_amount,
        "remaining_grocery_quota": csd_record.monthly_grocery_limit
    }

@app.get("/admin/orders")
def get_all_orders(delivery_db: Session = Depends(get_delivery_db)):
    """Fetches all orders and safely handles missing data for the URC admin dashboard."""
    orders = delivery_db.query(Order).all()
    
    formatted_orders = []
    for order in orders:
        # Safely handle missing items
        items_list = []
        if order.items:
            items_list = [{"name": item.item_name, "price": item.price} for item in order.items]
            
        # Safely handle missing customer data
        customer = order.customer
        smart_card_id = customer.smart_card_id if customer else "Unknown"
        name = customer.name if customer else "Unknown"
        
        # Safely handle missing dates
       # Safely handle missing dates AND convert to Indian Standard Time (IST)
        if order.created_at:
            # Add 5 hours and 30 minutes to the UTC database time
            ist_time = order.created_at + timedelta(hours=5, minutes=30)
            date_str = ist_time.strftime("%Y-%m-%d %I:%M %p") # Also updated to 12-hour format with AM/PM for easier reading!
        else:
            date_str = "N/A"
        
        formatted_orders.append({
            "order_id": order.id,
            "smart_card_id": smart_card_id,
            "name": name,
            "total_amount": order.total_amount,
            "status": order.status,
            "date": date_str,
            "items": items_list
        })
        
    return {"orders": formatted_orders}
# --- NEW SCHEMAS FOR STATUS UPDATE ---
class StatusUpdateRequest(BaseModel):
    status: str

@app.put("/admin/orders/{order_id}/status")
def update_order_status(
    order_id: int, 
    status_req: StatusUpdateRequest,
    delivery_db: Session = Depends(get_delivery_db)
):
    """Updates the status of a specific order."""
    order = delivery_db.query(Order).filter(Order.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    order.status = status_req.status
    delivery_db.commit()
    
    return {"message": f"Order #{order_id} status updated to {status_req.status}"}


# 1. Update the Persona to stop the repetitive greetings
sys_prompt = """
You are the DELURC Canteen AI Assistant. You help users order groceries. 
IMPORTANT RULES: 
- Say hello in reply to the first message only.
- Do not say 'Hello' or greet the user on every message.
- You MUST use the `check_inventory` tool BEFORE confirming any order.
- If the item is not in the database, tell the user we don't carry it.
- If the requested quantity is greater than the available stock, apologize and offer the maximum available amount.
- ONLY output the ||CART_ADD: Name, Price, Qty|| tag if the database confirms we have enough stock.
"""

chat_session = client.aio.chats.create(
    model='gemini-3.6-flash',
    config=genai.types.GenerateContentConfig(
        system_instruction=sys_prompt,
        tools=[check_inventory], # We just handed the AI the database keys!
        temperature=0.1, # Low temperature makes the AI more precise and factual
    )
)
# 1. Create the Traffic Light for the AI
chat_lock = asyncio.Lock()

# (Keep your sys_prompt and chat_session here exactly as they are)

@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    async def stream_generator():
        # 2. Turn on the traffic light so messages safely wait their turn!
        async with chat_lock:
            try:
                response_stream = await chat_session.send_message_stream(req.message)
                async for chunk in response_stream:
                    if chunk.text:
                        yield chunk.text
            except Exception as e:
                print(f"🚨 STREAM ERROR: {str(e)}")
                yield "⚠️ Connection lost."

    return StreamingResponse(
        stream_generator(), 
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )
@app.get("/agent/deliveries")
def get_active_deliveries(delivery_db: Session = Depends(get_delivery_db)):
    """Fetches all orders currently out for delivery."""
    # Note: Adjust the status string based on what you used in your order creation logic!
    # Common statuses: "PENDING", "PROCESSING", "OUT FOR DELIVERY"
    # .ilike() ignores case, so it will catch "PENDING", "pending", or "Pending"
    deliveries = delivery_db.query(Order).filter(Order.status.ilike("pending")).all()
    # Format the data for the mobile frontend
    result = []
    for order in deliveries:
        # Fetch the real grocery items linked to this specific order ID
        items_in_db = delivery_db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
        
        # Format them exactly how your frontend expects: "2x Maggi Noodles (₹24.0)"
        formatted_items = [
            f"{item.quantity}x {item.item_name} (₹{item.price * item.quantity})" 
            for item in items_in_db
        ]

        result.append({
            "order_id": order.id,
            "smart_card": f"Beneficiary ID: {order.user_id}",
            "total_amount": order.total_amount,
            "status": order.status,
            "items": formatted_items # <-- Replaced the hardcoded [] with the real data!
        })
    return result

@app.put("/agent/deliveries/{order_id}/complete")
def complete_delivery(order_id: int, delivery_db: Session = Depends(get_delivery_db)):
    """Marks an order as successfully delivered."""
    order = delivery_db.query(Order).filter(Order.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
        
    order.status = "DELIVERED"
    delivery_db.commit()
    
    return {"message": f"Order {order_id} successfully marked as DELIVERED."}
class CartItem(BaseModel):
    name: str
    price: float
    quantity: int

class CheckoutRequest(BaseModel):
    smart_card_id: str
    total_amount: float
    items: List[CartItem]

# --- ENDPOINT: Process the transaction ---
from fastapi import HTTPException, Depends

@app.post("/checkout")
async def process_checkout(req: dict):
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    
    try:
        items = req.get("items", [])
        smart_card_id = req.get("smart_card_id", "Unknown")
        total_amount = req.get("total_amount", 0)
        
        # 1. Check stock for all items
        for item in items:
            item_name = item.get("name")
            req_qty = item.get("quantity")
            
            cursor.execute("SELECT stock FROM inventory WHERE item_name = ?", (item_name,))
            row = cursor.fetchone()
            
            if not row:
                return {"success": False, "message": f"Item '{item_name}' not found."}
            if row[0] < req_qty:
                return {"success": False, "message": f"Not enough stock for {item_name}."}

        # 2. Deduct the stock
        for item in items:
            item_name = item.get("name")
            req_qty = item.get("quantity")
            cursor.execute("UPDATE inventory SET stock = stock - ? WHERE item_name = ?", (req_qty, item_name))
        
        # 3. SAVE THE TICKET FOR THE ADMIN PANEL (This is what was missing!)
        items_json = json.dumps(items)
        cursor.execute("INSERT INTO orders (smart_card_id, items, total_amount, status) VALUES (?, ?, ?, 'pending')", 
                      (smart_card_id, items_json, total_amount))
            
        conn.commit()
        return {"success": True, "message": "Checkout successful!"}
        
    except Exception as e:
        return {"success": False, "message": str(e)}
    finally:
        conn.close()
@app.get("/orders")
async def get_orders():
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    try:
        # Fetch all orders that are still pending
        cursor.execute("SELECT id, smart_card_id, items, total_amount FROM orders WHERE status = 'pending'")
        rows = cursor.fetchall()
        
        orders = []
        for row in rows:
            orders.append({
                "id": row[0],
                "smart_card_id": row[1],
                "items": json.loads(row[2]), # Turn the JSON string back into a JavaScript array
                "total_amount": row[3]
            })
            
        return {"success": True, "orders": orders}
    except Exception as e:
        return {"success": False, "message": str(e)}
    finally:
        conn.close()
    
@app.post("/complete-order/{order_id}")
async def complete_order(order_id: int):
    conn = sqlite3.connect("canteen.db")
    cursor = conn.cursor()
    try:
        # Change the order status so it no longer shows up on the admin panel
        cursor.execute("UPDATE orders SET status = 'completed' WHERE id = ?", (order_id,))
        conn.commit()
        return {"success": True, "message": f"Order {order_id} completed."}
    except Exception as e:
        return {"success": False, "message": str(e)}
    finally:
        conn.close()