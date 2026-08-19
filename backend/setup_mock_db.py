from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker

# 1. Define the SQLite database file connection
SQLALCHEMY_DATABASE_URL = "sqlite:///./mock_legacy_csd.db"

# connect_args={"check_same_thread": False} is required for SQLite in FastAPI
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 2. Define the Mock CSD Table Model
class MockCSDRecord(Base):
    __tablename__ = "csd_smart_cards"

    id = Column(Integer, primary_key=True, index=True)
    smart_card_id = Column(String, unique=True, index=True)
    monthly_grocery_limit = Column(Integer) # Amount in INR
    monthly_liquor_limit = Column(Integer)  # Number of units/bottles

# 3. Create the table and insert dummy data
def initialize_mock_database():
    # Create the table in the SQLite file
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    # Check if data already exists so we don't duplicate it
    if db.query(MockCSDRecord).first() is None:
        print("Populating mock CSD database with dummy users...")
        
        # Create some dummy beneficiary records
        users = [
            MockCSDRecord(smart_card_id="CSD-1001", monthly_grocery_limit=10000, monthly_liquor_limit=10),
            MockCSDRecord(smart_card_id="CSD-1002", monthly_grocery_limit=15000, monthly_liquor_limit=12),
            MockCSDRecord(smart_card_id="CSD-1003", monthly_grocery_limit=8000, monthly_liquor_limit=0) # E.g., restricted limit
        ]
        
        db.add_all(users)
        db.commit()
        print("Mock database created successfully!")
    else:
        print("Mock database already exists and is populated.")
        
    db.close()

if __name__ == "__main__":
    initialize_mock_database()