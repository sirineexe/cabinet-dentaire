/**
 * Database Module for Dental Practice Software (Cabinet Dentaire)
 * Uses native node:sqlite DatabaseSync with WAL mode and ACID transactions.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data directory and backup directory exist
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cabinet.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency & rock-solid crash recovery
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`);

function initSchema() {
  db.exec(`
    -- Settings table
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Dentists table
    CREATE TABLE IF NOT EXISTS dentists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      speciality TEXT DEFAULT 'Chirurgien-dentiste',
      color TEXT NOT NULL DEFAULT '#2563eb',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Reason / Motifs table with default durations
    CREATE TABLE IF NOT EXISTS reasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      default_duration INTEGER NOT NULL DEFAULT 30,
      color TEXT DEFAULT '#3b82f6'
    );

    -- Patients table
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      email TEXT,
      date_naissance TEXT,
      remarques_medicales TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Appointments table (Rendez-vous)
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,            -- YYYY-MM-DD
      heure_debut TEXT NOT NULL,     -- HH:MM
      heure_fin TEXT NOT NULL,       -- HH:MM
      duree INTEGER NOT NULL,        -- in minutes
      patient_nom TEXT NOT NULL,
      patient_prenom TEXT NOT NULL,
      patient_telephone TEXT NOT NULL,
      patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      motif TEXT NOT NULL,
      dentiste_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
      statut TEXT NOT NULL DEFAULT 'À confirmer', -- À confirmer, Confirmé, Venu, Absent, Annulé, Reporté
      rappel_effectue INTEGER NOT NULL DEFAULT 0, -- 0 = non, 1 = oui
      rappel_date DATETIME,
      remarque TEXT,
      created_by TEXT DEFAULT 'Secrétariat',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for fast querying
    CREATE INDEX IF NOT EXISTS idx_rdv_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_rdv_patient ON appointments(patient_nom, patient_prenom);
    CREATE INDEX IF NOT EXISTS idx_rdv_telephone ON appointments(patient_telephone);
    CREATE INDEX IF NOT EXISTS idx_rdv_dentiste ON appointments(dentiste_id);
    CREATE INDEX IF NOT EXISTS idx_rdv_statut ON appointments(statut);

    -- Users / Operators table for multi-user session identification
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'secretaire',
      pin TEXT DEFAULT '0000',
      dentiste_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL
    );

    -- Audit log table for multi-user accountability
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      operator TEXT NOT NULL,
      action TEXT NOT NULL,
      appointment_id INTEGER,
      details TEXT
    );
  `);

  // Seed default settings if empty
  const defaultSettings = [
    ['cabinet_name', 'Cabinet Dentaire'],
    ['cabinet_phone', '0555 12 34 56'],
    ['opening_time', '08:00'],
    ['closing_time', '17:00'],
    ['slot_duration', '30'],
    ['first_day_of_week', 'Dimanche'],
    ['closed_day_1', 'Vendredi'],
    ['closed_day_2', ''],
    ['reminder_days_ahead', '1']
  ];

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, val] of defaultSettings) {
    if (!getSetting.get(key)) {
      insertSetting.run(key, val);
    }
  }

  // Seed default dentists if empty
  const countDentists = db.prepare('SELECT COUNT(*) as c FROM dentists').get();
  if (countDentists.c === 0) {
    const insertDentist = db.prepare('INSERT INTO dentists (name, speciality, color, active) VALUES (?, ?, ?, 1)');
    insertDentist.run('Dr. Benali', 'Chirurgien-dentiste', '#2563eb');
    insertDentist.run('Dr. Khelil', 'Orthodontiste', '#059669');
  }

  // Seed default reasons from the sheet if empty
  const countReasons = db.prepare('SELECT COUNT(*) as c FROM reasons').get();
  if (countReasons.c === 0) {
    const insertReason = db.prepare('INSERT INTO reasons (name, default_duration, color) VALUES (?, ?, ?)');
    const defaultReasons = [
      ['Consultation', 30, '#3b82f6'],
      ['Contrôle', 30, '#0284c7'],
      ['Détartrage', 30, '#0d9488'],
      ['Carie / soin', 30, '#e11d48'],
      ['Dévitalisation (canal)', 60, '#7c3aed'],
      ['Extraction', 30, '#dc2626'],
      ['Prothèse (empreinte / pose)', 45, '#d97706'],
      ['Orthodontie', 30, '#9333ea'],
      ['Urgence', 30, '#ef4444'],
      ['Blanchiment', 60, '#06b6d4'],
      ['Radio', 15, '#64748b'],
      ['Autre', 30, '#6b7280']
    ];
    for (const [name, dur, color] of defaultReasons) {
      insertReason.run(name, dur, color);
    }
  }

  // Create automatic daily backup on startup
  createAutoBackup();
}

// Automatic daily backup creation
function createAutoBackup() {
  try {
    db.exec('PRAGMA wal_checkpoint(PASSIVE);');
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const backupFile = path.join(BACKUP_DIR, `sauvegarde_${dateStr}.db`);

    // Only backup once per day automatically or if not exists
    if (!fs.existsSync(backupFile)) {
      fs.copyFileSync(DB_PATH, backupFile);
      console.log(`[Sauvegarde Automatique] Base copiée avec succès dans : ${backupFile}`);
    }
  } catch (err) {
    console.warn('[Sauvegarde Automatique] Erreur non bloquante :', err.message);
  }
}

// Flush and checkpoint database WAL before process exit
function checkpointWAL() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.error('Erreur checkpoint WAL:', err);
  }
}

// Helper: Calculate end time given HH:MM and duration in minutes
function calculateEndTime(startTime, durationMinutes) {
  const [hours, mins] = startTime.split(':').map(Number);
  const totalMins = hours * 60 + mins + durationMinutes;
  const endHours = Math.floor(totalMins / 60) % 24;
  const endMins = totalMins % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
}

// Convert HH:MM to minutes from midnight
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Conflict Detection Engine: Check for overlapping appointments
function checkAppointmentConflict(date, startTime, endTime, dentistId, excludeAppointmentId = null) {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  let sql = `
    SELECT a.*, d.name as dentiste_nom
    FROM appointments a
    LEFT JOIN dentists d ON a.dentiste_id = d.id
    WHERE a.date = ?
      AND a.statut NOT IN ('Annulé', 'Reporté')
  `;
  const params = [date];

  if (excludeAppointmentId) {
    sql += ` AND a.id != ?`;
    params.push(excludeAppointmentId);
  }

  const existingList = db.prepare(sql).all(...params);

  for (const rdv of existingList) {
    const rdvStart = timeToMinutes(rdv.heure_debut);
    const rdvEnd = timeToMinutes(rdv.heure_fin);

    const hasTimeOverlap = startMin < rdvEnd && endMin > rdvStart;
    if (!hasTimeOverlap) continue;

    const dentistConflict =
      !dentistId ||
      !rdv.dentiste_id ||
      Number(dentistId) === Number(rdv.dentiste_id);

    if (dentistConflict) {
      return {
        hasConflict: true,
        conflictingWith: {
          id: rdv.id,
          patient: `${rdv.patient_nom} ${rdv.patient_prenom}`,
          heure_debut: rdv.heure_debut,
          heure_fin: rdv.heure_fin,
          motif: rdv.motif,
          dentiste: rdv.dentiste_nom || 'Non spécifié (Cabinet entier)'
        }
      };
    }
  }

  return { hasConflict: false };
}

// Audit logging helper
function logAudit(operator, action, appointmentId, details) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (operator, action, appointment_id, details)
      VALUES (?, ?, ?, ?)
    `).run(
      operator || 'Système',
      action,
      appointmentId || null,
      typeof details === 'object' ? JSON.stringify(details) : String(details || '')
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// Auto-upsert patient record from appointment info
function upsertPatient(nom, prenom, telephone) {
  if (!nom || !telephone) return null;
  const cleanNom = nom.trim();
  const cleanPrenom = (prenom || '').trim();
  const cleanTel = telephone.trim();

  const existing = db.prepare(`
    SELECT id FROM patients 
    WHERE (LOWER(nom) = LOWER(?) AND LOWER(prenom) = LOWER(?))
       OR telephone = ?
  `).get(cleanNom, cleanPrenom, cleanTel);

  if (existing) {
    db.prepare(`
      UPDATE patients 
      SET nom = ?, prenom = ?, telephone = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanNom, cleanPrenom, cleanTel, existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO patients (nom, prenom, telephone)
      VALUES (?, ?, ?)
    `).run(cleanNom, cleanPrenom, cleanTel);
    return res.lastInsertRowid;
  }
}

module.exports = {
  db,
  DB_PATH,
  BACKUP_DIR,
  initSchema,
  createAutoBackup,
  checkpointWAL,
  calculateEndTime,
  timeToMinutes,
  checkAppointmentConflict,
  logAudit,
  upsertPatient
};
