import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from academics.models import AnneeScolaire, Classe, Creneau, Enseignement, Matiere
from accounts.models import User
from announcements.models import Annonce
from attendance.models import Presence
from grades.models import Note, Periode
from library.models import Emprunt, Livre
from messaging.models import Message
from payments.models import Frais, Paiement, TypeFrais
from people.models import EleveProfile, EnseignantProfile
from tenants.models import Ecole, PaiementEcole
from transport.models import AffectationTransport, Trajet

random.seed(42)

# Prénoms et noms de famille courants en Guinée (communautés peule, malinké, soussou et forestière),
# pour que les données de démonstration reflètent le pays plutôt que des noms génériques français.
PRENOMS_G = ["Mamadou", "Ibrahima", "Ousmane", "Alpha", "Aboubacar", "Mohamed", "Amadou", "Sékou", "Fodé",
             "Thierno", "Lansana", "Facinet", "Sidiki", "Cellou", "Souleymane", "Abdoulaye", "Mory", "Naby"]
PRENOMS_F = ["Fatoumata", "Aissatou", "Mariam", "Kadiatou", "Aminata", "Hawa", "Djénabou", "Ramatoulaye",
             "Mabinty", "Saran", "Djénéba", "Rougui", "Fanta", "Aïcha", "Néné", "Oumou", "Kesso", "Binta"]
NOMS = ["Diallo", "Bah", "Barry", "Sow", "Baldé", "Camara", "Condé", "Touré", "Kaba", "Cissé",
        "Keita", "Traoré", "Konaté", "Fofana", "Sylla", "Kourouma", "Doumbouya", "Soumah", "Bangoura", "Béavogui"]


