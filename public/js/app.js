/**
 * Application Controller for Dental Practice Software (Cabinet Dentaire)
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker for PWA (Install as native app)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Initialize WebSocket and Load Metadata
  API.initWebSocket();
  await API.loadMetadata();

  // DOM Elements
  const currentDateInput = document.getElementById('current-date');
  const operatorSelect = document.getElementById('operator-select');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const btnNewRdv = document.getElementById('btn-new-rdv');
  const modalRdv = document.getElementById('modal-rdv');
  const formRdv = document.getElementById('form-rdv');
  const alertsBadge = document.getElementById('alerts-count-badge');
  const printHeader = document.getElementById('print-header');

  let activeTab = 'disponibilites';

  // Format Helper: French Date string
  function formatFrenchDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  // -------------------------------------------------------------
  // OPERATOR & HEADER INITIALIZATION
  // -------------------------------------------------------------
  if (operatorSelect) {
    operatorSelect.value = API.state.currentOperator;
    operatorSelect.addEventListener('change', (e) => {
      API.state.currentOperator = e.target.value;
      localStorage.setItem('cabinet_operator', e.target.value);
      API.showToast(`Connecté en tant que : ${e.target.value}`, 'info');
    });
  }

  // Set today's date in header picker
  const todayStr = new Date().toISOString().split('T')[0];
  API.state.currentDate = todayStr;
  currentDateInput.value = todayStr;

  currentDateInput.addEventListener('change', (e) => {
    API.state.currentDate = e.target.value;
    refreshActiveView();
  });

  document.getElementById('btn-prev-day')?.addEventListener('click', () => {
    const d = new Date(API.state.currentDate);
    d.setDate(d.getDate() - 1);
    API.state.currentDate = d.toISOString().split('T')[0];
    currentDateInput.value = API.state.currentDate;
    refreshActiveView();
  });

  document.getElementById('btn-next-day')?.addEventListener('click', () => {
    const d = new Date(API.state.currentDate);
    d.setDate(d.getDate() + 1);
    API.state.currentDate = d.toISOString().split('T')[0];
    currentDateInput.value = API.state.currentDate;
    refreshActiveView();
  });

  document.getElementById('btn-today')?.addEventListener('click', () => {
    API.state.currentDate = new Date().toISOString().split('T')[0];
    currentDateInput.value = API.state.currentDate;
    refreshActiveView();
  });

  // -------------------------------------------------------------
  // TAB NAVIGATION
  // -------------------------------------------------------------
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      switchTab(tabName);
    });
  });

  function switchTab(tabName) {
    activeTab = tabName;
    tabButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
    tabPanels.forEach((p) => p.classList.toggle('active', p.id === `panel-${tabName}`));
    refreshActiveView();
  }

  function refreshActiveView() {
    updateAlertsCount();
    if (activeTab === 'disponibilites') renderDisponibilites();
    else if (activeTab === 'jour') renderDayAgenda();
    else if (activeTab === 'semaine') renderWeekAgenda();
    else if (activeTab === 'mois') renderMonthCalendar();
    else if (activeTab === 'rappels') renderRappels();
    else if (activeTab === 'registre') renderAppointmentsTable();
    else if (activeTab === 'controles') renderControles();
    else if (activeTab === 'parametres') loadSettingsTab();
  }

  // Real-time listener: When server pushes updates, refresh current view
  API.on('APPOINTMENTS_UPDATED', () => {
    refreshActiveView();
  });
  API.on('SETTINGS_UPDATED', async () => {
    await API.loadMetadata();
    refreshActiveView();
  });

  // -------------------------------------------------------------
  // ALERT BADGE UPDATE
  // -------------------------------------------------------------
  async function updateAlertsCount() {
    try {
      const res = await API.get('/controles');
      if (res && res.success && alertsBadge) {
        const count = res.summary.totalAlerts;
        alertsBadge.textContent = count;
        alertsBadge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    } catch (e) {
      // ignore
    }
  }

  // -------------------------------------------------------------
  // VUE 1: DISPONIBILITÉS (SLOT MATRIX)
  // -------------------------------------------------------------
  const dispDentistFilter = document.getElementById('disp-dentist-filter');
  dispDentistFilter?.addEventListener('change', () => renderDisponibilites());

  async function renderDisponibilites() {
    const container = document.getElementById('slots-grid');
    if (!container) return;

    // Populate dentist filter dropdown if empty
    populateDentistSelect(dispDentistFilter, true);

    const date = API.state.currentDate;
    const dentistId = dispDentistFilter?.value || '';

    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:2rem;">Chargement des disponibilités...</div>';

    try {
      const res = await API.get('/disponibilites', { date, dentistId });
      if (!res.success) throw new Error(res.error);

      // Update KPI
      document.getElementById('disp-date-display').textContent = formatFrenchDate(date);
      document.getElementById('kpi-free-slots').textContent = res.isClosed ? 'Fermé' : res.freeCount;
      document.getElementById('kpi-occupied-slots').textContent = res.isClosed ? '0' : res.occupiedCount;
      document.getElementById('kpi-first-free').textContent = res.isClosed ? 'Cabinet fermé' : res.firstFreeSlot;

      if (res.isClosed) {
        container.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔒</div>
            <h3 style="font-size: 1.25rem; font-weight: 700; color: #475569;">Cabinet fermé le ${res.dayOfWeek}</h3>
            <p style="color: #64748b; font-size: 0.9rem; margin-top: 0.25rem;">Consultez les paramètres pour ajuster les jours de fermeture.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      res.slots.forEach((slot) => {
        const tile = document.createElement('div');
        const isFree = slot.status === 'Libre';
        tile.className = `slot-tile ${isFree ? 'slot-free' : 'slot-occupied'}`;

        let detailsHtml = '';
        if (isFree) {
          detailsHtml = `<div class="slot-status-label">Libre</div><div style="font-size:0.7rem; color:#15803d;">+ Cliquer pour réserver</div>`;
        } else {
          detailsHtml = `
            <div class="slot-patient-info" title="${slot.appointment.patient} (${slot.appointment.motif})">
              ${slot.appointment.patient}
            </div>
            <div style="font-size: 0.7rem; color: #991b1b;">
              ${slot.appointment.motif}
            </div>
          `;
        }

        tile.innerHTML = `
          <div class="slot-time">${slot.time}</div>
          ${detailsHtml}
        `;

        tile.addEventListener('click', () => {
          if (isFree) {
            openNewRdvModal({
              date: API.state.currentDate,
              heure: slot.time,
              dentiste_id: dentistId
            });
          } else if (slot.appointment) {
            openEditRdvModal(slot.appointment.id);
          }
        });

        container.appendChild(tile);
      });
    } catch (err) {
      container.innerHTML = `<div style="grid-column:1/-1; color:var(--danger); padding:1rem;">Erreur : ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 2: JOUR (AGENDA DU JOUR - TIMELINE)
  // -------------------------------------------------------------
  const dayDentistFilter = document.getElementById('day-dentist-filter');
  dayDentistFilter?.addEventListener('change', () => renderDayAgenda());

  document.getElementById('btn-print-day')?.addEventListener('click', () => {
    const dateFormatted = formatFrenchDate(API.state.currentDate);
    if (printHeader) {
      printHeader.innerHTML = `
        <h2>${API.state.settings.cabinet_name || 'Cabinet Dentaire'} - Agenda du ${dateFormatted}</h2>
        <p>Généré le ${new Date().toLocaleString('fr-FR')}</p>
      `;
    }
    window.print();
  });

  async function renderDayAgenda() {
    const tableBody = document.getElementById('day-agenda-body');
    if (!tableBody) return;

    populateDentistSelect(dayDentistFilter, true);

    const date = API.state.currentDate;
    const dentistId = dayDentistFilter?.value || '';

    document.getElementById('day-date-display').textContent = formatFrenchDate(date);
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem;">Chargement du planning...</td></tr>';

    try {
      // Fetch availability for slots, and appointments
      const [resDisp, resAppointments] = await Promise.all([
        API.get('/disponibilites', { date, dentistId }),
        API.get('/appointments', { date, dentistId })
      ]);

      const appointments = resAppointments.appointments || [];

      // Update counters
      const activeRdvs = appointments.filter((a) => a.statut !== 'Annulé' && a.statut !== 'Reporté');
      document.getElementById('day-rdv-count').textContent = activeRdvs.length;
      document.getElementById('day-free-count').textContent = resDisp.freeCount;

      if (resDisp.isClosed) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:3rem; color:#64748b;">Cabinet fermé le ${resDisp.dayOfWeek}</td></tr>`;
        return;
      }

      tableBody.innerHTML = '';

      resDisp.slots.forEach((slot) => {
        const row = document.createElement('tr');

        // Check if an appointment starts at this time
        const startingRdv = appointments.find((a) => a.heure_debut === slot.time && a.statut !== 'Annulé');
        // Check if an appointment covers this time but started earlier (continuation / suite)
        const coveringRdv = appointments.find((a) => {
          if (a.statut === 'Annulé') return false;
          const s = a.heure_debut;
          const e = a.heure_fin;
          return slot.time > s && slot.time < e;
        });

        let patientHtml = '<span style="color:#94a3b8;">Créneau libre</span>';
        let phoneHtml = '-';
        let motifHtml = '-';
        let dentistHtml = '-';
        let statusHtml = '<span class="status-pill status-venu" style="background:#f0fdf4; color:#166534; border:1px solid #bbf7d0;">Libre</span>';
        let actionsHtml = `<button class="action-btn-mini btn-book-slot" data-time="${slot.time}">+ Réserver</button>`;

        if (startingRdv) {
          const cleanPhone = (startingRdv.patient_telephone || '').replace(/[^0-9]/g, '');
          patientHtml = `
            <div class="patient-identity">
              <span class="name">${startingRdv.patient_nom} ${startingRdv.patient_prenom}</span>
              ${startingRdv.remarque ? `<span style="font-size:0.75rem; color:#d97706;">📝 ${startingRdv.remarque}</span>` : ''}
            </div>
          `;
          phoneHtml = `
            <div class="patient-identity">
              <span class="phone"><a href="tel:${startingRdv.patient_telephone}" style="color:inherit; text-decoration:none;">📞 ${startingRdv.patient_telephone}</a></span>
            </div>
          `;
          motifHtml = `<span class="badge-motif">${startingRdv.motif} (${startingRdv.duree} min)</span>`;
          dentistHtml = `
            <span class="badge-dentiste">
              <span class="dentiste-dot" style="background:${startingRdv.dentiste_color || '#2563eb'}"></span>
              ${startingRdv.dentiste_nom || 'Tous'}
            </span>
          `;

          const statusClass = getStatusClass(startingRdv.statut);
          statusHtml = `<span class="status-pill ${statusClass}">${startingRdv.statut}</span>`;

          // Quick status dropdown + WhatsApp + Call + Edit
          const clinicName = API.state.settings.cabinet_name || 'Cabinet Dentaire';
          const msg = encodeURIComponent(`Bonjour ${startingRdv.patient_prenom ? startingRdv.patient_prenom + ' ' : ''}${startingRdv.patient_nom},\n\nLe ${clinicName} vous confirme votre rendez-vous le ${startingRdv.date} à ${startingRdv.heure_debut}.\nCordialement.`);
          const waPhone = cleanPhone.startsWith('0') ? '213' + cleanPhone.substring(1) : cleanPhone;

          actionsHtml = `
            <div class="actions-group">
              <select class="form-select status-quick-changer action-btn-mini" data-id="${startingRdv.id}">
                <option value="À confirmer" ${startingRdv.statut === 'À confirmer' ? 'selected' : ''}>À confirmer</option>
                <option value="Confirmé" ${startingRdv.statut === 'Confirmé' ? 'selected' : ''}>Confirmé</option>
                <option value="Venu" ${startingRdv.statut === 'Venu' ? 'selected' : ''}>Venu</option>
                <option value="Absent" ${startingRdv.statut === 'Absent' ? 'selected' : ''}>Absent</option>
                <option value="Annulé" ${startingRdv.statut === 'Annulé' ? 'selected' : ''}>Annulé</option>
                <option value="Reporté" ${startingRdv.statut === 'Reporté' ? 'selected' : ''}>Reporté</option>
              </select>
              <a href="https://wa.me/${waPhone}?text=${msg}" target="_blank" class="action-btn-mini btn-whatsapp" title="Envoyer rappel WhatsApp">📱</a>
              <button class="action-btn-mini btn-edit-rdv" data-id="${startingRdv.id}" title="Modifier">✏️</button>
            </div>
          `;
        } else if (coveringRdv) {
          // Multi-slot appointment continuation
          patientHtml = `<div class="rdv-card-inline continuation">↳ (suite) ${coveringRdv.patient_nom} ${coveringRdv.patient_prenom}</div>`;
          phoneHtml = `<span style="color:#94a3b8;">${coveringRdv.patient_telephone}</span>`;
          motifHtml = `<span style="color:#94a3b8; font-size:0.8rem;">${coveringRdv.motif}</span>`;
          dentistHtml = `<span style="color:#94a3b8; font-size:0.8rem;">${coveringRdv.dentiste_nom || ''}</span>`;
          statusHtml = `<span style="color:#94a3b8; font-size:0.8rem;">En cours</span>`;
          actionsHtml = `<span style="color:#94a3b8; font-size:0.75rem;">Jusqu'à ${coveringRdv.heure_fin}</span>`;
        }

        row.innerHTML = `
          <td><span class="slot-hour-badge">${slot.time}</span></td>
          <td>${patientHtml}</td>
          <td>${phoneHtml}</td>
          <td>${motifHtml}</td>
          <td>${dentistHtml}</td>
          <td>${statusHtml}</td>
          <td>${actionsHtml}</td>
        `;

        tableBody.appendChild(row);
      });

      // Bind dynamic actions
      tableBody.querySelectorAll('.btn-book-slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          openNewRdvModal({
            date: API.state.currentDate,
            heure: btn.getAttribute('data-time'),
            dentiste_id: dentistId
          });
        });
      });

      tableBody.querySelectorAll('.btn-edit-rdv').forEach((btn) => {
        btn.addEventListener('click', () => {
          openEditRdvModal(btn.getAttribute('data-id'));
        });
      });

      tableBody.querySelectorAll('.status-quick-changer').forEach((select) => {
        select.addEventListener('change', async (e) => {
          const id = select.getAttribute('data-id');
          const newStatus = e.target.value;
          try {
            await API.patch(`/appointments/${id}/status`, { statut: newStatus });
            API.showToast(`Statut mis à jour : ${newStatus}`, 'success');
          } catch (err) {
            API.showToast(err.message, 'danger');
            renderDayAgenda();
          }
        });
      });
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger); padding:1.5rem;">Erreur : ${err.message}</td></tr>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 3: SEMAINE (7 JOURS CÔTE À CÔTE)
  // -------------------------------------------------------------
  async function renderWeekAgenda() {
    const tableHeader = document.getElementById('week-header-row');
    const tableBody = document.getElementById('week-body-rows');
    if (!tableHeader || !tableBody) return;

    // Determine week start date based on configured first_day_of_week
    const curr = new Date(API.state.currentDate);
    const firstDaySetting = API.state.settings.first_day_of_week || 'Dimanche';
    const targetFirstDayIndex = firstDaySetting.toLowerCase().startsWith('dim') ? 0 : 1; // 0 for Sunday, 1 for Monday

    const dayDiff = curr.getDay() - targetFirstDayIndex;
    const weekStart = new Date(curr);
    weekStart.setDate(curr.getDate() - (dayDiff < 0 ? dayDiff + 7 : dayDiff));

    // Generate 7 days
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      weekDates.push(d.toISOString().split('T')[0]);
    }

    const startDate = weekDates[0];
    const endDate = weekDates[6];

    document.getElementById('week-range-display').textContent = `Semaine du ${formatFrenchDate(startDate)} au ${formatFrenchDate(endDate)}`;

    try {
      const res = await API.get('/appointments', { startDate, endDate });
      const appointments = res.appointments || [];

      // Build Headers
      tableHeader.innerHTML = '<th class="week-time-col">Heure</th>';
      weekDates.forEach((wDate) => {
        const dObj = new Date(wDate + 'T12:00:00');
        const dayName = dObj.toLocaleDateString('fr-FR', { weekday: 'short' });
        const dayNum = dObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const isToday = wDate === todayStr;

        const countForDay = appointments.filter((a) => a.date === wDate && a.statut !== 'Annulé').length;

        const th = document.createElement('th');
        if (isToday) th.className = 'is-today';
        th.innerHTML = `
          <div>${dayName.toUpperCase()} ${dayNum}</div>
          <div style="font-size:0.75rem; font-weight:normal; margin-top:2px;">
            <span class="tab-badge">${countForDay} RDV</span>
          </div>
        `;
        tableHeader.appendChild(th);
      });

      // Build Time Rows
      const opening = API.state.settings.opening_time || '08:00';
      const closing = API.state.settings.closing_time || '17:00';
      const slotDuration = Number(API.state.settings.slot_duration) || 30;

      const startMin = API.timeToMinutes(opening);
      const endMin = API.timeToMinutes(closing);

      tableBody.innerHTML = '';

      for (let m = startMin; m < endMin; m += slotDuration) {
        const timeStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const row = document.createElement('tr');

        let rowHtml = `<td class="week-time-col">${timeStr}</td>`;

        weekDates.forEach((wDate) => {
          // Find appointments on this date and time
          const cellRdvs = appointments.filter((a) => a.date === wDate && a.heure_debut === timeStr && a.statut !== 'Annulé');

          let cellContent = '';
          cellRdvs.forEach((rdv) => {
            const dentistColor = rdv.dentiste_color || '#2563eb';
            cellContent += `
              <div class="week-rdv-chip" data-id="${rdv.id}" style="border-left-color:${dentistColor};" title="${rdv.patient_nom} - ${rdv.motif} (${rdv.statut})">
                <strong>${rdv.patient_nom}</strong>
                <div style="font-size:0.68rem; color:#475569;">${rdv.motif}</div>
              </div>
            `;
          });

          rowHtml += `<td data-date="${wDate}" data-time="${timeStr}">${cellContent}</td>`;
        });

        row.innerHTML = rowHtml;
        tableBody.appendChild(row);
      }

      // Quick add / edit on click in week table
      tableBody.querySelectorAll('td[data-date]').forEach((td) => {
        td.addEventListener('click', (e) => {
          const chip = e.target.closest('.week-rdv-chip');
          if (chip) {
            openEditRdvModal(chip.getAttribute('data-id'));
          } else {
            openNewRdvModal({
              date: td.getAttribute('data-date'),
              heure: td.getAttribute('data-time')
            });
          }
        });
      });
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger); padding:1rem;">Erreur : ${err.message}</td></tr>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 4: MOIS & STATISTIQUES (CALENDRIER MENSUEL)
  // -------------------------------------------------------------
  let currentMonthView = todayStr.substring(0, 7); // YYYY-MM

  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    const [y, m] = currentMonthView.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    currentMonthView = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    renderMonthCalendar();
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    const [y, m] = currentMonthView.split('-').map(Number);
    const next = new Date(y, m, 1);
    currentMonthView = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    renderMonthCalendar();
  });

  async function renderMonthCalendar() {
    const grid = document.getElementById('month-grid');
    if (!grid) return;

    const [year, month] = currentMonthView.split('-').map(Number);
    const monthDateObj = new Date(year, month - 1, 1);
    const monthTitle = monthDateObj.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('month-display-title').textContent = monthTitle.toUpperCase();

    try {
      const res = await API.get('/stats/monthly', { month: currentMonthView });
      const stats = res.stats || {};
      const countsMap = res.countsMap || {};

      // Fill KPI stats
      document.getElementById('stat-total-prevus').textContent = stats.totalPrevus;
      document.getElementById('stat-venus').textContent = stats.venus;
      document.getElementById('stat-absents').textContent = stats.absents;
      document.getElementById('stat-annules').textContent = stats.annules;
      document.getElementById('stat-reportes').textContent = stats.reportes;
      document.getElementById('stat-taux-absence').textContent = stats.tauxAbsence;

      grid.innerHTML = '';

      // Day of week headers
      const dayHeaders = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
      dayHeaders.forEach((dh) => {
        const div = document.createElement('div');
        div.className = 'month-day-header';
        div.textContent = dh;
        grid.appendChild(div);
      });

      // Days of the month
      const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
      const daysInMonth = new Date(year, month, 0).getDate();

      // Pad previous month days
      for (let i = 0; i < firstDayOfMonth; i++) {
        const blank = document.createElement('div');
        blank.className = 'month-cell is-other-month';
        grid.appendChild(blank);
      }

      const closed1 = (API.state.settings.closed_day_1 || '').toLowerCase();
      const closed2 = (API.state.settings.closed_day_2 || '').toLowerCase();

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayDate = new Date(year, month - 1, day);
        const dayOfWeekName = dayDate.toLocaleDateString('fr-FR', { weekday: 'long' }).toLowerCase();

        const isClosed = (closed1 && dayOfWeekName === closed1) || (closed2 && dayOfWeekName === closed2);
        const isToday = dateStr === todayStr;
        const count = countsMap[dateStr] || 0;

        const cell = document.createElement('div');
        cell.className = `month-cell ${isToday ? 'is-today' : ''} ${isClosed ? 'is-closed' : ''}`;

        let badgeHtml = '';
        if (count > 0) {
          // Rule from sheet: blue = normal (<8), orange = 8 or more
          const badgeClass = count >= 8 ? 'badge-heavy' : 'badge-normal';
          badgeHtml = `<div class="month-rdv-badge ${badgeClass}">${count} RDV</div>`;
        }

        cell.innerHTML = `
          <div class="month-cell-daynum">${day}</div>
          ${badgeHtml}
          <div style="font-size:0.65rem; color:#94a3b8; text-align:right;">${isClosed ? 'Fermé' : ''}</div>
        `;

        cell.addEventListener('click', () => {
          API.state.currentDate = dateStr;
          currentDateInput.value = dateStr;
          switchTab('jour');
        });

        grid.appendChild(cell);
      }
    } catch (err) {
      grid.innerHTML = `<div style="grid-column:1/-1; color:var(--danger); padding:1rem;">Erreur : ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 5: RAPPELS DE VEILLE (PATIENTS À APPELER)
  // -------------------------------------------------------------
  const rappelTargetDateInput = document.getElementById('rappel-target-date');
  rappelTargetDateInput?.addEventListener('change', () => renderRappels());

  async function renderRappels() {
    const listContainer = document.getElementById('rappels-list');
    if (!listContainer) return;

    let targetDate = rappelTargetDateInput?.value;
    if (!targetDate) {
      // Default: tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetDate = tomorrow.toISOString().split('T')[0];
      if (rappelTargetDateInput) rappelTargetDateInput.value = targetDate;
    }

    listContainer.innerHTML = '<div style="padding:2rem; text-align:center;">Recherche des patients à rappeler...</div>';

    try {
      const res = await API.get('/rappels', { targetDate });
      const patients = res.patients || [];

      document.getElementById('rappel-count-badge').textContent = `${patients.length} patient(s)`;
      document.getElementById('rappel-target-label').textContent = formatFrenchDate(targetDate);

      if (patients.length === 0) {
        listContainer.innerHTML = `
          <div style="text-align: center; padding: 3rem; color: #64748b;">
            <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🎉</div>
            <h3>Aucun rendez-vous à rappeler pour cette date</h3>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = '';
      patients.forEach((p) => {
        const item = document.createElement('div');
        const isDone = p.rappel_effectue === 1;
        item.className = `rappel-item-row ${isDone ? 'is-done' : ''}`;

        item.innerHTML = `
          <div style="display:flex; align-items:center; gap:1.25rem;">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;" title="Cocher quand l'appel est fait">
              <input type="checkbox" class="toggle-rappel-cb" data-id="${p.id}" ${isDone ? 'checked' : ''} style="width:20px; height:20px;">
              <span style="font-weight:700; font-size:0.85rem; color:${isDone ? '#166534' : '#64748b'};">${isDone ? 'Rappelé' : 'À appeler'}</span>
            </label>
            <div>
              <div style="font-size:1.05rem; font-weight:700; color:var(--text-main);">
                ${p.patient_nom} ${p.patient_prenom}
                <span class="slot-hour-badge" style="margin-left:0.5rem;">${p.heure_debut}</span>
              </div>
              <div style="font-size:0.85rem; color:var(--text-muted); display:flex; align-items:center; gap:0.75rem; margin-top:2px;">
                <span>📞 ${p.patient_telephone}</span>
                <span>• Motif : <strong>${p.motif}</strong></span>
                <span>• Praticien : ${p.dentiste_nom || 'Tous'}</span>
              </div>
            </div>
          </div>
          <div class="actions-group">
            <a href="tel:${p.patient_telephone}" class="action-btn-mini" title="Appeler directement">📞 Appeler</a>
            <a href="${p.whatsappUrl}" target="_blank" class="action-btn-mini btn-whatsapp" title="Envoyer rappel WhatsApp en 1 clic">📱 WhatsApp</a>
          </div>
        `;

        item.querySelector('.toggle-rappel-cb').addEventListener('change', async (e) => {
          const checked = e.target.checked;
          try {
            await API.patch(`/appointments/${p.id}/rappel`, { rappel_effectue: checked });
            API.showToast(checked ? 'Patient marqué comme rappelé' : 'Statut rappel réinitialisé', 'success');
            renderRappels();
          } catch (err) {
            API.showToast(err.message, 'danger');
          }
        });

        listContainer.appendChild(item);
      });
    } catch (err) {
      listContainer.innerHTML = `<div style="color:var(--danger); padding:1rem;">Erreur : ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 6: REGISTRE DES RENDEZ-VOUS & RECHERCHE
  // -------------------------------------------------------------
  const searchInput = document.getElementById('search-appointments');
  const searchStatusFilter = document.getElementById('search-status-filter');
  const searchDentistFilter = document.getElementById('search-dentist-filter');
  const btnExportCsv = document.getElementById('btn-export-csv');

  searchInput?.addEventListener('input', debounce(() => renderAppointmentsTable(), 300));
  searchStatusFilter?.addEventListener('change', () => renderAppointmentsTable());
  searchDentistFilter?.addEventListener('change', () => renderAppointmentsTable());

  btnExportCsv?.addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  async function renderAppointmentsTable() {
    const tableBody = document.getElementById('registre-table-body');
    if (!tableBody) return;

    populateDentistSelect(searchDentistFilter, true);

    const search = searchInput?.value || '';
    const status = searchStatusFilter?.value || '';
    const dentistId = searchDentistFilter?.value || '';

    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem;">Recherche...</td></tr>';

    try {
      const res = await API.get('/appointments', { search, status, dentistId });
      const appointments = res.appointments || [];

      document.getElementById('registre-count-display').textContent = `${appointments.length} rendez-vous`;

      if (appointments.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#64748b;">Aucun rendez-vous trouvé</td></tr>';
        return;
      }

      tableBody.innerHTML = '';
      appointments.forEach((rdv) => {
        const row = document.createElement('tr');
        const statusClass = getStatusClass(rdv.statut);

        row.innerHTML = `
          <td><strong>${rdv.date}</strong></td>
          <td><span class="slot-hour-badge">${rdv.heure_debut} - ${rdv.heure_fin}</span></td>
          <td><strong>${rdv.patient_nom} ${rdv.patient_prenom}</strong></td>
          <td><a href="tel:${rdv.patient_telephone}" style="color:inherit; text-decoration:none;">${rdv.patient_telephone}</a></td>
          <td><span class="badge-motif">${rdv.motif}</span></td>
          <td>${rdv.dentiste_nom || 'Cabinet'}</td>
          <td><span class="status-pill ${statusClass}">${rdv.statut}</span></td>
          <td>
            <div class="actions-group">
              <button class="action-btn-mini btn-edit-rdv" data-id="${rdv.id}">✏️ Modifier</button>
              <button class="action-btn-mini btn-delete-rdv" data-id="${rdv.id}" style="color:var(--danger);">🗑️</button>
            </div>
          </td>
        `;

        row.querySelector('.btn-edit-rdv').addEventListener('click', () => openEditRdvModal(rdv.id));
        row.querySelector('.btn-delete-rdv').addEventListener('click', async () => {
          if (confirm(`Confirmez-vous la suppression du rendez-vous de ${rdv.patient_nom} ?`)) {
            try {
              await API.delete(`/appointments/${rdv.id}`);
              API.showToast('Rendez-vous supprimé', 'info');
              renderAppointmentsTable();
            } catch (err) {
              API.showToast(err.message, 'danger');
            }
          }
        });

        tableBody.appendChild(row);
      });
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger); padding:1rem;">Erreur : ${err.message}</td></tr>`;
    }
  }

  // -------------------------------------------------------------
  // VUE 7: CONTRÔLE & AUDIT
  // -------------------------------------------------------------
  async function renderControles() {
    const overdueContainer = document.getElementById('controles-overdue-list');
    const missingPhoneContainer = document.getElementById('controles-missing-phone-list');
    const conflictsContainer = document.getElementById('controles-conflicts-list');
    const auditLogsContainer = document.getElementById('audit-logs-list');

    try {
      const [resControles, resAudit] = await Promise.all([
        API.get('/controles'),
        API.get('/audit-logs')
      ]);

      // 1. Overdue
      if (overdueContainer) {
        if (resControles.overdueStatus.length === 0) {
          overdueContainer.innerHTML = '<p style="color:#059669;">✅ Tous les rendez-vous passés ont un statut à jour.</p>';
        } else {
          overdueContainer.innerHTML = '';
          resControles.overdueStatus.forEach((rdv) => {
            const item = document.createElement('div');
            item.className = 'rappel-item-row';
            item.innerHTML = `
              <div>
                <strong>${rdv.patient_nom} ${rdv.patient_prenom}</strong> - ${rdv.date} à ${rdv.heure_debut} (${rdv.motif})
                <div style="font-size:0.8rem; color:#d97706;">Statut encore marqué : "${rdv.statut}"</div>
              </div>
              <div class="actions-group">
                <button class="action-btn-mini btn-mark-venu" data-id="${rdv.id}" style="color:#059669;">Marquer Venu</button>
                <button class="action-btn-mini btn-mark-absent" data-id="${rdv.id}" style="color:#dc2626;">Marquer Absent</button>
              </div>
            `;
            item.querySelector('.btn-mark-venu').addEventListener('click', async () => {
              await API.patch(`/appointments/${rdv.id}/status`, { statut: 'Venu' });
              renderControles();
            });
            item.querySelector('.btn-mark-absent').addEventListener('click', async () => {
              await API.patch(`/appointments/${rdv.id}/status`, { statut: 'Absent' });
              renderControles();
            });
            overdueContainer.appendChild(item);
          });
        }
      }

      // 2. Missing Phones
      if (missingPhoneContainer) {
        if (resControles.missingPhones.length === 0) {
          missingPhoneContainer.innerHTML = '<p style="color:#059669;">✅ Aucun numéro de téléphone manquant.</p>';
        } else {
          missingPhoneContainer.innerHTML = '';
          resControles.missingPhones.forEach((rdv) => {
            const item = document.createElement('div');
            item.className = 'rappel-item-row';
            item.innerHTML = `
              <div>
                <strong>${rdv.patient_nom} ${rdv.patient_prenom}</strong> le ${rdv.date} à ${rdv.heure_debut}
              </div>
              <button class="action-btn-mini" onclick="openEditRdvModal(${rdv.id})">Ajouter téléphone</button>
            `;
            missingPhoneContainer.appendChild(item);
          });
        }
      }

      // 3. Detected Conflicts
      if (conflictsContainer) {
        if (resControles.detectedConflicts.length === 0) {
          conflictsContainer.innerHTML = '<p style="color:#059669;">✅ Aucun conflit d\'horaire détecté.</p>';
        } else {
          conflictsContainer.innerHTML = '';
          resControles.detectedConflicts.forEach(({ a1, a2 }) => {
            const item = document.createElement('div');
            item.className = 'rappel-item-row';
            item.style.borderLeft = '4px solid var(--danger)';
            item.innerHTML = `
              <div>
                <strong style="color:var(--danger);">⚠️ Chevauchement :</strong>
                <div>1. ${a1.patient_nom} (${a1.date} ${a1.heure_debut}-${a1.heure_fin}, ${a1.dentiste_nom || 'Tous'})</div>
                <div>2. ${a2.patient_nom} (${a2.date} ${a2.heure_debut}-${a2.heure_fin}, ${a2.dentiste_nom || 'Tous'})</div>
              </div>
            `;
            conflictsContainer.appendChild(item);
          });
        }
      }

      // 4. Audit Log
      if (auditLogsContainer) {
        auditLogsContainer.innerHTML = '';
        resAudit.logs.slice(0, 40).forEach((l) => {
          const row = document.createElement('div');
          row.style.padding = '0.5rem 0';
          row.style.borderBottom = '1px solid #f1f5f9';
          row.style.fontSize = '0.85rem';
          row.innerHTML = `
            <span style="color:#64748b; font-family:monospace;">${l.timestamp}</span> •
            <strong>${l.operator}</strong> :
            <span>${l.details}</span>
          `;
          auditLogsContainer.appendChild(row);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // -------------------------------------------------------------
  // VUE 8: PARAMÈTRES DU CABINET
  // -------------------------------------------------------------
  async function loadSettingsTab() {
    const s = API.state.settings;
    document.getElementById('set-cabinet-name').value = s.cabinet_name || '';
    document.getElementById('set-cabinet-phone').value = s.cabinet_phone || '';
    document.getElementById('set-opening-time').value = s.opening_time || '08:00';
    document.getElementById('set-closing-time').value = s.closing_time || '17:00';
    document.getElementById('set-slot-duration').value = s.slot_duration || '30';
    document.getElementById('set-first-day').value = s.first_day_of_week || 'Dimanche';
    document.getElementById('set-closed-1').value = s.closed_day_1 || 'Vendredi';
    document.getElementById('set-closed-2').value = s.closed_day_2 || '';
    document.getElementById('set-reminder-days').value = s.reminder_days_ahead || '1';

    renderDentistsSettingsList();
    renderReasonsSettingsList();
  }

  document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const settings = {
      cabinet_name: document.getElementById('set-cabinet-name').value.trim(),
      cabinet_phone: document.getElementById('set-cabinet-phone').value.trim(),
      opening_time: document.getElementById('set-opening-time').value,
      closing_time: document.getElementById('set-closing-time').value,
      slot_duration: document.getElementById('set-slot-duration').value,
      first_day_of_week: document.getElementById('set-first-day').value,
      closed_day_1: document.getElementById('set-closed-1').value,
      closed_day_2: document.getElementById('set-closed-2').value,
      reminder_days_ahead: document.getElementById('set-reminder-days').value
    };

    try {
      await API.post('/settings', { settings });
      API.showToast('Paramètres enregistrés avec succès', 'success');
      document.getElementById('header-cabinet-name').textContent = settings.cabinet_name;
    } catch (err) {
      API.showToast(err.message, 'danger');
    }
  });

  // Backup download trigger
  document.getElementById('btn-download-backup')?.addEventListener('click', () => {
    window.location.href = '/api/backup/download';
  });

  // Add Dentist Modal / Form
  document.getElementById('btn-add-dentist')?.addEventListener('click', async () => {
    const name = prompt('Nom du praticien (ex. Dr. Benali) :');
    if (!name) return;
    const speciality = prompt('Spécialité (ex. Chirurgien-dentiste, Orthodontiste) :', 'Chirurgien-dentiste');
    try {
      await API.post('/dentists', { name, speciality });
      await API.loadMetadata();
      renderDentistsSettingsList();
      API.showToast('Dentiste ajouté', 'success');
    } catch (err) {
      API.showToast(err.message, 'danger');
    }
  });

  function renderDentistsSettingsList() {
    const list = document.getElementById('dentists-list');
    if (!list) return;
    list.innerHTML = '';
    API.state.dentists.forEach((d) => {
      const item = document.createElement('div');
      item.className = 'rappel-item-row';
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span class="dentiste-dot" style="background:${d.color};"></span>
          <strong>${d.name}</strong> (${d.speciality})
        </div>
        <span class="tab-badge" style="background:${d.active ? '#dcfce7' : '#fee2e2'}; color:${d.active ? '#166534' : '#991b1b'};">
          ${d.active ? 'Actif' : 'Inactif'}
        </span>
      `;
      list.appendChild(item);
    });
  }

  function renderReasonsSettingsList() {
    const list = document.getElementById('reasons-list');
    if (!list) return;
    list.innerHTML = '';
    API.state.reasons.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'rappel-item-row';
      item.innerHTML = `
        <div>
          <strong>${r.name}</strong>
        </div>
        <span class="badge-motif">${r.default_duration} min</span>
      `;
      list.appendChild(item);
    });
  }

  // -------------------------------------------------------------
  // MODAL RENDEZ-VOUS (NOUVEAU & MODIFICATION)
  // -------------------------------------------------------------
  const modalTitle = document.getElementById('modal-rdv-title');
  const inputRdvId = document.getElementById('rdv-id');
  const inputDate = document.getElementById('rdv-date');
  const inputHeure = document.getElementById('rdv-heure');
  const inputDuree = document.getElementById('rdv-duree');
  const inputNom = document.getElementById('rdv-nom');
  const inputPrenom = document.getElementById('rdv-prenom');
  const inputTel = document.getElementById('rdv-tel');
  const selectMotif = document.getElementById('rdv-motif');
  const selectDentiste = document.getElementById('rdv-dentiste');
  const selectStatut = document.getElementById('rdv-statut');
  const inputRemarque = document.getElementById('rdv-remarque');
  const patientSuggestions = document.getElementById('patient-autocomplete-list');

  // Open New Modal
  btnNewRdv?.addEventListener('click', () => {
    openNewRdvModal({
      date: API.state.currentDate,
      heure: '09:00'
    });
  });

  window.openNewRdvModal = function (prefill = {}) {
    formRdv.reset();
    inputRdvId.value = '';
    modalTitle.textContent = 'Nouveau Rendez-vous';

    populateDentistSelect(selectDentiste, true);
    populateMotifSelect(selectMotif);

    inputDate.value = prefill.date || API.state.currentDate;
    inputHeure.value = prefill.heure || '09:00';
    inputDuree.value = '30';
    if (prefill.dentiste_id) selectDentiste.value = prefill.dentiste_id;
    selectStatut.value = 'À confirmer';

    modalRdv.classList.add('active');
    setTimeout(() => inputNom.focus(), 100);
  };

  window.openEditRdvModal = async function (appointmentId) {
    try {
      const res = await API.get('/appointments', { search: '' });
      const rdv = res.appointments.find((a) => a.id === Number(appointmentId));
      if (!rdv) throw new Error('Rendez-vous introuvable');

      populateDentistSelect(selectDentiste, true);
      populateMotifSelect(selectMotif);

      modalTitle.textContent = `Modifier Rendez-vous #${rdv.id}`;
      inputRdvId.value = rdv.id;
      inputDate.value = rdv.date;
      inputHeure.value = rdv.heure_debut;
      inputDuree.value = rdv.duree;
      inputNom.value = rdv.patient_nom;
      inputPrenom.value = rdv.patient_prenom || '';
      inputTel.value = rdv.patient_telephone;
      selectMotif.value = rdv.motif;
      selectDentiste.value = rdv.dentiste_id || '';
      selectStatut.value = rdv.statut;
      inputRemarque.value = rdv.remarque || '';

      modalRdv.classList.add('active');
    } catch (err) {
      API.showToast(err.message, 'danger');
    }
  };

  // Auto-set duration when reason changes
  selectMotif?.addEventListener('change', (e) => {
    const selected = API.state.reasons.find((r) => r.name === e.target.value);
    if (selected && selected.default_duration) {
      inputDuree.value = selected.default_duration;
    }
  });

  // Patient Autocomplete Search
  inputNom?.addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) {
      patientSuggestions.style.display = 'none';
      return;
    }

    try {
      const res = await API.get('/patients', { q });
      if (res.patients.length > 0) {
        patientSuggestions.innerHTML = '';
        res.patients.forEach((p) => {
          const div = document.createElement('div');
          div.style.padding = '0.5rem 0.75rem';
          div.style.cursor = 'pointer';
          div.style.borderBottom = '1px solid #f1f5f9';
          div.innerHTML = `<strong>${p.nom} ${p.prenom}</strong> - <span style="color:#64748b;">${p.telephone}</span>`;
          div.addEventListener('click', () => {
            inputNom.value = p.nom;
            inputPrenom.value = p.prenom;
            inputTel.value = p.telephone;
            patientSuggestions.style.display = 'none';
          });
          patientSuggestions.appendChild(div);
        });
        patientSuggestions.style.display = 'block';
      } else {
        patientSuggestions.style.display = 'none';
      }
    } catch (err) {
      // ignore
    }
  }, 250));

  // Close suggestions if clicked outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#patient-autocomplete-list') && e.target !== inputNom) {
      if (patientSuggestions) patientSuggestions.style.display = 'none';
    }
  });

  // Close Modal triggers
  document.querySelectorAll('.close-modal-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      modalRdv.classList.remove('active');
    });
  });

  // Submit Appointment Form (Create or Update)
  formRdv?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = inputRdvId.value;
    const payload = {
      date: inputDate.value,
      heure_debut: inputHeure.value,
      duree: Number(inputDuree.value),
      patient_nom: inputNom.value.trim(),
      patient_prenom: inputPrenom.value.trim(),
      patient_telephone: inputTel.value.trim(),
      motif: selectMotif.value,
      dentiste_id: selectDentiste.value ? Number(selectDentiste.value) : null,
      statut: selectStatut.value,
      remarque: inputRemarque.value.trim()
    };

    const submitBtn = formRdv.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Vérification & Enregistrement...';

    try {
      if (id) {
        await API.put(`/appointments/${id}`, payload);
        API.showToast('Rendez-vous mis à jour avec succès', 'success');
      } else {
        await API.post('/appointments', payload);
        API.showToast('Rendez-vous enregistré avec succès !', 'success');
      }
      modalRdv.classList.remove('active');
      refreshActiveView();
    } catch (err) {
      // Overlap / Conflict error or validation error
      alert(`⚠️ Attention :\n\n${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enregistrer le rendez-vous';
    }
  });

  // -------------------------------------------------------------
  // HELPER UTILITIES
  // -------------------------------------------------------------
  function populateDentistSelect(selectElement, includeAll = false) {
    if (!selectElement) return;
    const currentVal = selectElement.value;
    selectElement.innerHTML = includeAll ? '<option value="">Tous les praticiens</option>' : '';
    API.state.dentists.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.speciality})`;
      selectElement.appendChild(opt);
    });
    if (currentVal) selectElement.value = currentVal;
  }

  function populateMotifSelect(selectElement) {
    if (!selectElement) return;
    const currentVal = selectElement.value;
    selectElement.innerHTML = '';
    API.state.reasons.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = `${r.name} (${r.default_duration} min)`;
      selectElement.appendChild(opt);
    });
    if (currentVal) selectElement.value = currentVal;
  }

  function getStatusClass(statut) {
    switch (statut) {
      case 'À confirmer': return 'status-aconfirmer';
      case 'Confirmé': return 'status-confirme';
      case 'Venu': return 'status-venu';
      case 'Absent': return 'status-absent';
      case 'Annulé': return 'status-annule';
      case 'Reporté': return 'status-reporte';
      default: return 'status-aconfirmer';
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  API.timeToMinutes = function (timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  // -------------------------------------------------------------
  // MODAL SHARE CLOUD ACCESS
  // -------------------------------------------------------------
  const btnShareCloud = document.getElementById('btn-share-cloud');
  const modalShare = document.getElementById('modal-share');
  const shareCloudInput = document.getElementById('share-cloud-input');
  const btnCopyCloudLink = document.getElementById('btn-copy-cloud-link');
  const btnWhatsappShare = document.getElementById('btn-whatsapp-share');

  async function updateShareLink() {
    try {
      const res = await API.get('/public-url');
      const url = res.publicUrl || (res.localIps && res.localIps.length > 0 ? `http://${res.localIps[0]}:${res.port}` : window.location.origin);
      if (shareCloudInput) shareCloudInput.value = url;

      if (btnWhatsappShare) {
        const text = encodeURIComponent(`Bonjour, voici le lien pour accéder au planning du Cabinet Dentaire en direct sur ton PC ou ton téléphone :\n\n${url}`);
        btnWhatsappShare.href = `https://wa.me/?text=${text}`;
      }
    } catch (e) {
      if (shareCloudInput) shareCloudInput.value = window.location.origin;
    }
  }

  btnShareCloud?.addEventListener('click', async () => {
    await updateShareLink();
    modalShare.classList.add('active');
  });

  document.querySelectorAll('.close-share-modal').forEach((btn) => {
    btn.addEventListener('click', () => {
      modalShare.classList.remove('active');
    });
  });

  btnCopyCloudLink?.addEventListener('click', () => {
    if (shareCloudInput && shareCloudInput.value) {
      navigator.clipboard.writeText(shareCloudInput.value).then(() => {
        API.showToast('Lien copié dans le presse-papier !', 'success');
      }).catch(() => {
        shareCloudInput.select();
        document.execCommand('copy');
        API.showToast('Lien copié !', 'success');
      });
    }
  });

  API.on('PUBLIC_URL_READY', (payload) => {
    if (payload && payload.url && shareCloudInput) {
      shareCloudInput.value = payload.url;
      if (btnWhatsappShare) {
        const text = encodeURIComponent(`Bonjour, voici le lien pour accéder au planning du Cabinet Dentaire en direct sur ton PC ou ton téléphone :\n\n${payload.url}`);
        btnWhatsappShare.href = `https://wa.me/?text=${text}`;
      }
    }
  });

  // Initial render of first tab
  refreshActiveView();
  updateShareLink();
});
