# 🚀 Shiv Furniture Works ERP

A premium, modern Enterprise Resource Planning (ERP) suite designed for furniture manufacturing businesses. This application features real-time inventory ledger tracking, procurement processing, shop floor work center scheduling, corporate role authorization, Razorpay secure invoice checkout, and Google OAuth sign-in.

---

## ✨ Features

* **📊 Interactive Dashboard**: High-fidelity visual KPIs and live reports showing sales revenue lines, manufacturing statuses, and product catalog distributions with smooth vector animations.
* **🔐 Google OAuth & Local Authentication**: Seamless authentication using Google accounts or username/password combinations.
* **💳 Integrated Razorpay Checkout**: Fully functional invoice creation and signature verification for online customer checkout.
* **💼 Access Control & Role Management**: Multi-tier corporate permissions (Admin, Business Owner, Sales, Procurement, Shop Floor, Inventory). Administrators can manage users, reset credentials, and toggle active status safely with built-in self-lockout protection.
* **📦 Smart Inventory Ledger**: Automatic stock allocation, safety level triggers, and ledger transactions.
* **🛠️ Shop Floor Scheduler**: Work center management and scheduling for Manufacturing Orders (MO).
* **📄 Bills of Materials (BoM)**: Material recipe definitions for finished goods.
* **📱 Responsive Layout & Hybrid Design**: Adaptive slate-indigo dashboard interface that collapses into an icon sidebar on tablets, slides off-screen on mobile devices with a custom drawer menu, and fits all mobile layouts.

---

## 🛠️ Technology Stack

* **Backend**: Node.js, Express, Passport.js, connect-pg-simple, bcryptjs, PG (node-postgres)
* **Database**: Neon Serverless PostgreSQL
* **Frontend**: HTML5 (Semantic Structure), CSS3 Custom properties (Variables & Media Queries), Vanilla JavaScript, Chart.js
* **Payments**: Razorpay Node SDK & Checkout integration

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (based on the sample format):

```env
# Neon PostgreSQL Connection URI
DATABASE_URL=postgresql://neondb_owner:...

# Server Port
PORT=3000

# Express Session Secret
SESSION_SECRET=your_long_random_session_key

# Google OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Razorpay Credentials (Test Mode recommended)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# App Root URL
APP_URL=http://localhost:3000
```

---

## 🚀 Setup & Installation

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database Schema
Execute the database setup script to compile the PostgreSQL tables, relations, and indexes:
```bash
npm run setup
```

### 3. Seed Demo Data
Populate the database with a high-fidelity dataset containing products, BOMs, contacts, sales, manufacturing orders, and audit logs:
```bash
npm run seed
```

### 4. Start the Application
Run the local development server:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 👥 Demo User Accounts

Use these pre-seeded accounts to explore the system:

| Role | Email Login | Password |
| :--- | :--- | :--- |
| **System Administrator** | `admin@shivfurniture.com` | `admin123` |
| **Business Owner** | `owner@shivfurniture.com` | `admin123` |
| **Sales Executive** | `sales@shivfurniture.com` | `user123` |
| **Manufacturing Manager**| `manufacturing@shivfurniture.com` | `user123` |
| **Procurement Officer** | `procurement@shivfurniture.com` | `user123` |

---

## 📦 Project Directory Layout
```
Mini Erp/
├── db/                     # DB client connection & schema definitions
│   ├── index.js
│   ├── seed.js             # High-fidelity mock seed data generator
│   └── setup-schema.js
├── middleware/             # Authorization middleware
├── routes/                 # Express REST API routing layers
│   ├── sales.js
│   ├── users.js
│   ├── manufacturing.js
│   ├── payments.js         # Razorpay checkout handler
│   └── ...
├── services/               # Background task scheduler and ledger services
├── public/                 # Web assets
│   ├── app.html            # Main SPA dashboard
│   ├── login.html          # Split-screen portal
│   ├── css/                # Custom slate-indigo styling
│   └── js/                 # Client framework and charts script
├── server.js               # Entry point
└── .env                    # Config secrets (Git ignored)
```
