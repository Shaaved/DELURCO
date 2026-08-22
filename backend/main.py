from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
from datetime import timedelta
import torch
import json
import random
from chat_model import NeuralNet, bag_of_words, tokenize
import re
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
# --- INITIALIZE DELURC AI CHATBOT ---
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# Load the conversational intents
with open('intents.json', 'r') as json_data:
    intents = json.load(json_data)

# Load the trained neural network weights
FILE = "data.pth"
data = torch.load(FILE)

input_size = data["input_size"]
hidden_size = data["hidden_size"]
output_size = data["output_size"]
all_words = data['all_words']
tags = data['tags']
model_state = data["model_state"]

# Rebuild the model architecture and apply the trained weights
ai_model = NeuralNet(input_size, hidden_size, output_size).to(device)
ai_model.load_state_dict(model_state)
ai_model.eval() # Set to evaluation mode

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
@app.post("/chat")
def chat_with_bot(request: ChatRequest, delivery_db: Session = Depends(get_delivery_db)):
    """Processes natural language input, extracts entities, and returns an AI response."""
    sentence = tokenize(request.message)
    X = bag_of_words(sentence, all_words)
    X = X.reshape(1, X.shape[0])
    X = torch.from_numpy(X).to(device)

    # Push the data through the neural network
    output = ai_model(X)
    _, predicted = torch.max(output, dim=1)
    
    tag = tags[predicted.item()]
    probs = torch.softmax(output, dim=1)
    prob = probs[0][predicted.item()]
    
    if prob.item() > 0.75:
        for intent in intents['intents']:
            if tag == intent["tag"]:
                
                # Base AI response payload
                response_data = {
                    "response": random.choice(intent['responses']), 
                    "intent": tag,
                    "confidence": prob.item()
                }

                # --- NEW: ENTITY EXTRACTION LOGIC ---
                if tag == "order_item":
                    user_text = request.message.lower()
                    
                    # 1. Extract Quantity (look for digits, default to 1)
                    quantities = [int(s) for s in re.findall(r'\b\d+\b', user_text)]
                    qty = quantities[0] if quantities else 1
                    
                   # 2. Extract Item by scanning the active database
                    inventory = delivery_db.query(Inventory).filter(Inventory.stock_quantity > 0).all()
                    extracted_item = None
                    extracted_price = 0
                    for item in inventory:
                        db_name = item.item_name.lower()
                        # 1. Try an exact match first
                        if db_name in user_text:
                            extracted_item = item.item_name
                            extracted_price = item.price
                            break
                        
                        # 2. Try a partial match (e.g. matching "maggi" to "Maggi Noodles")
                        db_words = [w for w in db_name.split() if len(w) > 3] # Ignore small words
                        user_words = user_text.split()
                        
                        if any(word in user_words for word in db_words):
                            extracted_item = item.item_name
                            extracted_price = item.price
                            break
                    
                    # 3. Append extracted data for the frontend cart
                    if extracted_item:
                        response_data["extracted_item"] = extracted_item
                        response_data["extracted_price"] = extracted_price
                        response_data["extracted_qty"] = qty
                        response_data["response"] += f" I am adding {qty}x {extracted_item} to your cart."
                    else:
                        response_data["response"] = "I understand you want to order, but I couldn't find that exact item in our current stock. Please check the inventory list."
                
                return response_data
    
    return {
        "response": "I am sorry, I didn't quite catch that. Could you rephrase your request?", 
        "intent": "unknown",
        "confidence": prob.item()
    }
# --- DELIVERY AGENT PORTAL ENDPOINTS ---

@app.get("/agent/deliveries")
def get_active_deliveries(delivery_db: Session = Depends(get_delivery_db)):
    """Fetches all orders currently out for delivery."""
    # Note: Adjust the status string based on what you used in your order creation logic!
    # Common statuses: "PENDING", "PROCESSING", "OUT FOR DELIVERY"
    deliveries = delivery_db.query(Order).filter(Order.status == "out_for_delivery").all()
    
    # Format the data for the mobile frontend
    result = []
    for order in deliveries:
        result.append({
            "order_id": order.id,
            "smart_card": f"Beneficiary ID: {order.user_id}", # <-- Matched to your exact database column
            "total_amount": order.total_amount,
            "status": order.status,
            "items": [] # <-- Hardcoded to an empty list to prevent the items_json crash
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