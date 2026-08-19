import sqlite3

# Connect directly to your SQLite database
conn = sqlite3.connect("delivery_app.db")
cursor = conn.cursor()

# Force all existing orders to the active delivery status
cursor.execute("UPDATE orders SET status = 'OUT FOR DELIVERY'")
conn.commit()

print(f"Success! Updated {cursor.rowcount} orders to 'OUT FOR DELIVERY'.")
conn.close()