class Command(BaseCommand):
    help = "Peuple la base de données avec des données de démonstration réalistes (plateforme multi-écoles)."

    @transaction.atomic
    def handle(self, *args, **options):
        if User.objects.filter(username="superadmin").exists():
            self.stdout.write(self.style.WARNING("Les données de démo existent déjà — seed ignoré."))
            return

        self.stdout.write("Création du Super Admin de la plateforme…")
        superadmin = User.objects.create_superuser(
            username="superadmin", email="superadmin@taly-school.com", password="superadmin123",
            first_name="Plateforme", last_name="Taly-School", role=User.Role.SUPERADMIN,
        )

        self.stdout.write("Création de l'établissement de démonstration (École Lumière)…")
        ecole = Ecole.objects.create(
            nom="École Lumière", adresse="Kaloum, Conakry", telephone="+224 620 00 00 00",
            email="contact@ecole-lumiere.example", abonnement_mensuel=Decimal("150000"),
        )
        PaiementEcole.objects.create(
            ecole=ecole, mois=date.today().replace(day=1), montant=ecole.abonnement_mensuel,
            mode_paiement=PaiementEcole.ModePaiement.VIREMENT, enregistre_par=superadmin,
        )

        self.stdout.write("Création d'une deuxième école (démo de l'isolation multi-écoles, abonnement en retard)…")
        ecole2 = Ecole.objects.create(
            nom="École Étoile", adresse="Matam, Conakry", telephone="+224 621 11 11 11",
            email="contact@ecole-etoile.example", abonnement_mensuel=Decimal("100000"),
        )
        admin2 = User.objects.create_user(
            username="admin.etoile", email="admin@ecole-etoile.example", password="etoile123",
            first_name="Fatoumata", last_name="Camara", role=User.Role.ADMIN, ecole=ecole2, is_staff=True,
        )
        annee2 = AnneeScolaire.objects.create(
            ecole=ecole2, libelle="2025-2026", date_debut=date(2025, 9, 1), date_fin=date(2026, 6, 30), active=True,
        )
        classe2 = Classe.objects.create(nom="6ème A", niveau="6ème", annee_scolaire=annee2, capacite=30)
        for i in range(1, 4):
            eleve_user2 = User.objects.create_user(
                username=f"etoile.eleve{i}", email=f"eleve{i}@ecole-etoile.example", password="eleve123",
                first_name=random.choice(PRENOMS_F + PRENOMS_G), last_name=random.choice(NOMS),
                role=User.Role.STUDENT, ecole=ecole2,
            )
            EleveProfile.objects.create(user=eleve_user2, matricule=f"ETO-{100 + i}", classe=classe2)
        # Volontairement aucun PaiementEcole ce mois-ci pour École Étoile : elle sert de
        # démonstration du blocage d'accès en cas de retard de paiement au-delà du délai de grâce.
        self.stdout.write(self.style.WARNING(
            "  Ecole Etoile n'a pas paye son abonnement du mois : utile pour tester le blocage."
        ))

        self.stdout.write("Création des comptes et de la structure académique (École Lumière)…")

        admin = User.objects.create_superuser(
            username="admin", email="admin@ecole-lumiere.example", password="admin123",
            first_name="Aïssatou", last_name="Condé", role=User.Role.ADMIN, ecole=ecole,
        )
        User.objects.create_user(
            username="comptable", email="comptable@ecole-lumiere.example", password="comptable123",
            first_name="Alpha", last_name="Diallo", role=User.Role.COMPTABILITE, ecole=ecole, is_staff=True,
        )
        User.objects.create_user(
            username="surveillant", email="surveillant@ecole-lumiere.example", password="surveillant123",
            first_name="Mariam", last_name="Bah", role=User.Role.SURVEILLANCE, ecole=ecole, is_staff=True,
        )

        annee = AnneeScolaire.objects.create(
            ecole=ecole, libelle="2025-2026", date_debut=date(2025, 9, 1), date_fin=date(2026, 6, 30), active=True
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
        for i in range(8):
            prenom = random.choice(PRENOMS_G + PRENOMS_F)
            nom = NOMS[i]
            user = User.objects.create_user(
                username=f"enseignant{i+1}", email=f"enseignant{i+1}@ecole-lumiere.example", password="enseignant123",
                first_name=prenom, last_name=nom, role=User.Role.TEACHER, ecole=ecole,
            )
            profile = EnseignantProfile.objects.create(
                user=user, matricule=f"ENS-{1000+i}", specialite=matieres_data[i % len(matieres_data)][0],
                date_embauche=date(2020, 9, 1),
            )
            enseignants.append(user)

        self.stdout.write("Création des classes…")
        niveaux = [("6ème", ["A", "B"]), ("5ème", ["A"]), ("4ème", ["A"]), ("3ème", ["A"])]
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
                    username=f"parent{eleve_counter}", email=f"parent{eleve_counter}@ecole-lumiere.example",
                    password="parent123", first_name=f"Parent de {prenom}", last_name=nom, role=User.Role.PARENT,
                    ecole=ecole,
                )

                eleve_user = User.objects.create_user(
                    username=f"eleve{eleve_counter}", email=f"eleve{eleve_counter}@ecole-lumiere.example",
                    password="eleve123", first_name=prenom, last_name=nom, role=User.Role.STUDENT,
                    ecole=ecole, date_of_birth=date(2012, 1, 1) - timedelta(days=365 * (eleve_counter % 5)),
                )
                eleve_profile = EleveProfile.objects.create(
                    user=eleve_user, matricule=f"ELV-{2000 + eleve_counter}",
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

        self.stdout.write("Création de la bibliothèque…")
        livres_data = [
            ("Le Petit Prince", "Antoine de Saint-Exupéry", "Roman", 5),
            ("Les Misérables", "Victor Hugo", "Roman", 3),
            ("Candide", "Voltaire", "Conte philosophique", 4),
            ("L'Étranger", "Albert Camus", "Roman", 3),
            ("Physique-Chimie 4ème", "Collection Hatier", "Manuel scolaire", 15),
            ("Mathématiques 6ème", "Collection Nathan", "Manuel scolaire", 15),
            ("Histoire de l'Afrique", "Cheikh Anta Diop", "Histoire", 4),
            ("Une si longue lettre", "Mariama Bâ", "Roman", 3),
            ("Atlas géographique", "Collection Larousse", "Référence", 6),
            ("Contes et légendes d'Afrique", "Collectif", "Contes", 5),
        ]
        livres = [
            Livre.objects.create(ecole=ecole, titre=t, auteur=a, categorie=c, exemplaires_total=n)
            for t, a, c, n in livres_data
        ]
        for i in range(20):
            eleve = random.choice(all_eleves)
            livre = random.choice(livres)
            date_emprunt_offset = random.randint(1, 40)
            date_retour_prevue = date(2025, 9, 1) + timedelta(days=date_emprunt_offset + 14)
            emprunt = Emprunt.objects.create(
                livre=livre, eleve=eleve, date_retour_prevue=date_retour_prevue, enregistre_par=admin,
            )
            if random.random() < 0.5:
                emprunt.date_retour_effective = date_retour_prevue - timedelta(days=random.randint(0, 5))
                emprunt.save()

        self.stdout.write("Création du transport scolaire…")
        trajets = [
            Trajet.objects.create(
                ecole=ecole, nom="Ligne 1 — Centre-ville", chauffeur_nom="Mamadou Diallo",
                vehicule_immatriculation="RC-1234-A", capacite=40, heure_depart="07:00", heure_retour="16:30",
                description="Dessert le centre-ville et la gare",
            ),
            Trajet.objects.create(
                ecole=ecole, nom="Ligne 2 — Banlieue Nord", chauffeur_nom="Fatoumata Camara",
                vehicule_immatriculation="RC-5678-B", capacite=35, heure_depart="07:15", heure_retour="16:45",
                description="Dessert les quartiers nord",
            ),
            Trajet.objects.create(
                ecole=ecole, nom="Ligne 3 — Banlieue Sud", chauffeur_nom="Ibrahima Bah",
                vehicule_immatriculation="RC-9012-C", capacite=35, heure_depart="07:10", heure_retour="16:40",
                description="Dessert les quartiers sud",
            ),
        ]
        for eleve in random.sample(all_eleves, k=min(25, len(all_eleves))):
            trajet = random.choice(trajets)
            AffectationTransport.objects.create(
                eleve=eleve, trajet=trajet, point_montee=f"Arrêt {random.randint(1, 8)}",
            )

        self.stdout.write("Création de messages de démonstration…")
        premier_eleve = all_eleves[0]
        Message.objects.create(
            expediteur=premier_eleve.parent, destinataire=enseignants[0],
            contenu="Bonjour, pourriez-vous me donner des nouvelles des résultats de mon enfant ce trimestre ?",
        )
        Message.objects.create(
            expediteur=enseignants[0], destinataire=premier_eleve.parent,
            contenu="Bonjour, votre enfant travaille bien ce trimestre, continuez ainsi !", lu=True,
        )
        Message.objects.create(
            expediteur=admin, destinataire=enseignants[0],
            contenu="Merci de finaliser la saisie des notes avant vendredi pour l'édition des bulletins.",
        )

        self.stdout.write("Création des annonces…")
        Annonce.objects.create(
            ecole=ecole, titre="Bienvenue pour l'année scolaire 2025-2026",
            contenu="Toute l'équipe pédagogique vous souhaite une excellente rentrée !",
            auteur=admin, cible_role=Annonce.Cible.TOUS, epingle=True,
        )
        Annonce.objects.create(
            ecole=ecole, titre="Réunion parents-professeurs",
            contenu="Une réunion parents-professeurs aura lieu le mois prochain. Merci de vous inscrire.",
            auteur=admin, cible_role=Annonce.Cible.PARENT,
        )

        self.stdout.write(self.style.SUCCESS(
            "\nDonnées de démonstration créées avec succès !\n"
            "Comptes de test (mot de passe entre parenthèses) :\n"
            "  Super Admin (plateforme) : superadmin (superadmin123)\n"
            "  --- École Lumière (à jour de paiement) ---\n"
            "  Admin        : admin (admin123)\n"
            "  Comptabilité : comptable (comptable123)\n"
            "  Surveillance : surveillant (surveillant123)\n"
            "  Enseignant   : enseignant1 (enseignant123)\n"
            "  Élève        : eleve1 (eleve123)\n"
            "  Parent       : parent1 (parent123)\n"
            "  --- École Étoile (abonnement en retard, pour tester le blocage) ---\n"
            "  Admin      : admin.etoile (etoile123)\n"
            "  Élève      : etoile.eleve1 (eleve123)\n"
        ))
