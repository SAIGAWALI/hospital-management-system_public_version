// server.js - FULL CODE
require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const allowedOrigins = [
  'https://saigawalihms.netlify.app'       // The ONLY public site allowed
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

// Increase limit for profile photo uploads
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// --- FILE SYSTEM SETUP ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// --- REAL-TIME SERVER ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE CONNECTION ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

if (process.env.DB_HOST !== 'localhost') {
    dbConfig.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

const db = mysql.createPool(dbConfig);

db.getConnection((err, connection) => {
    if (err) console.error('❌ Database Pool Error:', err.message);
    else {
        console.log('✅ Connected to Database');
        connection.release(); 
    }
});

// ================= API ROUTES =================

// 1. GET ALL DOCTORS (For Booking & Admin Filter)
// 1. GET DOCTORS (Updated: Filters out General Doctor & Gets Degree)
app.get('/doctors', (req, res) => {
    // We check that name is NOT 'admin' or 'super'
    const sql = "SELECT id, name, degree FROM admins WHERE role NOT IN ('admin', 'super')";
    
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 2. GET MASTER SLOTS (Filtered by Doctor)
//  FIXED: Fetch slots ONLY for the specific doctor
app.get('/master-slots', (req, res) => {
    const docId = req.query.doctor_id; // Get the ID sent from frontend

    if (!docId) {
        // If no doctor is selected, return empty list (or handle as you wish)
        return res.json([]); 
    }

    const sql = "SELECT * FROM master_slots WHERE doctor_id = ? ORDER BY slot_time ASC";
    db.query(sql, [docId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 3. GET BOOKED SLOTS (Filtered by Date & Doctor)
app.get('/booked-slots', (req, res) => {
    const { date, doctor_id } = req.query; // Get doctor_id from request
    const sql = "SELECT slot_time FROM appointments WHERE date = ? AND doctor_id = ?";
    db.query(sql, [date, doctor_id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 4. BOOK APPOINTMENT (Now requires doctor_id)
app.post('/book', (req, res) => {
    const { name, age, phone, description, time, date, userId, doctor_id } = req.body; // Added doctor_id
    
    // STEP 1: Check if Portal is OPEN
    db.query("SELECT setting_value FROM settings WHERE setting_key = 'portal_status'", (err, results) => {
        if (err) return res.status(500).json({ message: "DB Error" });
        
        const status = (results.length > 0) ? results[0].setting_value : 'closed';
        if (status === 'closed') {
            return res.status(400).json({ message: "Booking Failed: Admin has closed the portal." });
        }

        // STEP 2: Time Travel Check
        // STEP 2: Time Travel Check (Bulletproof Math Version)
        // A. Manually Calculate India Time (UTC + 5.5 hours)
        const now = new Date();
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000); // Convert to pure UTC
        const indiaTime = new Date(utcTime + (5.5 * 60 * 60 * 1000)); // Add 5.5 Hours (IST Offset)
        
        const curYear = indiaTime.getFullYear();
        const curMonth = indiaTime.getMonth() + 1;
        const curDay = indiaTime.getDate();
        const curHour = indiaTime.getHours();
        const curMin = indiaTime.getMinutes();

        // B. Parse the Incoming Booking Data
        const [bYear, bMonth, bDay] = date.split('-').map(Number);
        const [bHour, bMin] = time.split(':').map(Number);

        console.log(`Checking: Booking [${bYear}-${bMonth}-${bDay} ${bHour}:${bMin}] vs India [${curYear}-${curMonth}-${curDay} ${curHour}:${curMin}]`);

        // D. The Comparison Logic
        // 1. If booking is in a past year/month/day -> BLOCK
        if (bYear < curYear || 
           (bYear === curYear && bMonth < curMonth) || 
           (bYear === curYear && bMonth === curMonth && bDay < curDay)) {
             return res.status(400).json({ message: "Error: Cannot book for a past date." });
        }

        // 2. If it is TODAY, check the time -> BLOCK if passed
        if (bYear === curYear && bMonth === curMonth && bDay === curDay) {
            if (bHour < curHour) {
                return res.status(400).json({ message: "Error: Time slot has passed!" });
            }
            if (bHour === curHour && bMin <= curMin) {
                 return res.status(400).json({ message: "Error: Time slot has passed!" });
            }
        }
        // STEP 3: Check Availability FOR THIS DOCTOR ONLY
        // added "AND doctor_id = ?" here
        const checkSql = "SELECT * FROM appointments WHERE date = ? AND slot_time = ? AND doctor_id = ?";
        
        db.query(checkSql, [date, time, doctor_id], (err, results) => {
            if (results.length > 0) return res.status(400).json({ message: "Slot taken for this doctor" });

            // Insert with doctor_id
            const insertSql = "INSERT INTO appointments (name, age, phone, description, slot_time, date, patient_id, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
            db.query(insertSql, [name, age, phone, description, time, date, userId, doctor_id], (err) => {
                if (err) {
                    console.error("❌ SQL ERROR:", err);
                    return res.status(500).json({ message: "Save Error" });
                }
                
                // Emit event with doctor_id so frontend knows WHICH doctor's slot to disable
                io.emit("slot_booked", { date, time, doctor_id });
                res.json({ message: "Booked!" });
            });
        });
    });
});
// 5. ADMIN/DOCTOR LOGIN
app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;
    db.query("SELECT * FROM admins WHERE username = ? AND password = ?", [username, password], (err, results) => {
        if (err || results.length === 0) {
            return res.status(401).json({ success: false, message: "Invalid Credentials" });
        }
        const user = results[0];
        res.json({ 
            success: true, 
            role: user.role, 
            id: user.id, 
            name: user.name 
        });
    });
});

// 6. GET APPOINTMENTS (Admin Dashboard - Filterable)
app.get('/admin/appointments', (req, res) => {
    const { date, doctor_id } = req.query;
    
    let sql = "SELECT * FROM appointments WHERE date = ?";
    let params = [date];

    // Filter by doctor if provided
    if (doctor_id && doctor_id !== 'all') {
        sql += " AND doctor_id = ?";
        params.push(doctor_id);
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});
app.get('/patient/appointments', (req, res) => {
    const { date, patient_id } = req.query;
    const sql = "SELECT * FROM appointments WHERE date = ? AND patient_id = ?";
    
    db.query(sql, [date, patient_id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});
app.get('/doctor_name', (req, res) => {
    const {docId} = req.query;
    
    let sql = "SELECT name FROM admins WHERE id = ?";
    let params = [docId];
    db.query(sql, params,(err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 7. ADMIN: ADD SLOT (For Specific Doctor)
app.post('/admin/add-slot', (req, res) => {
    const { time, doctor_id } = req.body;
    
    // console.log("Adding slot:", time, "for Doctor ID:", doctor_id); // <--- DEBUG LOG

    db.query("INSERT INTO master_slots (slot_time, doctor_id) VALUES (?, ?)", [time, doctor_id], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

// 8. ADMIN: RESET SLOTS
app.post('/admin/reset-slots', (req, res) => {
    const { doctor_id } = req.body;
    
    // Default Slots: 09:00 to 11:40
    const defaults = [
        ['09:00', doctor_id], ['09:20', doctor_id], ['09:40', doctor_id],
        ['10:00', doctor_id], ['10:20', doctor_id], ['10:40', doctor_id],
        ['11:00', doctor_id], ['11:20', doctor_id], ['11:40', doctor_id]
    ];

    // First delete existing slots for this doctor
    db.query("DELETE FROM master_slots WHERE doctor_id = ?", [doctor_id], (err) => {
        if(err) return res.status(500).json({success: false});
        
        // Then insert defaults
        db.query("INSERT INTO master_slots (slot_time, doctor_id) VALUES ?", [defaults], (err) => {
            if(err) return res.status(500).json({success: false});
            res.json({ success: true });
        });
    });
});

// 9. ADMIN: DELETE SLOT
app.delete('/admin/delete-slot/:id', (req, res) => {
    db.query("DELETE FROM master_slots WHERE id = ?", [req.params.id], (err) => {
        res.json({ success: true });
    });
});

// 10. CREATE NEW DOCTOR/ADMIN (With Name)
app.post('/create-admin', (req, res) => {
    const secretKey = process.env.ADMIN_SECRET; 
    
    if (req.body.admin_secret !== secretKey) {
        return res.status(403).json({ message: "Access Denied! You don't have the secret." });
    }    db.query("INSERT INTO admins (username, password, role, name, degree) VALUES (?, ?, ?, ?, ?)", 
        [req.body.newUsername, req.body.newPassword, req.body.newrole, req.body.newName, req.body.newDegree], 
        (err) => res.json({ success: true }));
});


// 11. PRESCRIBE MEDICINE
app.post('/admin/prescribe', (req, res) => {
    const { appointment_id, patient_id, diagnosis, medicines, notes } = req.body;
    const medString = JSON.stringify(medicines);

    const sql = "INSERT INTO prescriptions (appointment_id, patient_id, diagnosis, medicines, notes) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [appointment_id, patient_id, diagnosis, medString, notes], (err) => {
        if (err) return res.status(500).json({ success: false });
        
        db.query("UPDATE appointments SET status = 'Done' WHERE id = ?", [appointment_id]);
        res.json({ success: true });
    });
});

// 12. FETCH PRESCRIPTION (Joins with Doctor Name)
app.get('/admin/prescription-by-appt/:id', (req, res) => {
    const sql = `
        SELECT p.*, 
               a.date as visit_date, 
               a.name as patient_name, 
               a.age as patient_age,
               doc.name as doctor_name,
               pat.gender as gender
        FROM prescriptions p 
        JOIN appointments a ON p.appointment_id = a.id 
        LEFT JOIN admins doc ON a.doctor_id = doc.id
        LEFT JOIN patients pat ON p.patient_id = pat.user_id
        WHERE p.appointment_id = ?`;

    db.query(sql, [req.params.id], (err, result) => {
        if(err) return res.status(500).json({ message: "DB Error" });
        if(result.length === 0) return res.status(404).json({ message: "Not Found" });
        res.json(result[0]);
    });
});

// 13. PATIENT HISTORY (Includes Doctor Name)
app.get('/patient/history/:id', (req, res) => {
    const sql = `
        SELECT p.*, 
               a.date as visit_date, 
               a.name as patient_name,
               a.age as patient_age,
               doc.name as doctor_name,
               pat.gender as gender
        FROM prescriptions p 
        JOIN appointments a ON p.appointment_id = a.id
        LEFT JOIN admins doc ON a.doctor_id = doc.id
        LEFT JOIN patients pat ON p.patient_id = pat.user_id
        WHERE p.patient_id = ? 
        ORDER BY p.date DESC`;
        
    db.query(sql, [req.params.id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// --- PATIENT PROFILE & PHOTO UPLOADS ---
app.post('/save-user', (req, res) => {
    const { uid, name, email, gender } = req.body;
    const sql = "INSERT IGNORE INTO patients (user_id, name, email, gender) VALUES (?, ?, ? ,?)";
    db.query(sql, [uid, name, email, gender], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.get('/patient/profile/:uid', (req, res) => {
    db.query("SELECT * FROM patients WHERE user_id = ?", [req.params.uid], (err, result) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        if (result.length === 0) return res.status(404).json({ error: "User not found" });
        res.json(result[0]);
    });
});

app.put('/patient/profile', (req, res) => {
    const { uid, name, phone, gender} = req.body;
    const sql = "UPDATE patients SET name = ?, phone = ?, gender = ? WHERE user_id = ?";
    db.query(sql, [name, phone, gender,uid], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// --- UPLOAD PROFILE PHOTO (Cloudinary Version) ---
app.post('/patient/upload-photo', (req, res) => {
    const { uid, photo_url } = req.body;
    
    // Validation: Ensure we got a URL
    if (!photo_url) return res.status(400).json({ success: false, message: "No URL provided" });

    // Simply update the database with the URL string
    const sql = "UPDATE patients SET photo_url = ? WHERE user_id = ?";
    
    db.query(sql, [photo_url, uid], (err) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).json({ success: false, message: "DB Error" });
        }
        res.json({ success: true });
    });
});

// --- ADMIN MANAGEMENT ROUTES ---
app.get('/admins', (req, res) => {
    db.query("SELECT id, username, role, name FROM admins", (err, results) => res.json(results));
});

app.delete('/admins/:id', (req, res) => {
    if (req.body.requesterRole !== 'super') return res.status(403).json({ message: "Denied" });
    db.query("DELETE FROM admins WHERE id = ?", [req.params.id], (err) => res.json({ success: true }));
});

// --- SETTINGS ---
app.get('/status', (req, res) => {
    db.query("SELECT setting_value FROM settings WHERE setting_key = 'portal_status'", (err, results) => {
        res.json({ status: (results && results.length > 0) ? results[0].setting_value : 'closed' });
    });
});

app.post('/admin/toggle-status', (req, res) => {
    db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('portal_status', ?) ON DUPLICATE KEY UPDATE setting_value = ?", 
        [req.body.status, req.body.status], 
        (err) => res.json({ success: true }));
});

// Appointment Actions
app.put('/appointments/:id', (req, res) => {
    db.query("UPDATE appointments SET status = 'Done' WHERE id = ?", [req.params.id], (err) => res.json({ success: true }));
});

app.delete('/appointments/:id', (req, res) => {
    db.query("DELETE FROM appointments WHERE id = ?", [req.params.id], (err) => res.json({ success: true }));
});
// --- NEW ROUTE: Save Google/Firebase User to DB ---
app.post('/save-user', (req, res) => {
    const { uid, name, email } = req.body;

    // "INSERT IGNORE" means: If this ID already exists, do nothing. 
    // If it's new, insert it.
    const sql = "INSERT IGNORE INTO patients (user_id, name, email) VALUES (?, ?, ?)";
    
    db.query(sql, [uid, name, email], (err, result) => {
        if (err) {
            console.error("❌ Save User Error:", err);
            return res.status(500).json({ success: false, message: "DB Error" });
        }
        res.json({ success: true, message: "User saved" });
    });
});

// --- PRESCRIPTIONS & HISTORY ---

// 1. Save a Prescription (Doctor Only)
app.post('/admin/prescribe', (req, res) => {
    const { appointment_id, patient_id, diagnosis, medicines, notes } = req.body;
    
    // We store medicines as a JSON string for flexibility
    const medString = JSON.stringify(medicines);

    const sql = "INSERT INTO prescriptions (appointment_id, patient_id, diagnosis, medicines, notes) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [appointment_id, patient_id, diagnosis, medString, notes], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: "DB Error" });
        }
        
        // Also mark the appointment as "Done" automatically
        db.query("UPDATE appointments SET status = 'Done' WHERE id = ?", [appointment_id]);
        
        res.json({ success: true });
    });
});

// 2. Get History (Debug Version)
// Get History (Fixed: Removed 'gender' to prevent crash)
app.get('/patient/history/:id', (req, res) => {
    const pid = req.params.id;
    
    // REMOVED: 'a.gender as patient_gender' because it doesn't exist in your DB yet
    const sql = `
        SELECT p.*, 
               a.date as visit_date, 
               a.name as patient_name, 
               a.age as patient_age
        FROM prescriptions p 
        JOIN appointments a ON p.appointment_id = a.id 
        WHERE p.patient_id = ? 
        ORDER BY p.date DESC`;
        
    db.query(sql, [pid], (err, results) => {
        if (err) {
            console.error("❌ History Error:", err); // This prints the error to the terminal
            return res.status(500).send(err);
        }
        res.json(results);
    });
});
// Get Single Prescription 
app.get('/admin/prescription-by-appt/:id', (req, res) => {
    const apptId = req.params.id;
    
    const sql = `
        SELECT p.*, 
               a.date as visit_date, 
               a.name as patient_name, 
               a.age as patient_age
        FROM prescriptions p 
        JOIN appointments a ON p.appointment_id = a.id 
        WHERE p.appointment_id = ?`;

    db.query(sql, [apptId], (err, result) => {
        if(err) {
            console.error("❌ Admin Print Error:", err);
            // return JSON now, so  frontend won't get "Unexpected token D"
            return res.status(500).json({ message: "Database Error: " + err.message });
        }
        if(result.length === 0) {
            return res.status(404).json({ message: "Prescription not found" });
        }
        res.json(result[0]); 
    });
});
// --- GET ALL PATIENTS (Simple List) ---
app.get('/admin/patients', (req, res) => {
    // Just get the registered users
    db.query("SELECT * FROM patients", (err, results) => {
        if (err) return res.status(500).json({ error: "DB Error" });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));