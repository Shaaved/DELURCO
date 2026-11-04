# DELURCO — Defense Canteen (CSD) Smart Delivery Platform

> A specialized quick-commerce and doorstep delivery system for Indian Armed Forces personnel and veterans to access CSD canteen inventory without physical queues.

[[https://img.shields.io/badge/Demo-delurco.vercel.app-blue]](https://delurco.vercel.app)
[[https://img.shields.io/badge/API-FastAPI%20on%20Render-green]](https://delurco.onrender.com)
[[https://img.shields.io/badge/Python-3.10+-yellow.svg]](https://www.python.org/)

## System Architecture
* **Frontend**: Responsive multi-department web portal built with Vanilla HTML5, CSS3, and JavaScript, hosted on **Vercel**.
* **Backend API**: RESTful API service built with **FastAPI** and **Uvicorn**, hosted on **Render**.
* **Database & ORM**: Relational schema managed via **SQLAlchemy** (User, Inventory, Orders, CSD Smart Card entitlement verification).
* **AI Assistance**: Hybrid NLP engine featuring custom **PyTorch + NLTK** intent classification alongside **Google Gemini API** integration for canteen item inquiries.

## Key Features
* **Smart Card Entitlement Bouncer**: Validates defense service credentials against simulated legacy CSD records.
* **Department Catalogues**: Dedicated inventory modules for Groceries, Fresh Produce, Electronics, and Vehicles.
* **Cart & Delivery Workflow**: Client-side state synchronization with live delivery tracking dashboards.
* **Store Admin Portal**: Inventory restock controls and dispatch status management.

## Local Setup
1. Clone the repository:
   ```bash
   git clone [https://github.com/Shaaved/DELURCO.git](https://github.com/Shaaved/DELURCO.git)
   cd DELURCO/backend
