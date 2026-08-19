from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base, engine

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    smart_card_id = Column(String, unique=True, index=True) 
    name = Column(String)
    address = Column(String)
    phone = Column(String)
    
    orders = relationship("Order", back_populates="customer")

class Inventory(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True, index=True)
    item_name = Column(String, index=True)
    category = Column(String)
    price = Column(Float)
    stock_quantity = Column(Integer)

class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    total_amount = Column(Float)
    status = Column(String, default="pending") 
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("User", back_populates="orders")
    
    # NEW: Link the order to multiple items
    items = relationship("OrderItem", back_populates="order")

# NEW: The table to track individual groceries in a cart
class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"))
    item_name = Column(String)
    price = Column(Float)
    quantity = Column(Integer, default=1)

    # Link back to the parent Order
    order = relationship("Order", back_populates="items")

if __name__ == "__main__":
    print("Rebuilding delivery app tables with OrderItem support...")
    Base.metadata.create_all(bind=engine)
    print("Database updated successfully!")