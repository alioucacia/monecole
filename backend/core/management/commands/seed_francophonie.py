import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from academics.models import AnneeScolaire, Classe, Creneau, Enseignement, Matiere
from accounts.models import User
from announcements.models import Annonce
from attendance.models import Presence
from grades.models import Note, Periode
from payments.models import Frais, Paiement, TypeFrais
from people.models import EleveProfile, EnseignantProfile
from tenants.models import Ecole

random.seed(224)

PRENOMS_G = ["Mamadou", "Ibrahima", "Ousmane", "Alpha", "Aboubacar", "Mohamed", "Amadou", "Sékou", "Fodé",
             "Thierno", "Lansana", "Facinet", "Sidiki", "Cellou", "Souleymane", "Abdoulaye", "Mory", "Naby"]
PRENOMS_F = ["Fatoumata", "Aissatou", "Mariam", "Kadiatou", "Aminata", "Hawa", "Djénabou", "Ramatoulaye",
             "Mabinty", "Saran", "Djénéba", "Rougui", "Fanta", "Aïcha", "Néné", "Oumou", "Kesso", "Binta"]
NOMS = ["Diallo", "Bah", "Barry", "Sow", "Baldé", "Camara", "Condé", "Touré", "Kaba", "Cissé",
        "Keita", "Traoré", "Konaté", "Fofana", "Sylla", "Kourouma", "Doumbouya", "Soumah", "Bangoura", "Béavogui"]


