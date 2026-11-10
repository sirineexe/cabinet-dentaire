/**
 * Server Module for Dental Practice Software (Cabinet Dentaire)
 * Multi-user, Real-time WebSockets, ACID Transactions, Safe Concurrency.
 * Automatic Cloudflare Public Tunnel for instant 24/7 remote & mobile access.
 */
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { WebSocketServer, WebSocket } = require('ws');
const {
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
} = require('./db');

// Ensure WAL checkpoints and saves when shutting down
process.on('SIGINT', () => {
  console.log('\nFermeture sécurisée du cabinet dentaire...');
  checkpointWAL();
  process.exit(0);
});

process.on('SIGTERM', () => {
  checkpointWAL();
  process.exit(0);
});

// Initialize database schema and defaults
initSchema();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let publicCloudUrl = null;

// -------------------------------------------------------------
// REAL-TIME WEBSOCKET BROADCASTING
// -------------------------------------------------------------
function broadcast(type, payload = {}) {
  const message = JSON.stringify({
    type,
    payload,
    timestamp: new Date().toISOString()
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    payload: { clientsCount: wss.clients.size, publicUrl: publicCloudUrl }
  }));

  ws.on('error', (err) => {
    console.error('WebSocket client error:', err);
  });
});

// -------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------
function getDayName(dayIndex) {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  return days[dayIndex];
}

function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

// -------------------------------------------------------------
// API: PUBLIC CLOUD URL (FOR SHARING TO MOBILES / EXTERNAL PCS)
// -------------------------------------------------------------
app.get('/api/public-url', (req, res) => {
  res.json({
    success: true,
    publicUrl: publicCloudUrl || null,
    localIps: getLocalIPAddresses(),
    port: PORT
  });
});

