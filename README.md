# 🏥 Hospital Management System

A comprehensive web-based platform for managing hospital operations, developed as a full-stack portfolio project. This system streamlines the interaction between patients, doctors, and administrators, featuring secure authentication and real-time data management.

## 🚀 Live Demo
https://saigawalihms.netlify.app/
## 🛠️ Tech Stack
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla), Socket.io (Client)
* **Backend:** Node.js, Express.js
* **Database:** MySQL (TiDB Cloud)
* **Real-time:** Socket.io (for booking updates)
* **Security:** CORS protection, Environment Variable management, Role-Based Access Control (RBAC)

## ✨ Key Features
* **User Roles:** Separate portals for Super Admins, Doctors, Receptionists, and Patients.
* **Smart Appointment Booking:** Prevents double-booking and "time-travel" (booking past slots) using server-side validation.
* **Doctor Dashboard:** View appointments, access patient history, and manage availability slots.
* **Digital Prescriptions:** Doctors can generate digital prescriptions that are printable and saved to the patient's history.
* **Admin Controls:** "Emergency Mode" to close the portal, staff management, and slot configuration.
* **Secure Authentication:** Custom login system with password reset capabilities (simulated).


## 📦 How to Run Locally
1. Clone the repository.
2. Create a `.env` file with your database credentials.
3. Run `npm install` to install dependencies.
4. Run `node server.js` to start the backend.