class Command(BaseCommand):
    help = (
        "Peuple « GROUPE SCOLAIRE PRIVE LA FRANCOPHONIE » (l'école réelle de l'utilisateur, jusqu'ici vide "
        "à part son compte admin) avec une structure de démonstration complète en données guinéennes : "
        "année scolaire, matières, classes, enseignants, élèves/parents, notes, présences et frais scolaires."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        ecole = Ecole.objects.filter(nom__icontains="FRANCOPHONIE").first()
        if not ecole:
            raise CommandError("École « GROUPE SCOLAIRE PRIVE LA FRANCOPHONIE » introuvable.")

        admin = User.objects.filter(ecole=ecole, role=User.Role.ADMIN).first()
        if not admin:
            raise CommandError("Aucun compte admin trouvé pour cette école.")

        if AnneeScolaire.objects.filter(ecole=ecole).exists():
            self.stdout.write(self.style.WARNING("Cette école a déjà une structure — seed ignoré."))
            return

        self.stdout.write(f"Peuplement de « {ecole.nom} »…")

        annee = AnneeScolaire.objects.create(
            ecole=ecole, libelle="2025-2026", date_debut=date(2025, 9, 1), date_fin=date(2026, 6, 30), active=True,
        )

        matieres_data = [
            ("Mathématiques", "MATH", 4, "#6366f1"),
            ("Français", "FR", 4, "#ec4899"),
            ("Anglais", "ANG", 3, "#22c55e"),
            ("Sciences Physiques", "PHY", 3, "#f59e0b"),
            ("SVT", "SVT", 2, "#14b8a6"),
            ("Histoire-Géographie", "HG", 3, "#a855f7"),
            ("Éducation Physique", "EPS", 2, "#0ea5e9"),
            ("Arts Plastiques", "ART", 1, "#f97316"),
        ]
        matieres = [
            Matiere.objects.create(ecole=ecole, nom=n, code=c, coefficient=coef, couleur=coul)
            for n, c, coef, coul in matieres_data
        ]

        periodes = [
            Periode.objects.create(
                nom=f"Trimestre {i}", annee_scolaire=annee,
                date_debut=date(2025, 9, 1) + timedelta(days=100 * (i - 1)),
                date_fin=date(2025, 9, 1) + timedelta(days=100 * i - 1),
            )
            for i in range(1, 4)
        ]

        self.stdout.write("Création des enseignants…")
        enseignants = []
        for i in range(6):
            prenom = random.choice(PRENOMS_G + PRENOMS_F)
            nom = random.choice(NOMS)
            user = User.objects.create_user(
                username=f"franco.enseignant{i+1}", email=f"enseignant{i+1}@la-francophonie.example",
                password="enseignant123", first_name=prenom, last_name=nom, role=User.Role.TEACHER, ecole=ecole,
            )
            EnseignantProfile.objects.create(
                user=user, matricule=f"FRA-ENS-{100+i}", specialite=matieres_data[i % len(matieres_data)][0],
                date_embauche=date(2021, 9, 1),
            )
            enseignants.append(user)

        self.stdout.write("Création des classes…")
        niveaux = [("6ème", ["A"]), ("5ème", ["A"]), ("4ème", ["A"])]
        classes = []
        for niveau, sections in niveaux:
            for section in sections:
                classe = Classe.objects.create(
                    nom=f"{niveau} {section}", niveau=niveau, annee_scolaire=annee,
                    professeur_principal=random.choice(enseignants), capacite=30,
                )
                classes.append(classe)

        self.stdout.write("Affectation des enseignements et de l'emploi du temps…")
        jours = [Creneau.Jour.LUNDI, Creneau.Jour.MARDI, Creneau.Jour.MERCREDI, Creneau.Jour.JEUDI, Creneau.Jour.VENDREDI]
        heures = [(8, 10), (10, 12), (14, 16)]
        for classe in classes:
            for idx, matiere in enumerate(matieres):
                enseignant = enseignants[idx % len(enseignants)]
                enseignement = Enseignement.objects.create(enseignant=enseignant, matiere=matiere, classe=classe)
                jour = jours[idx % len(jours)]
                h_debut, h_fin = heures[idx % len(heures)]
                Creneau.objects.create(
                    classe=classe, enseignement=enseignement, jour=jour,
                    heure_debut=f"{h_debut:02d}:00", heure_fin=f"{h_fin:02d}:00",
                    salle=f"Salle {idx + 1}",
                )

        self.stdout.write("Création des parents et des élèves…")
        eleve_counter = 1
        all_eleves = []
        for classe in classes:
            for _ in range(12):
                genre_f = random.random() < 0.5
                prenom = random.choice(PRENOMS_F if genre_f else PRENOMS_G)
                nom = random.choice(NOMS)

                parent_user = User.objects.create_user(
                    username=f"franco.parent{eleve_counter}", email=f"parent{eleve_counter}@la-francophonie.example",
                    password="parent123", first_name=f"Parent de {prenom}", last_name=nom, role=User.Role.PARENT,
                    ecole=ecole,
                )

                eleve_user = User.objects.create_user(
                    username=f"franco.eleve{eleve_counter}", email=f"eleve{eleve_counter}@la-francophonie.example",
                    password="eleve123", first_name=prenom, last_name=nom, role=User.Role.STUDENT,
                    ecole=ecole, date_of_birth=date(2012, 1, 1) - timedelta(days=365 * (eleve_counter % 5)),
                )
                eleve_profile = EleveProfile.objects.create(
                    user=eleve_user, matricule=f"FRA-ELV-{100 + eleve_counter}",
                    classe=classe, parent=parent_user,
                )
                all_eleves.append(eleve_profile)
                eleve_counter += 1

        self.stdout.write("Saisie des notes (3 trimestres)…")
        for eleve in all_eleves:
            for matiere in matieres:
                enseignant = Enseignement.objects.get(classe=eleve.classe, matiere=matiere).enseignant
                for periode in periodes:
                    for type_eval, coeff in [(Note.TypeEvaluation.DEVOIR, 1), (Note.TypeEvaluation.COMPOSITION, 2)]:
                        Note.objects.create(
                            eleve=eleve, matiere=matiere, enseignant=enseignant, periode=periode,
                            type_evaluation=type_eval, valeur=Decimal(str(round(random.uniform(8, 19), 2))),
                            coefficient=coeff, date=periode.date_debut + timedelta(days=random.randint(1, 30)),
                        )

        self.stdout.write("Saisie des présences…")
        for eleve in all_eleves:
            for jour_offset in range(15):
                jour_date = date(2025, 9, 1) + timedelta(days=jour_offset)
                if jour_date.weekday() >= 5:
                    continue
                statut = random.choices(
                    [Presence.Statut.PRESENT, Presence.Statut.ABSENT, Presence.Statut.RETARD],
                    weights=[85, 10, 5],
                )[0]
                Presence.objects.create(
                    eleve=eleve, date=jour_date, statut=statut,
                    justifie=(statut != Presence.Statut.PRESENT and random.random() < 0.5),
                    enregistre_par=admin,
                )

        self.stdout.write("Création des frais scolaires…")
        types_frais = [
            TypeFrais.objects.create(ecole=ecole, nom="Frais de scolarité", montant_standard=Decimal("150000")),
            TypeFrais.objects.create(ecole=ecole, nom="Cantine", montant_standard=Decimal("25000")),
            TypeFrais.objects.create(ecole=ecole, nom="Transport", montant_standard=Decimal("20000")),
        ]
        for eleve in all_eleves:
            for type_frais in types_frais:
                frais = Frais.objects.create(
                    eleve=eleve, type_frais=type_frais, annee_scolaire=annee,
                    montant=type_frais.montant_standard, date_echeance=date(2025, 10, 31),
                )
                if random.random() < 0.6:
                    Paiement.objects.create(
                        frais=frais, montant=frais.montant if random.random() < 0.5 else frais.montant / 2,
                        mode_paiement=random.choice(list(Paiement.ModePaiement)), enregistre_par=admin,
                    )

        self.stdout.write("Création des annonces…")
        Annonce.objects.create(
            ecole=ecole, titre="Bienvenue pour l'année scolaire 2025-2026",
            contenu="Toute l'équipe pédagogique du Groupe Scolaire Privé La Francophonie vous souhaite une excellente rentrée !",
            auteur=admin, cible_role=Annonce.Cible.TOUS, epingle=True,
        )

        self.stdout.write(self.style.SUCCESS(
            f"\n« {ecole.nom} » peuplée avec succès !\n"
            f"  {len(enseignants)} enseignant(s), {len(classes)} classe(s), {len(all_eleves)} élève(s)/parent(s).\n"
            "  Comptes de test (mot de passe entre parenthèses) :\n"
            "  Enseignant : franco.enseignant1 (enseignant123)\n"
            "  Élève      : franco.eleve1 (eleve123)\n"
            "  Parent     : franco.parent1 (parent123)\n"
        ))
