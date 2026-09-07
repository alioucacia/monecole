# École Manager — Gestion scolaire complète

Application complète de gestion d'école : élèves, enseignants, classes, notes/bulletins,
résultats, présences, emploi du temps, paiements (en GNF), bibliothèque, transport scolaire,
messagerie interne et annonces — avec 4 rôles (Administrateur, Enseignant, Élève, Parent).

- **Backend** : Django 5 + Django REST Framework + SimpleJWT (auth), PostgreSQL
- **Frontend** : React 18 + TypeScript + Vite + Tailwind CSS + React Router + Recharts

## Démarrage rapide avec Docker (recommandé)

```bash
docker compose up --build
```

- Frontend : http://localhost:5173
- Backend / API : http://localhost:8000/api
- Admin Django : http://localhost:8000/admin

Au premier démarrage, le backend applique les migrations puis **peuple automatiquement
la base avec des données de démonstration réalistes** (60 élèves, 8 enseignants, 5 classes,
notes, présences, frais scolaires, annonces...).

### Comptes de démonstration

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `admin123` |
| Enseignant | `enseignant1` | `enseignant123` |
| Élève | `eleve1` | `eleve123` |
| Parent | `parent1` | `parent123` |

## Démarrage manuel (sans Docker)

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
python manage.py seed_data     # données de démo (optionnel mais recommandé)
python manage.py runserver
```

Par défaut le backend utilise SQLite si `DATABASE_URL` n'est pas défini. Pour PostgreSQL,
définissez par exemple :
```
DATABASE_URL=postgres://ecole_user:ecole_password@localhost:5432/ecole_db
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Crée un fichier `.env.local` si l'API n'est pas sur `http://localhost:8000/api` :
```
VITE_API_URL=http://localhost:8000/api
```

## Fonctionnalités

- **Authentification JWT** avec 4 rôles et permissions strictes par endpoint
- **Élèves / Enseignants** : fiches complètes, création liée à un compte utilisateur, export CSV
- **Classes** : effectifs, professeur principal, affectation matière ↔ enseignant
- **Notes & Bulletins** : saisie par type d'évaluation, calcul automatique des moyennes
  pondérées par coefficient, **moyenne de classe et appréciation par matière**, mention
  générale, **classement (rang) dans la classe**, bulletin par trimestre **ou année
  complète**, impression et **export PDF**
- **Résultats** : classement complet d'une classe (par trimestre ou sur l'année), export CSV
- **Présences** : feuille d'appel groupée par classe/date, statistiques d'assiduité
- **Emploi du temps** : vue hebdomadaire par classe, gestion des créneaux
- **Paiements (GNF)** : types de frais, suivi des soldes, encaissement, taux de
  recouvrement, export CSV
- **Bibliothèque** : catalogue de livres, gestion des emprunts/retours, retards
- **Transport scolaire** : lignes de bus, affectation des élèves, points de montée
- **Messagerie interne** : conversations entre administration, enseignants, élèves et parents
- **Annonces** : ciblées par rôle et/ou par classe
- **Tableaux de bord** adaptés à chaque rôle (graphiques, indicateurs clés)

## Structure du projet

```
ecole-manager/
├── docker-compose.yml
├── backend/                  # Django REST API
│   ├── accounts/              # Utilisateurs & JWT
│   ├── academics/             # Années scolaires, classes, matières, emploi du temps
│   ├── people/                 # Profils élèves & enseignants
│   ├── grades/                 # Notes, périodes, bulletins
│   ├── attendance/             # Présences
│   ├── payments/               # Frais & paiements (GNF)
│   ├── announcements/          # Annonces
│   ├── library/                 # Bibliothèque (livres, emprunts)
│   ├── transport/               # Transport scolaire (trajets, affectations)
│   ├── messaging/               # Messagerie interne
│   └── core/                   # Dashboard agrégé, pagination, commande de seed
└── frontend/                  # React + TypeScript + Tailwind
    └── src/
        ├── api/                 # Client Axios + endpoints typés
        ├── context/             # AuthContext (JWT, refresh automatique)
        ├── components/          # Layout, UI réutilisable
        ├── hooks/               # usePaginated
        └── pages/               # Une page par module métier
```

## Notes

- Ce projet a été généré avec l'assistance de Claude Code puis validé (migrations,
  seed, build TypeScript et tests API/UI en conditions réelles).
- Pensez à changer `SECRET_KEY` et les mots de passe de démonstration avant tout
  déploiement en production.
"# monecole" 
