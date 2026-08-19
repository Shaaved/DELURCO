from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# This is your application's operational database, separate from the mock CSD db
SQLALCHEMY_DATABASE_URL = "sqlite:///./delivery_app.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()