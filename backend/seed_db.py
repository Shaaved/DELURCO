from database import SessionLocal
from models import User, Inventory

def seed_data():
    db = SessionLocal()
    
    # 1. Create a registered app user linked to our mock CSD card
    if not db.query(User).first():
        print("Adding test user to app database...")
        new_user = User(
            smart_card_id="CSD-1001", 
            name="Shaaved",
            address="Block A, Cantonment Quarters",
            phone="9876543210"
        )
        db.add(new_user)
    
    # 2. Add some local URC inventory
    if not db.query(Inventory).first():
        print("Adding URC inventory...")
        items = [
            Inventory(item_name="Aashirvaad Atta 5kg", category="grocery", price=250.0, stock_quantity=50),
            Inventory(item_name="Maggi Noodles 12-pack", category="grocery", price=140.0, stock_quantity=100),
            Inventory(item_name="Parle-G Biscuit Box", category="grocery", price=60.0, stock_quantity=200)
        ]
        db.add_all(items)
        
    db.commit()
    db.close()
    print("Database seeded successfully! You are ready to test.")

if __name__ == "__main__":
    seed_data()