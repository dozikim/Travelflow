# ✈️ TRAVELOOP
> **Intelligent & Collaborative Travel Planning**

[cite_start]Traveloop is a personalized, intelligent, and collaborative platform that transforms the way individuals plan and experience travel[cite: 4]. [cite_start]It empowers users to dream, design, and organize multi-city trips with ease by offering an end-to-end tool that combines flexibility and interactivity[cite: 5, 8].

---

### 🔄 APPLICATION FLOW
<p align="center">
  <img src="./Untitled-2026-05-10-1036.excalidraw.svg" width="550" alt="Traveloop Flowgraph">
</p>

---

### 🔑 DEMO CREDENTIALS
Explore the platform using these pre-configured accounts:

**👑 Administrative Access**
* **Email:** `admin@traveloop.test`
* **Password:** `admin12345`

**🧳 Traveler Access**
* **Email:** `mira@traveloop.test`
* **Password:** `traveloop123`

---

### 🎯 PROJECT MISSION
[cite_start]The platform aims to simplify the complexity of planning multi-city travel through intuitive user-centric tools[cite: 8].
* [cite_start]**Dynamic Itineraries**: Add and manage travel stops, activities, and durations[cite: 11].
* [cite_start]**Financial Clarity**: Automatically estimate trip budgets and receive detailed cost breakdowns[cite: 11, 21].
* [cite_start]**Community Sharing**: Share trip plans publicly or with friends to inspire others[cite: 13, 22].

---

### 🛠️ CORE FEATURES

#### 1. 🗺️ ITINERARY & DESTINATION MANAGEMENT
* [cite_start]**Itinerary Builder**: Construct a full day-wise trip plan in an interactive format[cite: 49].
* [cite_start]**City & Activity Search**: Discover destinations with metadata like cost index and popularity, and select activities categorized by interest[cite: 58, 64].
* [cite_start]**Trip Journal**: Jot down hotel check-in info, local contacts, or day-specific reminders[cite: 93].

#### 2. 💰 BUDGETING & LOGISTICS
* [cite_start]**Expense Tracking**: View cost breakdowns by transport, stay, activities, and meals with visual charts[cite: 71, 72].
* [cite_start]**Packing Checklist**: Manage a per-trip checklist for essential items like documents and electronics[cite: 74, 77].
* **PDF Invoicing**: Backend-generated PDF invoices featuring trip, user, and expense data.

#### 3. 🔐 SECURITY & ADMINISTRATION
* **Advanced Auth**: JWT authentication with httpOnly session cookie fallback and bcrypt password hashing.
* **Security Enforcement**: CSRF token enforcement, login CAPTCHA, and rate limiting.
* **Admin Panel**: Role-based access control to manage users (block/unblock), moderate community posts, and view audit logs.

---

### 📂 FOLDER STRUCTURE
```text
traveloop/
  server/          # Backend: Auth, DB, Security, and Seeding logic
  src/             # Frontend: Main React components and styles
  index.html       # Entry point
  package.json     # Project dependencies
  vite.config.js   # Build configuration


  🚀 SETUP & INSTALLATION

    Install Dependencies:
    PowerShell

    node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install

    Seed the Database:
    PowerShell

    node server/seed.js

    Launch the Development Environment:
    PowerShell

    node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev

    Access the Platform:
    Navigate to http://localhost:5173 in your browser.

🔗 RESOURCES

    Design Mockup: Excalidraw Visuals   

    Documentation: See API.md and SECURITY_CHECKLIST.md for technical deep-dives.