// -------------------------------------------------------------
// API: SETTINGS
// -------------------------------------------------------------
app.get('/api/settings', (req, res) => {
  try {
    const settings = getSettingsMap();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { settings, operator } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'Données invalides' });
    }

    db.exec('BEGIN IMMEDIATE;');
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, String(value));
    }
    logAudit(operator || 'Admin', 'UPDATE_SETTINGS', null, 'Mise à jour des paramètres du cabinet');
    db.exec('COMMIT;');

    broadcast('SETTINGS_UPDATED', { settings });
    res.json({ success: true, message: 'Paramètres enregistrés avec succès' });
  } catch (err) {
    db.exec('ROLLBACK;');
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: DENTISTS
// -------------------------------------------------------------
app.get('/api/dentists', (req, res) => {
  try {
    const dentists = db.prepare('SELECT * FROM dentists ORDER BY active DESC, name ASC').all();
    res.json({ success: true, dentists });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/dentists', (req, res) => {
  try {
    const { name, speciality, color, operator } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Le nom du praticien est requis' });
    }

    const resDb = db.prepare(`
      INSERT INTO dentists (name, speciality, color, active)
      VALUES (?, ?, ?, 1)
    `).run(name.trim(), (speciality || 'Chirurgien-dentiste').trim(), color || '#2563eb');

    logAudit(operator, 'CREATE_DENTIST', null, `Ajout du dentiste ${name}`);
    broadcast('DENTISTS_UPDATED');
    res.json({ success: true, id: resDb.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/dentists/:id', (req, res) => {
  try {
    const { name, speciality, color, active, operator } = req.body;
    const id = req.params.id;

    db.prepare(`
      UPDATE dentists
      SET name = ?, speciality = ?, color = ?, active = ?
      WHERE id = ?
    `).run(name.trim(), speciality.trim(), color, active ? 1 : 0, id);

    logAudit(operator, 'UPDATE_DENTIST', null, `Modification du dentiste ${name}`);
    broadcast('DENTISTS_UPDATED');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: MOTIFS / REASONS
// -------------------------------------------------------------
app.get('/api/reasons', (req, res) => {
  try {
    const reasons = db.prepare('SELECT * FROM reasons ORDER BY name ASC').all();
    res.json({ success: true, reasons });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reasons', (req, res) => {
  try {
    const { name, default_duration, color, operator } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Le nom du motif est requis' });
    }

    const resDb = db.prepare(`
      INSERT INTO reasons (name, default_duration, color)
      VALUES (?, ?, ?)
    `).run(name.trim(), Number(default_duration) || 30, color || '#3b82f6');

    logAudit(operator, 'CREATE_REASON', null, `Ajout du motif ${name}`);
    broadcast('REASONS_UPDATED');
    res.json({ success: true, id: resDb.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: PATIENTS (SEARCH / AUTOCOMPLETE)
// -------------------------------------------------------------
app.get('/api/patients', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      const patients = db.prepare(`
        SELECT p.*, COUNT(a.id) as total_rdv
        FROM patients p
        LEFT JOIN appointments a ON a.patient_id = p.id
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 50
      `).all();
      return res.json({ success: true, patients });
    }

    const pattern = `%${q}%`;
    const patients = db.prepare(`
      SELECT p.*, COUNT(a.id) as total_rdv
      FROM patients p
      LEFT JOIN appointments a ON a.patient_id = p.id
      WHERE p.nom LIKE ? OR p.prenom LIKE ? OR p.telephone LIKE ?
      GROUP BY p.id
      ORDER BY p.nom ASC
      LIMIT 20
    `).all(pattern, pattern, pattern);

    res.json({ success: true, patients });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: DISPONIBILITÉS (CALCULATOR ENGINE)
// -------------------------------------------------------------
app.get('/api/disponibilites', (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const dentistId = req.query.dentistId ? Number(req.query.dentistId) : null;

    const settings = getSettingsMap();
    const openingTime = settings.opening_time || '08:00';
    const closingTime = settings.closing_time || '17:00';
    const slotDuration = Number(settings.slot_duration) || 30;
    const closedDay1 = (settings.closed_day_1 || '').trim();
    const closedDay2 = (settings.closed_day_2 || '').trim();

    const dateObj = new Date(date + 'T12:00:00');
    const dayOfWeek = getDayName(dateObj.getDay());
    const isClosed = (closedDay1 && dayOfWeek.toLowerCase() === closedDay1.toLowerCase()) ||
                     (closedDay2 && dayOfWeek.toLowerCase() === closedDay2.toLowerCase());

    const startMinutes = timeToMinutes(openingTime);
    const endMinutes = timeToMinutes(closingTime);
    const totalSlots = Math.floor((endMinutes - startMinutes) / slotDuration);

    let sql = `
      SELECT a.*, d.name as dentiste_nom, d.color as dentiste_color
      FROM appointments a
      LEFT JOIN dentists d ON a.dentiste_id = d.id
      WHERE a.date = ?
        AND a.statut NOT IN ('Annulé', 'Reporté')
      ORDER BY a.heure_debut ASC
    `;
    const appointments = db.prepare(sql).all(date);

    const slots = [];
    let freeCount = 0;
    let occupiedCount = 0;
    let firstFreeSlot = null;

    for (let i = 0; i < totalSlots; i++) {
      const slotStartMin = startMinutes + i * slotDuration;
      const slotEndMin = slotStartMin + slotDuration;

      const slotStartHours = String(Math.floor(slotStartMin / 60)).padStart(2, '0');
      const slotStartMins = String(slotStartMin % 60).padStart(2, '0');
      const timeStr = `${slotStartHours}:${slotStartMins}`;

      if (isClosed) {
        slots.push({
          slotNumber: i + 1,
          time: timeStr,
          status: 'Fermé',
          appointment: null
        });
        continue;
      }

      const coveringRdv = appointments.find((rdv) => {
        const rdvStart = timeToMinutes(rdv.heure_debut);
        const rdvEnd = timeToMinutes(rdv.heure_fin);
        const overlap = slotStartMin < rdvEnd && slotEndMin > rdvStart;
        if (!overlap) return false;

        if (!dentistId) {
          return true;
        } else {
          return !rdv.dentiste_id || rdv.dentiste_id === dentistId;
        }
      });

      if (coveringRdv) {
        occupiedCount++;
        slots.push({
          slotNumber: i + 1,
          time: timeStr,
          status: 'Occupé',
          appointment: {
            id: coveringRdv.id,
            patient: `${coveringRdv.patient_nom} ${coveringRdv.patient_prenom}`,
            telephone: coveringRdv.patient_telephone,
            motif: coveringRdv.motif,
            statut: coveringRdv.statut,
            dentiste: coveringRdv.dentiste_nom || 'Non assigné',
            dentisteColor: coveringRdv.dentiste_color || '#2563eb',
            isStartingSlot: coveringRdv.heure_debut === timeStr
          }
        });
      } else {
        freeCount++;
        if (!firstFreeSlot) {
          firstFreeSlot = timeStr;
        }
        slots.push({
          slotNumber: i + 1,
          time: timeStr,
          status: 'Libre',
          appointment: null
        });
      }
    }

    res.json({
      success: true,
      date,
      dayOfWeek,
      isClosed,
      totalSlots,
      freeCount,
      occupiedCount,
      firstFreeSlot: firstFreeSlot || 'Aucun créneau libre',
      slots
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// API: APPOINTMENTS (CRUD WITH ACID CONFLICT DETECTION)
// -------------------------------------------------------------
app.get('/api/appointments', (req, res) => {
  try {
    const { date, startDate, endDate, dentistId, status, search } = req.query;
    let sql = `
      SELECT a.*, d.name as dentiste_nom, d.color as dentiste_color
      FROM appointments a
      LEFT JOIN dentists d ON a.dentiste_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      sql += ` AND a.date = ?`;
      params.push(date);
    } else if (startDate && endDate) {
      sql += ` AND a.date BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    if (dentistId) {
      sql += ` AND a.dentiste_id = ?`;
      params.push(Number(dentistId));
    }

    if (status) {
      sql += ` AND a.statut = ?`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (a.patient_nom LIKE ? OR a.patient_prenom LIKE ? OR a.patient_telephone LIKE ? OR a.motif LIKE ?)`;
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    sql += ` ORDER BY a.date ASC, a.heure_debut ASC`;
    const appointments = db.prepare(sql).all(...params);

    res.json({ success: true, appointments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Create Appointment
app.post('/api/appointments', (req, res) => {
  try {
    const {
      date,
      heure_debut,
      duree,
      patient_nom,
      patient_prenom,
      patient_telephone,
      motif,
      dentiste_id,
      statut,
      remarque,
      operator
    } = req.body;

    if (!date || !heure_debut || !patient_nom || !patient_telephone || !motif) {
      return res.status(400).json({
        success: false,
        error: 'Champs requis manquants (date, heure, nom, téléphone, motif).'
      });
    }

    const durationNum = Number(duree) || 30;
    const heure_fin = calculateEndTime(heure_debut, durationNum);
    const dentistIdNum = dentiste_id ? Number(dentiste_id) : null;
    const operatorName = operator || 'Secrétariat';

    db.exec('BEGIN IMMEDIATE;');

    try {
      const conflictResult = checkAppointmentConflict(date, heure_debut, heure_fin, dentistIdNum);
      if (conflictResult.hasConflict) {
        db.exec('ROLLBACK;');
        return res.status(409).json({
          success: false,
          error: `Conflit d'horaire détecté ! Ce créneau chevauche déjà le rendez-vous de ${conflictResult.conflictingWith.patient} (${conflictResult.conflictingWith.heure_debut} - ${conflictResult.conflictingWith.heure_fin}, ${conflictResult.conflictingWith.dentiste}).`,
          conflictingWith: conflictResult.conflictingWith
        });
      }

      const patientId = upsertPatient(patient_nom, patient_prenom, patient_telephone);

      const insertStmt = db.prepare(`
        INSERT INTO appointments (
          date, heure_debut, heure_fin, duree,
          patient_nom, patient_prenom, patient_telephone, patient_id,
          motif, dentiste_id, statut, remarque, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const resDb = insertStmt.run(
        date,
        heure_debut,
        heure_fin,
        durationNum,
        patient_nom.trim(),
        (patient_prenom || '').trim(),
        patient_telephone.trim(),
        patientId,
        motif.trim(),
        dentistIdNum,
        statut || 'À confirmer',
        (remarque || '').trim(),
        operatorName
      );

      const newId = resDb.lastInsertRowid;

      logAudit(
        operatorName,
        'CREATE_APPOINTMENT',
        newId,
        `Création RDV pour ${patient_nom} ${patient_prenom} le ${date} à ${heure_debut} (${durationNum}m)`
      );

      db.exec('COMMIT;');

      broadcast('APPOINTMENTS_UPDATED', {
        action: 'CREATE',
        date,
        appointmentId: newId,
        operator: operatorName
      });

      res.status(201).json({
        success: true,
        message: 'Rendez-vous enregistré avec succès',
        id: newId
      });
    } catch (innerErr) {
      db.exec('ROLLBACK;');
      throw innerErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT: Update Appointment
app.put('/api/appointments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      date,
      heure_debut,
      duree,
      patient_nom,
      patient_prenom,
      patient_telephone,
      motif,
      dentiste_id,
      statut,
      remarque,
      operator
    } = req.body;

    if (!date || !heure_debut || !patient_nom || !patient_telephone || !motif) {
      return res.status(400).json({ success: false, error: 'Champs requis manquants.' });
    }

    const durationNum = Number(duree) || 30;
    const heure_fin = calculateEndTime(heure_debut, durationNum);
    const dentistIdNum = dentiste_id ? Number(dentiste_id) : null;
    const operatorName = operator || 'Secrétariat';

    db.exec('BEGIN IMMEDIATE;');

    try {
      if (statut !== 'Annulé' && statut !== 'Reporté') {
        const conflictResult = checkAppointmentConflict(date, heure_debut, heure_fin, dentistIdNum, id);
        if (conflictResult.hasConflict) {
          db.exec('ROLLBACK;');
          return res.status(409).json({
            success: false,
            error: `Conflit d'horaire ! Ce créneau chevauche le rendez-vous de ${conflictResult.conflictingWith.patient} (${conflictResult.conflictingWith.heure_debut} - ${conflictResult.conflictingWith.heure_fin}).`,
            conflictingWith: conflictResult.conflictingWith
          });
        }
      }

      const patientId = upsertPatient(patient_nom, patient_prenom, patient_telephone);

      db.prepare(`
        UPDATE appointments SET
          date = ?, heure_debut = ?, heure_fin = ?, duree = ?,
          patient_nom = ?, patient_prenom = ?, patient_telephone = ?, patient_id = ?,
          motif = ?, dentiste_id = ?, statut = ?, remarque = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        date,
        heure_debut,
        heure_fin,
        durationNum,
        patient_nom.trim(),
        (patient_prenom || '').trim(),
        patient_telephone.trim(),
        patientId,
        motif.trim(),
        dentistIdNum,
        statut,
        (remarque || '').trim(),
        id
      );

      logAudit(operatorName, 'UPDATE_APPOINTMENT', id, `Modification RDV le ${date} à ${heure_debut}`);
      db.exec('COMMIT;');

      broadcast('APPOINTMENTS_UPDATED', {
        action: 'UPDATE',
        date,
        appointmentId: id,
        operator: operatorName
      });

      res.json({ success: true, message: 'Rendez-vous mis à jour' });
    } catch (innerErr) {
      db.exec('ROLLBACK;');
      throw innerErr;
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH: Status
app.patch('/api/appointments/:id/status', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { statut, operator } = req.body;
    const operatorName = operator || 'Secrétariat';

    const validStatuses = ['À confirmer', 'Confirmé', 'Venu', 'Absent', 'Annulé', 'Reporté'];
    if (!validStatuses.includes(statut)) {
      return res.status(400).json({ success: false, error: 'Statut invalide' });
    }

    const current = db.prepare('SELECT date, patient_nom FROM appointments WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Rendez-vous introuvable' });
    }

    db.prepare(`
      UPDATE appointments
      SET statut = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(statut, id);

    logAudit(operatorName, 'STATUS_CHANGE', id, `Statut passé à "${statut}" pour ${current.patient_nom}`);

    broadcast('APPOINTMENTS_UPDATED', {
      action: 'STATUS_CHANGE',
      date: current.date,
      appointmentId: id,
      newStatus: statut,
      operator: operatorName
    });

    res.json({ success: true, message: `Statut mis à jour : ${statut}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH: Reminder
app.patch('/api/appointments/:id/rappel', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rappel_effectue, operator } = req.body;
    const operatorName = operator || 'Secrétariat';

    const current = db.prepare('SELECT date, patient_nom FROM appointments WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Rendez-vous introuvable' });
    }

    const flag = rappel_effectue ? 1 : 0;
    db.prepare(`
      UPDATE appointments
      SET rappel_effectue = ?,
          rappel_date = ${flag ? 'CURRENT_TIMESTAMP' : 'NULL'},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(flag, id);

    logAudit(operatorName, 'REMINDER_TOGGLE', id, `Rappel ${flag ? 'marqué comme fait' : 'réinitialisé'} pour ${current.patient_nom}`);

    broadcast('APPOINTMENTS_UPDATED', {
      action: 'REMINDER_TOGGLE',
      date: current.date,
      appointmentId: id,
      rappel_effectue: flag,
      operator: operatorName
    });

    res.json({ success: true, rappel_effectue: flag });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE: Appointment
app.delete('/api/appointments/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const operatorName = req.query.operator || 'Secrétariat';

    const current = db.prepare('SELECT date, patient_nom, heure_debut FROM appointments WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Rendez-vous introuvable' });
    }

    db.prepare('DELETE FROM appointments WHERE id = ?').run(id);

    logAudit(operatorName, 'DELETE_APPOINTMENT', id, `Suppression définitive du RDV de ${current.patient_nom} (${current.date} à ${current.heure_debut})`);

    broadcast('APPOINTMENTS_UPDATED', {
      action: 'DELETE',
      date: current.date,
      appointmentId: id,
      operator: operatorName
    });

    res.json({ success: true, message: 'Rendez-vous supprimé' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: RAPPELS
app.get('/api/rappels', (req, res) => {
  try {
    const settings = getSettingsMap();
    const daysAhead = Number(settings.reminder_days_ahead) || 1;

    let targetDate = req.query.targetDate;
    if (!targetDate) {
      const d = new Date();
      d.setDate(d.getDate() + daysAhead);
      targetDate = d.toISOString().split('T')[0];
    }

    const rows = db.prepare(`
      SELECT a.*, d.name as dentiste_nom
      FROM appointments a
      LEFT JOIN dentists d ON a.dentiste_id = d.id
      WHERE a.date = ?
        AND a.statut NOT IN ('Annulé', 'Reporté')
      ORDER BY a.heure_debut ASC
    `).all(targetDate);

    const clinicName = settings.cabinet_name || 'Cabinet Dentaire';
    const enriched = rows.map((r) => {
      let cleanPhone = (r.patient_telephone || '').replace(/[^0-9+]/g, '');
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '213' + cleanPhone.substring(1);
      }

      const dentistText = r.dentiste_nom ? ` avec le ${r.dentiste_nom}` : '';
      const message = `Bonjour ${r.patient_prenom ? r.patient_prenom + ' ' : ''}${r.patient_nom},\n\nLe ${clinicName} vous rappelle votre rendez-vous prévu le ${r.date} à ${r.heure_debut}${dentistText} (Motif : ${r.motif}).\n\nMerci de nous confirmer votre présence ou de nous prévenir au plus vite en cas d'empêchement.\nCordialement.`;

      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

      return {
        ...r,
        cleanPhone,
        whatsappUrl
      };
    });

    res.json({
      success: true,
      targetDate,
      daysAhead,
      count: enriched.length,
      patients: enriched
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: STATS
app.get('/api/stats/monthly', (req, res) => {
  try {
    const yearMonth = req.query.month || new Date().toISOString().substring(0, 7);
    const pattern = `${yearMonth}-%`;

    const totalPrevus = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut NOT IN ('Annulé', 'Reporté')
    `).get(pattern).c;

    const venus = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'Venu'
    `).get(pattern).c;

    const absents = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'Absent'
    `).get(pattern).c;

    const annules = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'Annulé'
    `).get(pattern).c;

    const reportes = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'Reporté'
    `).get(pattern).c;

    const aConfirmer = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'À confirmer'
    `).get(pattern).c;

    const confirms = db.prepare(`
      SELECT COUNT(*) as c FROM appointments 
      WHERE date LIKE ? AND statut = 'Confirmé'
    `).get(pattern).c;

    const denominateur = venus + absents;
    const tauxAbsence = denominateur > 0 ? ((absents / denominateur) * 100).toFixed(1) : '0.0';

    const daysCounts = db.prepare(`
      SELECT date, COUNT(*) as count
      FROM appointments
      WHERE date LIKE ? AND statut NOT IN ('Annulé', 'Reporté')
      GROUP BY date
    `).all(pattern);

    const countsMap = {};
    for (const d of daysCounts) {
      countsMap[d.date] = d.count;
    }

    res.json({
      success: true,
      month: yearMonth,
      stats: {
        totalPrevus,
        venus,
        absents,
        annules,
        reportes,
        aConfirmer,
        confirms,
        tauxAbsence: `${tauxAbsence}%`
      },
      countsMap
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: CONTROLE
app.get('/api/controles', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const missingPhones = db.prepare(`
      SELECT id, date, heure_debut, patient_nom, patient_prenom, motif
      FROM appointments
      WHERE (patient_telephone IS NULL OR TRIM(patient_telephone) = '')
        AND statut NOT IN ('Annulé', 'Reporté')
      ORDER BY date DESC
      LIMIT 20
    `).all();

    const overdueStatus = db.prepare(`
      SELECT id, date, heure_debut, patient_nom, patient_prenom, patient_telephone, statut, motif
      FROM appointments
      WHERE date < ?
        AND statut IN ('À confirmer', 'Confirmé')
      ORDER BY date DESC
      LIMIT 30
    `).all(today);

    const allActive = db.prepare(`
      SELECT a.*, d.name as dentiste_nom
      FROM appointments a
      LEFT JOIN dentists d ON a.dentiste_id = d.id
      WHERE a.statut NOT IN ('Annulé', 'Reporté')
        AND a.date >= ?
      ORDER BY a.date ASC, a.heure_debut ASC
    `).all(today);

    const detectedConflicts = [];
    for (let i = 0; i < allActive.length; i++) {
      for (let j = i + 1; j < allActive.length; j++) {
        const a1 = allActive[i];
        const a2 = allActive[j];
        if (a1.date !== a2.date) break;

        const s1 = timeToMinutes(a1.heure_debut);
        const e1 = timeToMinutes(a1.heure_fin);
        const s2 = timeToMinutes(a2.heure_debut);
        const e2 = timeToMinutes(a2.heure_fin);

        if (s1 < e2 && e1 > s2) {
          const dentistConflict = !a1.dentiste_id || !a2.dentiste_id || a1.dentiste_id === a2.dentiste_id;
          if (dentistConflict) {
            detectedConflicts.push({ a1, a2 });
          }
        }
      }
    }

    res.json({
      success: true,
      summary: {
        missingPhonesCount: missingPhones.length,
        overdueStatusCount: overdueStatus.length,
        detectedConflictsCount: detectedConflicts.length,
        totalAlerts: missingPhones.length + overdueStatus.length + detectedConflicts.length
      },
      missingPhones,
      overdueStatus,
      detectedConflicts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: AUDIT LOGS
app.get('/api/audit-logs', (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: BACKUP & CSV EXPORT
app.get('/api/backup/download', (req, res) => {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const filename = `backup-cabinet-${new Date().toISOString().split('T')[0]}.db`;
    res.download(DB_PATH, filename);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/export/csv', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        a.id, a.date, a.heure_debut, a.heure_fin, a.duree,
        a.patient_nom, a.patient_prenom, a.patient_telephone,
        a.motif, COALESCE(d.name, 'Tous') as dentiste,
        a.statut, CASE WHEN a.rappel_effectue = 1 THEN 'Oui' ELSE 'Non' END as rappele,
        a.remarque, a.created_by, a.created_at
      FROM appointments a
      LEFT JOIN dentists d ON a.dentiste_id = d.id
      ORDER BY a.date DESC, a.heure_debut ASC
    `).all();

    let csv = 'ID;Date;Debut;Fin;Duree(min);Nom;Prenom;Telephone;Motif;Dentiste;Statut;Rappele;Remarque;Cree_Par;Cree_Le\n';
    for (const r of rows) {
      csv += [
        r.id,
        r.date,
        r.heure_debut,
        r.heure_fin,
        r.duree,
        `"${(r.patient_nom || '').replace(/"/g, '""')}"`,
        `"${(r.patient_prenom || '').replace(/"/g, '""')}"`,
        `"${(r.patient_telephone || '').replace(/"/g, '""')}"`,
        `"${(r.motif || '').replace(/"/g, '""')}"`,
        `"${(r.dentiste || '').replace(/"/g, '""')}"`,
        r.statut,
        r.rappele,
        `"${(r.remarque || '').replace(/"/g, '""')}"`,
        `"${(r.created_by || '').replace(/"/g, '""')}"`,
        r.created_at
      ].join(';') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rendez-vous-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// -------------------------------------------------------------
// AUTOMATIC CLOUDFLARE PUBLIC TUNNEL (FREE 24/7 ONLINE ACCESS)
// -------------------------------------------------------------
let cfProcess = null;

function startCloudTunnel(port) {
  try {
    cfProcess = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`]);

    cfProcess.stderr.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !publicCloudUrl) {
        publicCloudUrl = match[0];
        console.log(`\n=======================================================`);
        console.log(` 🌐 LIEN PUBLIC CLOUD GRATUIT (ACCÈS TOUT APPAREIL / 4G) :`);
        console.log(` 👉 ${publicCloudUrl}`);
        console.log(` (Partagez ce lien avec le dentiste et les assistantes)`);
        console.log(`=======================================================\n`);
        broadcast('PUBLIC_URL_READY', { url: publicCloudUrl });
      }
    });

    cfProcess.on('error', () => {
      // If cloudflared binary not found or blocked, silent fallback
    });

    process.on('exit', () => {
      if (cfProcess) cfProcess.kill();
    });
  } catch (err) {
    // Ignore error
  }
}

// -------------------------------------------------------------
// START HTTP & WEBSOCKET SERVER
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`  LOGICIEL DE GESTION DE RENDEZ-VOUS DU CABINET DENTAIRE `);
  console.log(`=======================================================`);
  console.log(` Serveur démarré avec succès.`);
  console.log(` Accès local sur ce PC : http://localhost:${PORT}`);
  const ips = getLocalIPAddresses();
  if (ips.length > 0) {
    console.log(` Accès réseau Wi-Fi local :`);
    ips.forEach((ip) => {
      console.log(`    👉 http://${ip}:${PORT}`);
    });
  }
  console.log(` Mode Base de Données : SQLite WAL (Transactions ACID activées)`);
  console.log(` Synchronisation temps réel : WebSocket activé`);
  console.log(` Initialisation du lien Cloudflare sécurisé en cours...`);
  console.log(`=======================================================`);

  // Start cloud tunnel automatically
  startCloudTunnel(PORT);
});
