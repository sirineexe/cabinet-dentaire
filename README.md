# 🦷 Cabinet Dentaire — Logiciel de Gestion des Rendez-vous

Logiciel médical moderne, robuste et multi-utilisateurs développé pour remplacer et sublimer le tableau de gestion des rendez-vous d'un cabinet dentaire.

---

## 🌟 Points Forts d'Ingénierie & Sécurité (Backend Solide)

1. **Zéro Double Réservation (Conflits Prévenus au Niveau Transactionnel)** :
   - Chaque prise de rendez-vous ou modification s'exécute dans une transaction atomique SQLite (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`).
   - L'algorithme d'intersection temporelle vérifie la disponibilité du fauteuil et du praticien avant toute insertion. Si deux secrétaires cliquent au même dixième de seconde sur le même créneau, le système bloque la collision avec un message explicite.
2. **Multi-postes & Synchronisation Temps Réel (WebSockets)** :
   - Toutes les modifications (ajout, annulation, patient marqué « Venu » ou « Absent ») sont répercutées instantanément sur tous les écrans du cabinet (secrétariat, salle de soins, fauteuil 1, fauteuil 2, tablette) sans avoir besoin de recharger la page (`F5`).
3. **Persistance Fiable & Zéro Dépendance Lourde (SQLite WAL)** :
   - Moteur SQLite natif intégré à Node.js avec mode WAL (*Write-Ahead Logging*), autorisant des lectures simultanées ultra-rapides et des écritures sécurisées.
   - Base de données stockée dans un fichier unique `data/cabinet.db`, facilement sauvegardable sur clé USB.
4. **Traçabilité & Journal d'Audit** :
   - Chaque action est horodatée et attribuée à l'opérateur connecté (Secrétariat, Dr. Benali, Dr. Khelil, etc.).
5. **Rappels WhatsApp & Téléphone en 1 Clic** :
   - Génération instantanée d'un message professionnel personnalisé sur WhatsApp pour confirmer ou rappeler le rendez-vous la veille.

---

## 🚀 Démarrage Rapide

### Option 1 : En 1 Clic sous Windows (Recommandé pour le cabinet)
Double-cliquez simplement sur le fichier :
```
demarrer_cabinet.bat
```
Ce script démarre automatiquement le serveur et ouvre votre navigateur par défaut à l'adresse `http://localhost:3000`.

### Option 2 : En ligne de commande
```bash
cd "C:\Users\nouno\.gemini\antigravity\scratch\cabinet-dentaire"
npm start
```

---

## 🌐 Utilisation en Réseau Local (Multi-postes / Ordinateurs & Tablettes)

Pour que les assistants, secrétaires et dentistes accèdent tous au logiciel depuis leurs propres postes :
1. Lancez le serveur sur le PC principal du cabinet (ex. le poste d'accueil).
2. La console affiche l'adresse réseau locale, par exemple :
   ```
   👉 http://192.168.1.10:3000
   ```
3. Sur tous les autres ordinateurs, PC portables et tablettes reliés au même Wi-Fi ou réseau local, ouvrez simplement cette adresse dans le navigateur (Chrome, Edge, Safari, Brave).

---

## 📋 Correspondance avec votre Feuille de Calcul d'Origine

| Feuille d'origine | Équivalent dans le logiciel | Nouveautés & Améliorations |
|---|---|---|
| **Disponibilités** | Onglet **🟢 Disponibilités** | Grille visuelle dynamique (Vert = Libre, Rouge = Occupé, Gris = Fermé). Clic direct sur un créneau pour réserver en 2 secondes. |
| **Jour** | Onglet **📅 Jour** | Timeline chronologique, gestion fluide des rendez-vous longs avec bandeau `↳ (suite)`, changement de statut rapide, lien d'appel et WhatsApp. Bouton d'impression optimisé. |
| **Semaine** | Onglet **🗓️ Semaine** | Vue 7 jours côte à côte commençant le Dimanche (configurable), pastilles par dentiste, indicateur de rendez-vous par jour. |
| **Mois** | Onglet **📊 Mois & Stats** | Calendrier complet du mois avec pastilles bleues (1-7 RDV) et orange (8+ RDV), statistiques automatiques : prévus, venus, absents, taux d'absence. |
| **Rappels** | Onglet **📞 Rappels de veille** | Liste des patients du lendemain avec case à cocher « Rappelé ? », appel en un clic et message WhatsApp pré-rédigé. |
| **Rendez-vous** | Onglet **📑 Registre des RDV** | Recherche multi-critères instantanée (nom, tél, motif), filtres par statut et export Excel (CSV avec encodage UTF-8 accents français). |
| **Contrôle** | Onglet **🛡️ Contrôles** | Alerte en direct sur les conflits, les rendez-vous passés non clôturés et les téléphones manquants. |
| **Paramètres / Listes** | Onglet **⚙️ Paramètres** | Heures d'ouverture/fermeture, durée de créneau (15, 20, 30, 45, 60 min), jours de fermeture (Vendredi, etc.), gestion des praticiens et des motifs. |

---

## 💾 Sauvegarde & Sécurité des Données

- Le fichier de données se trouve dans : `data/cabinet.db`.
- Un bouton dans l'onglet **Paramètres** permet de télécharger la sauvegarde complète de la base en 1 clic.
- Il est conseillé de copier ce fichier sur une clé USB une fois par semaine.
